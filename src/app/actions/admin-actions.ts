"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { Role, type Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isAdminEmail, requireAdmin } from "@/lib/admin-auth";
import { getCurrentDayNumber } from "@/lib/date-utils";
import { computeStreakStats } from "@/features/submission/streak-utils";
import { sendChallengeResetEmail } from "@/features/email/challenge-reset-email";

const baseInput = z.object({
  targetUserId: z.string().min(1),
  reason: z.string().max(500).optional(),
});

async function debitSynergyNotBelowZero(
  tx: Prisma.TransactionClient,
  userId: string,
  pointsToRemove: number,
): Promise<number> {
  const locked = await tx.user.update({
    where: { id: userId },
    data: { synergyPoints: { increment: 0 } },
    select: { synergyPoints: true },
  });
  const actualDebit = Math.min(pointsToRemove, Math.max(locked.synergyPoints, 0));
  if (actualDebit > 0) {
    await tx.user.update({
      where: { id: userId },
      data: { synergyPoints: { decrement: actualDebit } },
    });
    const profile = await tx.studentProfile.findUnique({
      where: { userId },
      select: { synergyPoints: true },
    });
    if (profile) {
      await tx.studentProfile.update({
        where: { userId },
        data: { synergyPoints: Math.max(0, profile.synergyPoints - actualDebit) },
      });
    }
  }
  return Math.max(pointsToRemove - actualDebit, 0);
}

async function recordSpentSynergyClamp(
  tx: Prisma.TransactionClient,
  userId: string,
  shortfall: number,
  reason: string,
) {
  if (shortfall <= 0) return;
  await tx.synergyEvent.create({
    data: {
      userId,
      points: shortfall,
      type: "BALANCE_RECONCILIATION",
      reason,
    },
  });
}

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
    await prisma.$transaction(async (tx) => {
      const enrollment = await tx.enrollment.findFirst({
        where: { userId: targetUserId },
      });
      if (!enrollment) throw new Error("No enrollment");
      resetDomain = enrollment.domain;

      // Serialize reset against every balance writer before reading the ledger.
      await tx.user.update({
        where: { id: targetUserId },
        data: { synergyPoints: { increment: 0 } },
        select: { id: true },
      });

      const removedSynergy = await tx.synergyEvent.aggregate({
        where: {
          enrollmentId: enrollment.id,
          type: "SUBMISSION",
        },
        _sum: { points: true },
      });
      const pointsToRemove = removedSynergy._sum.points ?? 0;
      const spentShortfall =
        pointsToRemove > 0
          ? await debitSynergyNotBelowZero(tx, targetUserId, pointsToRemove)
          : 0;

      await tx.submission.deleteMany({
        where: { enrollmentId: enrollment.id },
      });
      await recordSpentSynergyClamp(
        tx,
        targetUserId,
        spentShortfall,
        "Clamped synergy to 0 after reset removed submission points that were already spent.",
      );

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

      await tx.studentProfile.updateMany({
        where: { userId: targetUserId },
        data: { isReadyForInterview: false },
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
    });

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
    const profile = await prisma.studentProfile.findUnique({
      where: { userId: targetUserId },
      select: { isReadyForInterview: true },
    });
    if (!profile) throw new Error("Profile not found");

    const newValue = !profile.isReadyForInterview;

    await prisma.$transaction(async (tx) => {
      await tx.studentProfile.update({
        where: { userId: targetUserId },
        data: { isReadyForInterview: newValue },
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
    await prisma.$transaction(async (tx) => {
      const enrollment = await tx.enrollment.findFirst({
        where: { userId: targetUserId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!enrollment) throw new Error("No active enrollment");

      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: { status: "ABANDONED" },
      });

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

    await prisma.$transaction(async (tx) => {
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

      const event = await tx.synergyEvent.findUnique({
        where: { submissionId },
        select: { points: true },
      });
      const spentShortfall =
        event && event.points > 0
          ? await debitSynergyNotBelowZero(tx, submission.userId, event.points)
          : 0;

      await tx.submission.delete({ where: { id: submissionId } });
      await recordSpentSynergyClamp(
        tx,
        submission.userId,
        spentShortfall,
        "Clamped synergy to 0 after reject removed submission points that were already spent.",
      );

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
    });

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
      points: z.coerce.number().int().min(1).max(3000),
      reason: z.string().max(500).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Invalid input" };

  const { targetUserId, points, reason } = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
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

      await tx.synergyEvent.create({
        data: {
          userId: targetUserId,
          points,
          type: "COMMUNITY_GRANT",
          reason,
          createdByAdminId: admin.userId,
        },
      });
      await tx.user.update({
        where: { id: targetUserId },
        data: { synergyPoints: { increment: points } },
      });
      await tx.studentProfile.updateMany({
        where: { userId: targetUserId },
        data: { synergyPoints: { increment: points } },
      });
      await tx.adminAction.create({
        data: {
          adminUserId: admin.userId,
          targetUserId,
          actionType: "GRANT_SYNERGY",
          metadata: { points },
          reason,
        },
      });
    });
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
