import { formatInTimeZone } from "date-fns-tz";
import { EnrollmentStatus, SubmissionStatus } from "@prisma/client";
import { prisma, writeClient } from "@/lib/db";
import { readDayNumberFromMetadata } from "@/lib/admin-action-metadata";
import {
  getCurrentDayNumber,
  getElapsedDayNumber,
  getIstDateKeyForChallengeDay,
  IST,
} from "@/lib/date-utils";
import { normalizeGithubUrl } from "./validate-github-url";
import { validateSubmissionUrl } from "@/lib/validations/submission";
import { validateLinkedinUrl } from "./validate-linkedin-url";
import { computeStreakStats } from "./streak-utils";
import { resolveChallengeEnrollment } from "@/features/enrollment/resolve-dashboard-enrollment";
import { awardSubmissionSynergy } from "@/features/synergy/award-submission-synergy";
import { withLegacyPointsMirrorFlush } from "@/repositories/points";
import {
  dualWriteCandidateIdentity,
  dualWriteChallengeEnrollmentById,
  dualWriteSubmissionAttempt,
} from "@/repositories/dual-write";

/**
 * Relaxation window: today + previous 4 days = 5 calendar days total.
 * Returns true if `dayNumber` is a PAST day inside the window (i.e. a
 * legitimate backfill target). Today itself is handled by the normal path.
 *
 * Example: currentDay=12 → returns true for dayNumber in {8, 9, 10, 11}.
 * Pre-start (currentDay=0) and Day 1 with no prior days return false.
 */
export function isWithinRelaxationWindow(
  currentDay: number,
  dayNumber: number,
): boolean {
  if (currentDay < 2) return false;
  if (dayNumber < 1 || dayNumber >= currentDay) return false;
  return dayNumber >= currentDay - 4;
}

/** Blocks backfill for past calendar days with no submission, unless admin reject resubmit applies. */
export async function assertPastDaySubmittable(
  enrollment: { id: string; userId: string; startedAt: Date },
  dayNumber: number,
  challenge?: { startsAt: Date | null },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const currentDay = getCurrentDayNumber(enrollment, challenge);
  const elapsedDay = getElapsedDayNumber(enrollment, challenge);
  if (currentDay > 0 && dayNumber >= elapsedDay) return { ok: true };

  const existing = await prisma.submission.findUnique({
    where: {
      enrollmentId_dayNumber: { enrollmentId: enrollment.id, dayNumber },
    },
    select: { id: true },
  });
  if (existing) return { ok: true };

  const actions = await prisma.adminAction.findMany({
    where: {
      targetUserId: enrollment.userId,
      actionType: "REJECT_SUBMISSION",
    },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
    take: 120,
  });
  const hasRejectResubmit = actions.some(
    (a) => readDayNumberFromMetadata(a.metadata) === dayNumber,
  );
  if (hasRejectResubmit) return { ok: true };

  if (isWithinRelaxationWindow(elapsedDay, dayNumber)) return { ok: true };

  return {
    ok: false,
    message:
      "Past missed days cannot be submitted. Open the day from your dashboard heatmap to review the problem.",
  };
}

export type SubmitDayOk = {
  ok: true;
  submissionId: string;
  newStreak: number;
  daysCompleted: number;
  synergyAwarded?: number;
};

export type SubmitDayErr = {
  ok: false;
  reason: string;
  message: string;
};

export type SubmitDayResult = SubmitDayOk | SubmitDayErr;

function trimOrNull(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  return t === "" ? null : t;
}

export async function submitDay(input: {
  userId: string;
  githubUrl?: string | null;
  linkedinUrl?: string | null;
  dayNumber: number;
  enrollmentId?: string | null;
}): Promise<SubmitDayResult> {
  const { userId, dayNumber } = input;
  const githubStored = trimOrNull(input.githubUrl);
  const linkedinStored = trimOrNull(input.linkedinUrl);
  const hasGithub = githubStored !== null;
  const hasLinkedin = linkedinStored !== null;
  const githubNormalized = hasGithub
    ? normalizeGithubUrl(githubStored)
    : null;

  const enrollment = await resolveChallengeEnrollment(
    userId,
    input.enrollmentId ?? undefined,
  );

  if (!enrollment) {
    return { ok: false, reason: "no_enrollment", message: "No active enrollment" };
  }

  const challengeAnchor = enrollment.challenge;

  const task = await prisma.dailyTask.findUnique({
    where: {
      challengeId_dayNumber: {
        challengeId: enrollment.challengeId,
        dayNumber,
      },
    },
    select: { id: true },
  });

  if (!task) {
    return { ok: false, reason: "day_not_found", message: "Day not found" };
  }

  const currentDay = getCurrentDayNumber(enrollment, challengeAnchor);
  if (dayNumber > currentDay) {
    return {
      ok: false,
      reason: "locked",
      message: "This day is not yet unlocked",
    };
  }

  const pastCheck = await assertPastDaySubmittable(enrollment, dayNumber, challengeAnchor);
  if (!pastCheck.ok) {
    return {
      ok: false,
      reason: "past_missed",
      message: pastCheck.message,
    };
  }

  if (hasGithub && githubNormalized) {
    const gh = await validateSubmissionUrl(
      githubNormalized,
      enrollment.domain,
      userId,
      {
        enrollmentId: enrollment.id,
        dayNumber,
      },
    );
    if (!gh.ok) {
      return { ok: false, reason: gh.reason, message: gh.message };
    }
  }

  const li = validateLinkedinUrl(input.linkedinUrl ?? "");
  if (!li.ok) {
    return { ok: false, reason: li.reason, message: li.message };
  }

  const submittedAtIst = formatInTimeZone(new Date(), IST, "yyyy-MM-dd");
  const expectedDate = getIstDateKeyForChallengeDay(
    enrollment,
    dayNumber,
    challengeAnchor,
  );
  const elapsedDay = getElapsedDayNumber(enrollment, challengeAnchor);
  const isBackfill = dayNumber < elapsedDay;
  if (!isBackfill && submittedAtIst !== expectedDate) {
    return {
      ok: false,
      reason: "wrong_day",
      message: `Day ${dayNumber} can only be submitted on its scheduled IST date (${expectedDate}).`,
    };
  }

  const newStatus = SubmissionStatus.ON_TIME;

  try {
    const result = await withLegacyPointsMirrorFlush(() =>
      writeClient().$transaction(async (tx) => {
      const existing = await tx.submission.findUnique({
        where: {
          enrollmentId_dayNumber: {
            enrollmentId: enrollment.id,
            dayNumber,
          },
        },
        select: { id: true },
      });

      let submission;
      let synergyAwarded: number | undefined;

      if (!existing) {
        submission = await tx.submission.create({
          data: {
            userId,
            enrollmentId: enrollment.id,
            dailyTaskId: task.id,
            dayNumber,
            githubUrl: githubNormalized,
            linkedinUrl: linkedinStored,
            status: newStatus,
            submittedAt: new Date(),
          },
        });
        synergyAwarded = await awardSubmissionSynergy(tx, {
          userId,
          submissionId: submission.id,
          enrollmentId: enrollment.id,
          challengeId: enrollment.challengeId,
          dayNumber,
          hasGithub,
          hasLinkedin,
        });
      } else {
        submission = await tx.submission.update({
          where: { id: existing.id },
          data: {
            githubUrl: githubNormalized,
            linkedinUrl: linkedinStored,
            status: newStatus,
            submittedAt: new Date(),
          },
        });
      }

      await dualWriteSubmissionAttempt(tx, {
        id: submission.id,
        enrollmentId: enrollment.id,
        dailyTaskId: task.id,
        githubUrl: githubNormalized,
        linkedinUrl: linkedinStored,
        status: newStatus,
        submittedAt: submission.submittedAt,
        pointsAwarded: synergyAwarded ?? 0,
      });

      const daysCompleted = await tx.submission.count({
        where: { enrollmentId: enrollment.id },
      });

      const { currentStreak: newStreak, longestStreak: recomputedLongest } =
        await computeStreakStats(tx, {
          enrollmentId: enrollment.id,
          endDay: currentDay,
        });
      const completed = daysCompleted >= 60;

      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: {
          daysCompleted,
          currentStreak: newStreak,
          longestStreak: recomputedLongest,
          lastSubmittedDay: Math.max(enrollment.lastSubmittedDay ?? 0, dayNumber),
          ...(completed
            ? {
                status: EnrollmentStatus.COMPLETED,
                completedAt: new Date(),
              }
            : {}),
        },
      });
      await dualWriteChallengeEnrollmentById(tx, enrollment.id);

      if (completed) {
        await tx.studentProfile.updateMany({
          where: { userId },
          data: { isReadyForInterview: true },
        });
        await dualWriteCandidateIdentity(tx, userId, {
          isReadyForInterview: true,
        });
      }

      if (dayNumber >= 7) {
        await tx.referral.updateMany({
          where: { referredId: userId, rewardGiven: false },
          data: { rewardGiven: true },
        });
      }

      return {
        submissionId: submission.id,
        newStreak,
        daysCompleted,
        synergyAwarded,
      };
    }, {
      maxWait: 10000,
      timeout: 20000,
    }),
    );

    return { ok: true, ...result };
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? String((e as { code: string }).code)
        : "";
    if (code === "P2002") {
      return {
        ok: false,
        reason: "duplicate",
        message: "This URL has been submitted by another student",
      };
    }
    throw e;
  }
}
