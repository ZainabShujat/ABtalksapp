import {
  INTERVIEW_MIN_COMPLETED_DAYS,
  INTERVIEW_RETAKE_NEW_DAYS,
  INTERVIEW_STALE_MS,
} from "@/features/interview/constants";
import type {
  InterviewEligibility,
  InterviewStatus,
} from "@/features/interview/types";

/**
 * Attempt/retake rules. Entirely deterministic — no model input.
 *
 * A retake unlocks on NEW completed challenge work, never on elapsed time.
 * Each completed attempt records the exact submission ids it consumed, so
 * eligibility is a set difference:
 *
 *   eligible = all completed submissions − union(consumed by prior attempts)
 *
 * That satisfies every constraint at once: progress combines freely across
 * challenges, the same day can never count twice, waiting alone changes
 * nothing, and abandoned/invalid sessions consume nothing because ids are
 * recorded only on the transition to COMPLETED.
 */

export type PriorAttempt = {
  attemptNumber: number;
  status: InterviewStatus;
  /** Populated only for COMPLETED attempts. */
  consumedSubmissionIds: string[];
  startedAt: Date | null;
};

export function computeEligibility(
  completedSubmissionIds: string[],
  priorAttempts: PriorAttempt[],
): InterviewEligibility {
  const live = priorAttempts.find(
    (a) =>
      a.status === "IN_PROGRESS" &&
      a.startedAt !== null &&
      Date.now() - a.startedAt.getTime() < INTERVIEW_STALE_MS,
  );
  if (live?.startedAt) {
    return { state: "in_progress", startedAt: live.startedAt.toISOString() };
  }

  const consumed = new Set(
    priorAttempts
      .filter((a) => a.status === "COMPLETED")
      .flatMap((a) => a.consumedSubmissionIds),
  );

  const eligibleSubmissionIds = completedSubmissionIds.filter(
    (id) => !consumed.has(id),
  );

  const completedAttempts = priorAttempts.filter(
    (a) => a.status === "COMPLETED",
  ).length;
  const attemptNumber = completedAttempts + 1;

  if (completedAttempts === 0) {
    if (eligibleSubmissionIds.length < INTERVIEW_MIN_COMPLETED_DAYS) {
      return {
        state: "locked",
        reason: `Complete ${INTERVIEW_MIN_COMPLETED_DAYS} challenge days to unlock your AB Talks interview.`,
        completedDays: eligibleSubmissionIds.length,
        needed: INTERVIEW_MIN_COMPLETED_DAYS,
      };
    }
    return { state: "ready", attemptNumber, eligibleSubmissionIds };
  }

  if (eligibleSubmissionIds.length < INTERVIEW_RETAKE_NEW_DAYS) {
    return {
      state: "retake_locked",
      reason: `Complete ${INTERVIEW_RETAKE_NEW_DAYS} new challenge days since your last interview to unlock a retake.`,
      newDaysSinceLastAttempt: eligibleSubmissionIds.length,
      needed: INTERVIEW_RETAKE_NEW_DAYS,
    };
  }

  return { state: "ready", attemptNumber, eligibleSubmissionIds };
}
