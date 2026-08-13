import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { PriorAttempt } from "@/features/interview/eligibility";
import type {
  InterviewPlan,
  InterviewScores,
  InterviewState,
  InterviewStatus,
} from "@/features/interview/types";

/**
 * All GeneralInterview database access. Nothing else in the module touches
 * Prisma for interview rows, so these invariants hold in one place:
 *
 *   - `consumedSubmissionIds` is written ONLY on the transition to COMPLETED
 *   - it is copied from the row's own `eligibleSubmissionIds`, never from input
 *   - `attemptNumber` is assigned ONLY on that same transition, atomically
 *   - ABANDONED / INVALID touch none of the above, so they cannot consume
 *     challenge progress
 */

/**
 * Prior attempts for the retake rule. This is the production source of
 * `PriorAttempt[]` — callers never assemble it by hand.
 */
export async function loadPriorAttempts(
  userId: string,
): Promise<PriorAttempt[]> {
  const rows = await prisma.generalInterview.findMany({
    where: { userId },
    select: {
      attemptNumber: true,
      status: true,
      consumedSubmissionIds: true,
      startedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row) => ({
    attemptNumber: row.attemptNumber ?? 0,
    status: row.status as InterviewStatus,
    consumedSubmissionIds: row.consumedSubmissionIds,
    startedAt: row.startedAt,
  }));
}

export type LoadedAttempt = {
  id: string;
  plan: InterviewPlan;
  state: InterviewState;
  startedAt: Date | null;
};

/**
 * Loads an in-progress attempt, scoped to its owner. Ownership is part of the
 * WHERE clause rather than a follow-up check, so another user's interview id is
 * indistinguishable from a nonexistent one.
 */
export async function loadActiveAttemptForUser(
  interviewId: string,
  userId: string,
): Promise<LoadedAttempt | null> {
  const row = await prisma.generalInterview.findFirst({
    where: { id: interviewId, userId, status: "IN_PROGRESS" },
    select: { id: true, plan: true, state: true, startedAt: true },
  });

  if (!row || !row.state) return null;

  return {
    id: row.id,
    plan: row.plan as unknown as InterviewPlan,
    state: row.state as unknown as InterviewState,
    startedAt: row.startedAt,
  };
}

export async function findActiveAttemptId(
  userId: string,
): Promise<string | null> {
  const row = await prisma.generalInterview.findFirst({
    where: { userId, status: "IN_PROGRESS" },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  return row?.id ?? null;
}

/**
 * Opens an attempt. `attemptNumber` stays null until completion; the entitled
 * submissions are frozen here, server-side.
 */
export async function createAttempt(
  userId: string,
  plan: InterviewPlan,
  state: InterviewState,
  eligibleSubmissionIds: string[],
): Promise<{ id: string }> {
  return prisma.generalInterview.create({
    data: {
      userId,
      status: "IN_PROGRESS",
      plan: plan as unknown as Prisma.InputJsonValue,
      state: state as unknown as Prisma.InputJsonValue,
      transcript: state.transcript as unknown as Prisma.InputJsonValue,
      evidence: state.evidenceByQuestionId as unknown as Prisma.InputJsonValue,
      eligibleSubmissionIds,
      startedAt: new Date(),
    },
    select: { id: true },
  });
}

/**
 * Persists turn progress. `transcript` and `evidence` are projections of the
 * same state object, kept as columns so admin reads don't have to parse state.
 */
export async function saveTurn(
  interviewId: string,
  state: InterviewState,
): Promise<void> {
  await prisma.generalInterview.updateMany({
    where: { id: interviewId, status: "IN_PROGRESS" },
    data: {
      state: state as unknown as Prisma.InputJsonValue,
      transcript: state.transcript as unknown as Prisma.InputJsonValue,
      evidence: state.evidenceByQuestionId as unknown as Prisma.InputJsonValue,
    },
  });
}

export type CompleteAttemptResult =
  | { ok: true; attemptNumber: number }
  | { ok: false; message: string };

/**
 * Completes an attempt: assigns the attempt number, consumes the entitled
 * submissions, and writes final scores — all in one transaction.
 *
 * Attempt numbering is serialized per user by a Postgres transaction-scoped
 * advisory lock, so two interviews finishing at the same instant cannot compute
 * the same max+1. `pg_advisory_xact_lock` (rather than a session lock) is
 * required because it releases on commit and is therefore safe under Neon's
 * pooled connections. `@@unique([userId, attemptNumber])` remains as a backstop.
 *
 * `consumedSubmissionIds` is read from the row itself inside the transaction —
 * never from a parameter — so nothing a client sends can change what an
 * interview costs. The IN_PROGRESS guard makes a replayed completion a no-op
 * rather than a second consumption.
 */
export async function completeAttempt(
  interviewId: string,
  userId: string,
  params: {
    state: InterviewState;
    scores: InterviewScores;
    durationSec: number;
  },
): Promise<CompleteAttemptResult> {
  const { scores, state } = params;
  const byCompetency = new Map(
    scores.perCompetency.map((entry) => [entry.competency, entry.score]),
  );

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

      const row = await tx.generalInterview.findFirst({
        where: { id: interviewId, userId, status: "IN_PROGRESS" },
        select: { eligibleSubmissionIds: true },
      });

      if (!row) {
        return {
          ok: false as const,
          message: "This interview is no longer in progress.",
        };
      }

      const agg = await tx.generalInterview.aggregate({
        where: { userId, attemptNumber: { not: null } },
        _max: { attemptNumber: true },
      });
      const attemptNumber = (agg._max.attemptNumber ?? 0) + 1;

      const now = new Date();
      await tx.generalInterview.update({
        where: { id: interviewId },
        data: {
          status: "COMPLETED",
          attemptNumber,
          consumedSubmissionIds: row.eligibleSubmissionIds,
          state: state as unknown as Prisma.InputJsonValue,
          transcript: state.transcript as unknown as Prisma.InputJsonValue,
          evidence:
            state.evidenceByQuestionId as unknown as Prisma.InputJsonValue,
          durationSec: params.durationSec,
          conceptualScore: byCompetency.get("CONCEPTUAL") ?? null,
          practicalScore: byCompetency.get("PRACTICAL") ?? null,
          problemSolvingScore: byCompetency.get("PROBLEM_SOLVING") ?? null,
          technicalDepthScore: byCompetency.get("TECHNICAL_DEPTH") ?? null,
          communicationScore: byCompetency.get("COMMUNICATION") ?? null,
          overallScore: scores.overallScore,
          summary: scores.summary || null,
          endedAt: now,
          evaluatedAt: now,
        },
      });

      return { ok: true as const, attemptNumber };
    });
  } catch (e) {
    logger.error("[interview] completeAttempt failed", {
      interviewId,
      error: String(e),
    });
    return { ok: false, message: "Could not save your interview result." };
  }
}

/**
 * Closes an attempt without consuming anything. `consumedSubmissionIds` and
 * `attemptNumber` are untouched, so the candidate keeps every challenge day
 * toward their next attempt.
 */
export async function closeAttemptWithoutConsuming(
  interviewId: string,
  status: Extract<InterviewStatus, "ABANDONED" | "INVALID">,
  reason: string | null,
): Promise<void> {
  await prisma.generalInterview.updateMany({
    where: { id: interviewId, status: "IN_PROGRESS" },
    data: { status, endedAt: new Date(), invalidReason: reason },
  });
}

/** Latest completed attempt, for the pre-interview screen. */
export async function loadLatestResult(userId: string) {
  return prisma.generalInterview.findFirst({
    where: { userId, status: "COMPLETED" },
    select: {
      attemptNumber: true,
      overallScore: true,
      conceptualScore: true,
      practicalScore: true,
      problemSolvingScore: true,
      technicalDepthScore: true,
      communicationScore: true,
      summary: true,
      evaluatedAt: true,
    },
    orderBy: { attemptNumber: "desc" },
  });
}
