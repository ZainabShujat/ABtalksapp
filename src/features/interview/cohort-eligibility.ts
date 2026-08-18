import "server-only";
import { prisma } from "@/lib/db";
import { collectPassSkipSets } from "@/features/program/progression";
import {
  BLUEPRINT_SCOPE,
  type InterviewBlueprintKey,
} from "@/features/interview/cohort/blueprint";
import {
  isBlueprintUnlocked,
  missingDaysFor,
} from "@/features/interview/cohort/eligibility-rules";
import type { CohortEligibility } from "@/features/interview/types";

/**
 * Milestone eligibility for the AI Cohort interviews.
 *
 * The rule is deliberately the strictest available reading of "completed":
 * every day in the blueprint's scope must have a PASSED mission submission.
 *
 * Explicitly NOT used as substitutes:
 *   - `cleanPassCount` / any aggregate count — a count of 15 passed days does
 *     not prove days 1..15 specifically were passed
 *   - `progressDay` (highest passed day) — under an admin lock bypass a member
 *     could hold a passed day 20 without days 1..19
 *   - `highestUnlockedDay` / `getMaxContentDay` — availability, not completion
 *   - `cohort.endsAt` — elapsed time is not completed work
 *
 * Everything here is computed on the server from ProgramMissionSubmission rows.
 * No client input participates in the decision.
 */

export {
  BLUEPRINT_SCOPE,
  type InterviewBlueprintKey,
} from "@/features/interview/cohort/blueprint";

/**
 * The unlock rule itself lives in `cohort/eligibility-rules.ts` — pure, and so
 * testable without a database. Re-exported here so callers still have one entry
 * point for "cohort interview eligibility".
 */
export {
  isBlueprintUnlocked,
  missingDaysFor,
  passedScopeCount,
} from "@/features/interview/cohort/eligibility-rules";

export type BlueprintState = {
  /** Curriculum requirement met — every scope day passed. */
  unlocked: boolean;
  /** This interview has already been completed once. Never repeatable. */
  taken: boolean;
  score: number | null;
  /** Scope days not yet passed. Empty when unlocked. */
  missingDays: number[];
  /** An attempt of this blueprint is currently open. */
  inProgressId: string | null;
};

export type CohortInterviewState = {
  day15: BlueprintState;
  day31: BlueprintState;
};

/**
 * Server-authoritative interview state for one member.
 *
 * Two queries, no N+1: mission submissions for the passed-day set, and this
 * member's interviews for taken/in-progress. Both keyed on `memberId` resolved
 * from the session — never from a client-supplied value.
 */
export async function getCohortInterviewState(
  memberId: string,
): Promise<CohortInterviewState> {
  const [submissions, interviews] = await Promise.all([
    prisma.programMissionSubmission.findMany({
      where: { memberId },
      select: { dayNumber: true, passed: true, payload: true },
    }),
    prisma.generalInterview.findMany({
      where: { memberId },
      select: {
        id: true,
        blueprint: true,
        status: true,
        overallScore: true,
        startedAt: true,
      },
    }),
  ]);

  const { passedDays } = collectPassSkipSets(submissions);

  const build = (blueprint: InterviewBlueprintKey): BlueprintState => {
    const forBlueprint = interviews.filter((i) => i.blueprint === blueprint);
    const completed = forBlueprint.find((i) => i.status === "COMPLETED");
    const open = forBlueprint.find((i) => i.status === "IN_PROGRESS");

    return {
      unlocked: isBlueprintUnlocked(blueprint, passedDays),
      taken: Boolean(completed),
      score: completed?.overallScore ?? null,
      missingDays: missingDaysFor(blueprint, passedDays),
      inProgressId: open?.id ?? null,
    };
  };

  return { day15: build("DAY_15"), day31: build("DAY_31") };
}

/**
 * Full eligibility for one blueprint, in the shape the interview screens read.
 *
 * Resolution order matters: an open attempt wins over `taken` and `locked` so a
 * member who is mid-interview is always sent back into it rather than being told
 * they are ineligible.
 */
export async function getBlueprintEligibility(
  memberId: string,
  blueprint: InterviewBlueprintKey,
): Promise<CohortEligibility> {
  const [submissions, interviews] = await Promise.all([
    prisma.programMissionSubmission.findMany({
      where: { memberId },
      select: { dayNumber: true, passed: true, payload: true },
    }),
    prisma.generalInterview.findMany({
      where: { memberId, blueprint },
      select: {
        id: true,
        status: true,
        overallScore: true,
        startedAt: true,
      },
    }),
  ]);

  const open = interviews.find((i) => i.status === "IN_PROGRESS");
  if (open) {
    return {
      state: "in_progress",
      interviewId: open.id,
      startedAt: open.startedAt?.toISOString() ?? null,
    };
  }

  const completed = interviews.find((i) => i.status === "COMPLETED");
  if (completed) {
    return { state: "taken", overallScore: completed.overallScore };
  }

  const { passedDays } = collectPassSkipSets(submissions);
  const missingDays = missingDaysFor(blueprint, passedDays);

  if (missingDays.length > 0) {
    const scope = BLUEPRINT_SCOPE[blueprint];
    const n = missingDays.length;
    return {
      state: "locked",
      reason: `Pass ${n} more cohort ${n === 1 ? "day" : "days"} to unlock this interview.`,
      missingDays,
      passedCount: scope.length - n,
      needed: scope.length,
    };
  }

  return { state: "ready" };
}

export type StartGateResult =
  | { ok: true }
  | { ok: false; message: string; reason: "TAKEN" | "LOCKED" };

/**
 * THE start gate. Nothing may open an interview attempt without passing this.
 *
 * Re-derives eligibility from the database rather than trusting any state the
 * caller already holds, so a stale page, a replayed request, or a forged client
 * payload cannot open a locked or already-taken blueprint. Called immediately
 * before the attempt row is created, inside the same request.
 *
 * Note this does NOT reject `in_progress` — resuming an open attempt is the
 * caller's job and is not a new attempt. It rejects only the two states that
 * must never produce a new row.
 */
export async function assertCanStart(
  memberId: string,
  blueprint: InterviewBlueprintKey,
): Promise<StartGateResult> {
  const eligibility = await getBlueprintEligibility(memberId, blueprint);

  if (eligibility.state === "taken") {
    return {
      ok: false,
      reason: "TAKEN",
      message: "You have already taken this interview.",
    };
  }

  if (eligibility.state === "locked") {
    return { ok: false, reason: "LOCKED", message: eligibility.reason };
  }

  return { ok: true };
}
