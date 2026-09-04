"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { Role, PointsSourceType } from "@prisma/client";
import { z } from "zod";
import { prisma, writeClient } from "@/lib/db";
import { isAdminEmail, requireAdmin } from "@/lib/admin-auth";
import { getCurrentDayNumber } from "@/lib/date-utils";
import { computeStreakStats } from "@/features/submission/streak-utils";
import { sendChallengeResetEmail } from "@/features/email/challenge-reset-email";
import { studentProfile } from "@/repositories/legacy/student-profile";
import {
  dualWriteCandidateIdentity,
  dualWriteChallengeEnrollmentById,
  dualWriteDeleteEnrollmentSubmissions,
  dualWriteDeleteSubmissionAttempt,
} from "@/repositories/dual-write";
import {
  applyPointsChange,
  lockWalletBalance,
  submissionAwardTotal,
  withLegacyPointsMirrorFlush,
} from "@/repositories/points";
import { randomUUID } from "node:crypto";

const baseInput = z.object({
  targetUserId: z.string().min(1),
  reason: z.string().max(500).optional(),
});

function revalidateAdminViews(targetUserId: string) {
  revalidatePath(`/admin/students/${targetUserId}`);
  revalidatePath("/admin");
  revalidatePath("/admin/students");
  revalidatePath("/admin/submissions");
  revalidatePath("/admin/analytics");
  revalidatePath("/dashboard");
  revalidatePath(`/students/${targetUserId}`);
  revalidatePath("/challenge");
  revalidatePath("/quiz");
  revalidatePath("/register");
  revalidatePath("/marketplace");
  revalidatePath("/hackathon/dashboard");
}

export async function resetProgressAction(input: {
  targetUserId: string;
  reason?: string;
}) {
  const admin = await requireAdmin();
  const parsed = baseInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Invalid input" };

  const { targetUserId, reason } = parsed.data;

  let resetDomain: string | null = null;

  try {
    await withLegacyPointsMirrorFlush(() =>
      writeClient().$transaction(async (tx) => {
      const enrollment = await tx.enrollment.findFirst({
        where: { userId: targetUserId },
      });
      if (!enrollment) throw new Error("No enrollment");
      resetDomain = enrollment.domain;

      // Serialize reset against every balance writer before reading the ledger.
      await lockWalletBalance(tx, targetUserId);

      const submissions = await tx.submission.findMany({
        where: { enrollmentId: enrollment.id },
        select: { id: true },
      });
      const pointsToRemove = await submissionAwardTotal(tx, {
        submissionIds: submissions.map((s) => s.id),
        enrollmentId: enrollment.id,
      });
      if (pointsToRemove > 0) {
        const applied = await applyPointsChange(tx, {
          userId: targetUserId,
          amount: -pointsToRemove,
          mode: "debit_clamp",
          sourceType: PointsSourceType.RECONCILIATION,
          sourceId: enrollment.id,
          idempotencyKey: `reset-progress:${enrollment.id}:${randomUUID()}`,
          reason:
            "Clamped synergy to 0 after reset removed submission points that were already spent.",
          createdByUserId: admin.userId,
        });
        if (!applied.ok) {
          throw new Error("Failed to adjust points for reset");
        }
      }

      await tx.submission.deleteMany({
        where: { enrollmentId: enrollment.id },
      });
      await dualWriteDeleteEnrollmentSubmissions(tx, enrollment.id);

      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: {
          daysCompleted: 0,
          currentStreak: 0,
          longestStreak: 0,
          lastSubmittedDay: null,
          status: "ACTIVE",
          completedAt: null,
          startedAt: new Date(),
        },
      });
      await dualWriteChallengeEnrollmentById(tx, enrollment.id);

      await tx.studentProfile.updateMany({
        where: { userId: targetUserId },
        data: { isReadyForInterview: false },
      });
      await dualWriteCandidateIdentity(tx, targetUserId, {
        isReadyForInterview: true,
      });

      await tx.adminAction.create({
        data: {
          adminUserId: admin.userId,
          targetUserId,
          actionType: "RESET_PROGRESS",
          reason,
        },
      });
    }, {
      maxWait: 10000,
      timeout: 20000,
    }),
    );

    revalidateAdminViews(targetUserId);

    // Best-effort: notify the participant that their Claude challenge was reset.
    // Runs after the response and outside the transaction — a mail failure must
    // never fail the reset.
    if (resetDomain === "CLAUDE") {
      const target = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: {
          email: true,
          studentProfile: { select: { fullName: true } },
        },
      });
      const to = target?.email;
      if (to) {
        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL ?? "https://abtalks.in";
        const firstName =
          target?.studentProfile?.fullName?.trim().split(/\s+/)[0] || "there";
        after(async () => {
          await sendChallengeResetEmail({
            to,
            firstName,
            dashboardUrl: `${appUrl}/dashboard`,
          });
        });
      }
    }

    return { ok: true as const };
  } catch (e) {
    return {
      ok: false as const,
      message: e instanceof Error ? e.message : "Failed to reset progress",
    };
  }
}

export async function toggleReadyForInterviewAction(input: {
  targetUserId: string;
  reason?: string;
}) {
  const admin = await requireAdmin();
  const parsed = baseInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Invalid input" };

  const { targetUserId, reason } = parsed.data;

  try {
    const profile = await studentProfile.findUnique({
      where: { userId: targetUserId },
      select: { isReadyForInterview: true },
    });
    if (!profile) throw new Error("Profile not found");

    const newValue = !profile.isReadyForInterview;

    await writeClient().$transaction(async (tx) => {
      await tx.studentProfile.update({
        where: { userId: targetUserId },
        data: { isReadyForInterview: newValue },
      });
      await dualWriteCandidateIdentity(tx, targetUserId, {
        isReadyForInterview: true,
      });

      await tx.adminAction.create({
        data: {
          adminUserId: admin.userId,
          targetUserId,
          actionType: "TOGGLE_READY_FOR_INTERVIEW",
          metadata: { newValue },
          reason,
        },
      });
    }, {
      maxWait: 10000,
      timeout: 20000,
    });

    revalidateAdminViews(targetUserId);
    return { ok: true as const, newValue };
  } catch (e) {
    return {
      ok: false as const,
      message: e instanceof Error ? e.message : "Failed to toggle",
    };
  }
}

export async function removeFromChallengeAction(input: {
  targetUserId: string;
  reason?: string;
}) {
  const admin = await requireAdmin();
  const parsed = baseInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Invalid input" };

  const { targetUserId, reason } = parsed.data;

  try {
    await writeClient().$transaction(async (tx) => {
      const enrollment = await tx.enrollment.findFirst({
        where: { userId: targetUserId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!enrollment) throw new Error("No active enrollment");

      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: { status: "ABANDONED" },
      });
      await dualWriteChallengeEnrollmentById(tx, enrollment.id);

      await tx.adminAction.create({
        data: {
          adminUserId: admin.userId,
          targetUserId,
          actionType: "REMOVE_FROM_CHALLENGE",
          reason,
        },
      });
    }, {
      maxWait: 10000,
      timeout: 20000,
    });

    revalidateAdminViews(targetUserId);
    return { ok: true as const };
  } catch (e) {
    return {
      ok: false as const,
      message:
        e instanceof Error ? e.message : "Failed to remove from challenge",
    };
  }
}

export async function rejectSubmissionAction(input: {
  submissionId: string;
  reason?: string;
}) {
  const admin = await requireAdmin();
  const parsed = z
    .object({
      submissionId: z.string().min(1),
      reason: z.string().max(500).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Invalid input" };

  const { submissionId, reason } = parsed.data;

  try {
    let targetUserId = "";

    await withLegacyPointsMirrorFlush(() =>
      writeClient().$transaction(async (tx) => {
      const submission = await tx.submission.findUnique({
        where: { id: submissionId },
        select: {
          id: true,
          userId: true,
          enrollmentId: true,
          dayNumber: true,
          githubUrl: true,
          enrollment: {
            select: {
              id: true,
              startedAt: true,
              challenge: { select: { startsAt: true } },
            },
          },
        },
      });
      if (!submission) throw new Error("Submission not found");

      targetUserId = submission.userId;

      const pointsToRemove = await submissionAwardTotal(tx, {
        submissionIds: [submissionId],
      });
      if (pointsToRemove > 0) {
        const applied = await applyPointsChange(tx, {
          userId: submission.userId,
          amount: -pointsToRemove,
          mode: "debit_clamp",
          sourceType: PointsSourceType.RECONCILIATION,
          sourceId: submissionId,
          idempotencyKey: `reject-submission:${submissionId}`,
          reason:
            "Clamped synergy to 0 after reject removed submission points that were already spent.",
          createdByUserId: admin.userId,
        });
        if (!applied.ok) {
          throw new Error("Failed to adjust points for reject");
        }
      }

      await tx.submission.delete({ where: { id: submissionId } });
      await dualWriteDeleteSubmissionAttempt(tx, submissionId);

      const remainingCount = await tx.submission.count({
        where: { enrollmentId: submission.enrollmentId },
      });

      const lastSubmission = await tx.submission.findFirst({
        where: { enrollmentId: submission.enrollmentId },
        orderBy: { dayNumber: "desc" },
        select: { dayNumber: true },
      });

      await tx.enrollment.update({
        where: { id: submission.enrollmentId },
        data: {
          daysCompleted: remainingCount,
          lastSubmittedDay: lastSubmission?.dayNumber ?? null,
          status: remainingCount >= 60 ? "COMPLETED" : "ACTIVE",
          completedAt: remainingCount >= 60 ? new Date() : null,
        },
      });

      const { currentStreak, longestStreak } = await computeStreakStats(tx, {
        enrollmentId: submission.enrollmentId,
        endDay: getCurrentDayNumber(
          submission.enrollment,
          submission.enrollment.challenge,
        ),
      });

      await tx.enrollment.update({
        where: { id: submission.enrollmentId },
        data: {
          currentStreak,
          longestStreak,
        },
      });
      await dualWriteChallengeEnrollmentById(tx, submission.enrollmentId);

      await tx.adminAction.create({
        data: {
          adminUserId: admin.userId,
          targetUserId,
          actionType: "REJECT_SUBMISSION",
          metadata: {
            submissionId,
            dayNumber: submission.dayNumber,
            githubUrl: submission.githubUrl,
          },
          reason,
        },
      });
    }, {
      maxWait: 10000,
      timeout: 20000,
    }),
    );

    revalidateAdminViews(targetUserId);
    return { ok: true as const };
  } catch (e) {
    return {
      ok: false as const,
      message:
        e instanceof Error ? e.message : "Failed to reject submission",
    };
  }
}

export async function grantSynergyAction(input: {
  targetUserId: string;
  points: number;
  reason?: string;
}) {
  const admin = await requireAdmin();
  const parsed = z
    .object({
      targetUserId: z.string().min(1),
      points: z.coerce.number().int().min(1).max(4000),
      reason: z.string().max(500).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Invalid input" };

  const { targetUserId, points, reason } = parsed.data;

  try {
    await withLegacyPointsMirrorFlush(() =>
      writeClient().$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: targetUserId },
        select: {
          email: true,
          role: true,
          studentProfile: { select: { id: true } },
          hackathonParticipant: { select: { id: true } },
        },
      });
      const targetIsAdmin = await isAdminEmail(target?.email);
      if (
        !target ||
        target.role !== Role.STUDENT ||
        targetIsAdmin ||
        (!target.studentProfile && !target.hackathonParticipant)
      ) {
        throw new Error("Registered student not found");
      }

      const grantId = randomUUID();
      const applied = await applyPointsChange(tx, {
        userId: targetUserId,
        amount: points,
        mode: "credit",
        sourceType: PointsSourceType.ADMIN_GRANT,
        sourceId: grantId,
        idempotencyKey: `admin-grant:${grantId}`,
        reason,
        createdByUserId: admin.userId,
        legacyEvent: {
          type: "COMMUNITY_GRANT",
          createdByAdminId: admin.userId,
        },
      });
      if (!applied.ok) {
        throw new Error("Failed to grant synergy");
      }
      await tx.adminAction.create({
        data: {
          adminUserId: admin.userId,
          targetUserId,
          actionType: "GRANT_SYNERGY",
          metadata: { points },
          reason,
        },
      });
    }),
    );
    revalidateAdminViews(targetUserId);
    return { ok: true as const };
  } catch (error) {
    const message =
      error instanceof Error && error.message === "Registered student not found"
        ? error.message
        : "Grant failed";
    return {
      ok: false as const,
      message,
    };
  }
}
