import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type {
  AnswerEvidence,
  InterviewPlan,
  InterviewState,
} from "@/features/interview/types";

/**
 * All `MockInterview` database access. Nothing else in the platform touches
 * Prisma for these rows, so the invariants below hold in exactly one place.
 *
 * THE SECURITY POSTURE, stated once:
 *
 *   Every function takes `userId` and puts it in the WHERE clause. Ownership is
 *   part of the query rather than a follow-up check, so another user's attempt
 *   id is indistinguishable from one that does not exist. There is no function
 *   here that can read or write an attempt without being told whose it is, and
 *   `userId` only ever comes from the session (`platform/provider.ts`).
 *
 * WHAT IS DELIBERATELY ABSENT: any unique index or application guard on
 * completion. `GeneralInterview` allows one COMPLETED row per (member,
 * blueprint) because a cohort interview is a credential. A mock interview is
 * practice — unlimited retakes are the feature, and `attemptNumber` records the
 * sequence rather than capping it.
 *
 * Mirrors `features/interview/repository.ts` in structure on purpose: the same
 * IN_PROGRESS-guarded `updateMany`, the same idempotent turn write, the same
 * validate-on-write-and-read discipline. Where the two differ, it is because the
 * rule genuinely differs, and the comment says so.
 */

/** Postgres unique-violation. Raised here only by a replayed turn index. */
const UNIQUE_VIOLATION = "P2002";

/** Column set for reading an attempt back into the engine. */
const ATTEMPT_SELECT = {
  id: true,
  userId: true,
  domainSlug: true,
  packId: true,
  packVersion: true,
  attemptNumber: true,
  plan: true,
  state: true,
  startedAt: true,
  capabilities: true,
} as const;

export type LoadedAttempt = {
  id: string;
  userId: string;
  domainSlug: string;
  packId: string;
  packVersion: number;
  attemptNumber: number;
  plan: InterviewPlan;
  state: InterviewState;
  startedAt: Date | null;
  capabilities: string[];
};

/**
 * Loads an in-progress attempt for a user.
 *
 * Returns null when the row is missing, owned by someone else, no longer
 * IN_PROGRESS, or has no state — every one of which means "not usable" to the
 * caller, and none of which should be distinguishable from outside.
 */
export async function loadActiveAttempt(
  interviewId: string,
  userId: string,
): Promise<LoadedAttempt | null> {
  const row = await prisma.mockInterview.findFirst({
    where: { id: interviewId, userId, status: "IN_PROGRESS" },
    select: ATTEMPT_SELECT,
  });

  if (!row || !row.state) return null;

  return {
    id: row.id,
    userId: row.userId,
    domainSlug: row.domainSlug,
    packId: row.packId,
    packVersion: row.packVersion,
    attemptNumber: row.attemptNumber,
    plan: row.plan as unknown as InterviewPlan,
    state: row.state as unknown as InterviewState,
    startedAt: row.startedAt,
    capabilities: row.capabilities,
  };
}

/** The user's open attempt for one domain, if any. */
export async function findActiveAttemptId(
  userId: string,
  domainSlug: string,
): Promise<string | null> {
  const row = await prisma.mockInterview.findFirst({
    where: { userId, domainSlug, status: "IN_PROGRESS" },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  return row?.id ?? null;
}

/**
 * Any open attempt across all domains.
 *
 * Used to hold a user to one interview at a time. That is not a product rule so
 * much as an operational one: every turn is an LLM call plus STT plus TTS, and
 * `agent/llm/registry.ts` documents that a single interview already needs about
 * thirty model requests. Letting one person run several at once is the cheapest
 * way to exhaust a shared rate limit for everybody else.
 */
export async function findAnyActiveAttempt(
  userId: string,
): Promise<{ id: string; domainSlug: string } | null> {
  const row = await prisma.mockInterview.findFirst({
    where: { userId, status: "IN_PROGRESS" },
    select: { id: true, domainSlug: true },
    orderBy: { createdAt: "desc" },
  });
  return row ?? null;
}

/** Completed attempts for one domain. Drives `maxAttempts`, when a domain sets one. */
export async function countCompletedAttempts(
  userId: string,
  domainSlug: string,
): Promise<number> {
  return prisma.mockInterview.count({
    where: { userId, domainSlug, status: "COMPLETED" },
  });
}

/**
 * The next attempt number for a (user, domain).
 *
 * Counts EVERY prior attempt, not only completed ones, so the number reads as
 * "your third go at this" rather than "your third success". No advisory lock:
 * a duplicate would be cosmetic here — nothing keys off it and no index
 * enforces it — and locking a row per attempt open would cost more than the
 * defect it prevents.
 */
export async function nextAttemptNumber(
  userId: string,
  domainSlug: string,
): Promise<number> {
  const last = await prisma.mockInterview.findFirst({
    where: { userId, domainSlug },
    select: { attemptNumber: true },
    orderBy: { attemptNumber: "desc" },
  });
  return (last?.attemptNumber ?? 0) + 1;
}

/**
 * Opens an attempt.
 *
 * `plan`, `capabilities`, `packId` and `packVersion` are written from
 * server-derived values only. The plan is frozen here so that publishing a new
 * pack version cannot retroactively alter an interview already in flight, and
 * the pack pin is what makes a stored report traceable to the exact questions
 * that were asked.
 */
export async function createAttempt(params: {
  userId: string;
  domainSlug: string;
  packId: string;
  packVersion: number;
  attemptNumber: number;
  capabilities: string[];
  plan: InterviewPlan;
  state: InterviewState;
}): Promise<{ id: string }> {
  return prisma.mockInterview.create({
    data: {
      userId: params.userId,
      domainSlug: params.domainSlug,
      packId: params.packId,
      packVersion: params.packVersion,
      attemptNumber: params.attemptNumber,
      capabilities: params.capabilities,
      status: "IN_PROGRESS",
      plan: params.plan as unknown as Prisma.InputJsonValue,
      state: params.state as unknown as Prisma.InputJsonValue,
      transcript: params.state.transcript as unknown as Prisma.InputJsonValue,
      evidence:
        params.state.evidenceByQuestionId as unknown as Prisma.InputJsonValue,
      startedAt: new Date(),
    },
    select: { id: true },
  });
}

/** One durable audit row. Built by the service from the agent's turn result. */
export type TurnRecord = {
  turnIndex: number;
  questionId: string;
  sectionId: string;
  depthLevel: number;
  action: string;
  promptText: string;
  answerText: string;
  evidence: AnswerEvidence | null;
  degraded: boolean;
  latencyMs?: number;
  /**
   * Plan 103 seams 3 and 6. Always undefined in Phase 1 — no workspace produces
   * artifacts yet and no client events are collected. Present on the type so
   * that adding either is a caller change rather than a schema change.
   */
  artifacts?: unknown;
  clientEvents?: unknown;
};

/**
 * Persists turn progress.
 *
 * `updateMany` with an IN_PROGRESS guard rather than `update`: a turn arriving
 * after the interview closed becomes a no-op instead of resurrecting state onto
 * a finished row. The audit row is written only if the runtime state was
 * actually accepted, so a turn can never hang off an attempt that had closed.
 */
export async function saveTurn(
  interviewId: string,
  userId: string,
  state: InterviewState,
  turn?: TurnRecord,
): Promise<void> {
  const updated = await prisma.mockInterview.updateMany({
    where: { id: interviewId, userId, status: "IN_PROGRESS" },
    data: {
      state: state as unknown as Prisma.InputJsonValue,
      transcript: state.transcript as unknown as Prisma.InputJsonValue,
      evidence: state.evidenceByQuestionId as unknown as Prisma.InputJsonValue,
    },
  });

  if (updated.count === 0 || !turn) return;

  try {
    await prisma.mockInterviewTurn.create({
      data: {
        interviewId,
        turnIndex: turn.turnIndex,
        questionId: turn.questionId,
        sectionId: turn.sectionId,
        depthLevel: turn.depthLevel,
        action: turn.action,
        promptText: turn.promptText.slice(0, 4000),
        answerText: turn.answerText.slice(0, 8000),
        evidence: turn.evidence
          ? (turn.evidence as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        artifacts:
          turn.artifacts === undefined || turn.artifacts === null
            ? Prisma.JsonNull
            : (turn.artifacts as Prisma.InputJsonValue),
        clientEvents:
          turn.clientEvents === undefined || turn.clientEvents === null
            ? Prisma.JsonNull
            : (turn.clientEvents as Prisma.InputJsonValue),
        degraded: turn.degraded,
        latencyMs: turn.latencyMs ?? null,
      },
    });
  } catch (e) {
    // A duplicate turnIndex means a replayed request; the runtime state is
    // already correct and idempotent, so this must not fail the candidate's
    // turn. Anything else is logged and swallowed for the same reason: losing
    // one audit row is bad, losing the interview is worse.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === UNIQUE_VIOLATION
    ) {
      logger.warn("[mock-interview] duplicate turn index ignored", {
        interviewId,
        turnIndex: turn.turnIndex,
      });
      return;
    }
    logger.error("[mock-interview] failed to persist turn", {
      interviewId,
      turnIndex: turn.turnIndex,
      error: String(e),
    });
  }
}

export type LoadedTurn = {
  turnIndex: number;
  questionId: string;
  sectionId: string;
  depthLevel: number;
  action: string;
  promptText: string;
  answerText: string;
  evidence: AnswerEvidence | null;
  degraded: boolean;
};

/** Every recorded turn for an attempt, in order. Scoped through the parent row. */
export async function loadTurns(
  interviewId: string,
  userId: string,
): Promise<LoadedTurn[]> {
  const rows = await prisma.mockInterviewTurn.findMany({
    where: { interviewId, interview: { userId } },
    select: {
      turnIndex: true,
      questionId: true,
      sectionId: true,
      depthLevel: true,
      action: true,
      promptText: true,
      answerText: true,
      evidence: true,
      degraded: true,
    },
    orderBy: { turnIndex: "asc" },
  });

  return rows.map((r) => ({
    ...r,
    evidence: (r.evidence as AnswerEvidence | null) ?? null,
  }));
}

/**
 * Every proctoring payload recorded for an attempt, oldest turn first.
 *
 * Returns the raw column values. Parsing belongs to the proctoring module,
 * which is forgiving by design — this file's job is the query and its
 * ownership scope, and `clientEvents` holds whatever shape was current when the
 * turn was written.
 *
 * Scoped through the parent row like every other read here, so another user's
 * attempt id yields an empty array rather than their events.
 */
export async function loadTurnClientEvents(
  interviewId: string,
  userId: string,
): Promise<unknown[]> {
  const rows = await prisma.mockInterviewTurn.findMany({
    where: { interviewId, interview: { userId } },
    select: { clientEvents: true },
    orderBy: { turnIndex: "asc" },
  });

  return rows
    .map((r) => r.clientEvents)
    .filter((value): value is Prisma.JsonValue => value !== null);
}

/**
 * Next turn index for an attempt.
 *
 * Scoped by `userId` through the parent row, unlike the cohort equivalent which
 * takes only an interview id. The value itself is near-harmless — a turn count
 * for an id you would have to guess — but "every query in this file is scoped"
 * is a property worth being able to state without exceptions, and the cost is
 * one join condition on a query that is already indexed by `interviewId`.
 */
export async function nextTurnIndex(
  interviewId: string,
  userId: string,
): Promise<number> {
  const last = await prisma.mockInterviewTurn.findFirst({
    where: { interviewId, interview: { userId } },
    select: { turnIndex: true },
    orderBy: { turnIndex: "desc" },
  });
  return (last?.turnIndex ?? -1) + 1;
}

export type CompleteAttemptResult =
  | { ok: true }
  | { ok: false; message: string; reason: "NOT_OPEN" | "ERROR" };

/**
 * Completes an attempt: final state, transcript, evidence and scores in one
 * update.
 *
 * One guard, not two. The cohort's `completeAttempt` also handles a P2002 from
 * the milestone index; there is no such index here, so `ALREADY_TAKEN` is not a
 * reachable outcome and is deliberately absent from the result type rather than
 * carried as a case that can never happen.
 */
export async function completeAttempt(
  interviewId: string,
  userId: string,
  params: {
    state: InterviewState;
    competencyScores: Record<string, number>;
    overallScore: number;
    summary: string;
    durationSec: number;
  },
): Promise<CompleteAttemptResult> {
  const now = new Date();

  try {
    const result = await prisma.mockInterview.updateMany({
      where: { id: interviewId, userId, status: "IN_PROGRESS" },
      data: {
        status: "COMPLETED",
        state: params.state as unknown as Prisma.InputJsonValue,
        transcript: params.state.transcript as unknown as Prisma.InputJsonValue,
        evidence:
          params.state.evidenceByQuestionId as unknown as Prisma.InputJsonValue,
        competencyScores:
          params.competencyScores as unknown as Prisma.InputJsonValue,
        overallScore: params.overallScore,
        summary: params.summary || null,
        durationSec: params.durationSec,
        endedAt: now,
        evaluatedAt: now,
      },
    });

    if (result.count === 0) {
      return {
        ok: false,
        reason: "NOT_OPEN",
        message: "This interview is no longer in progress.",
      };
    }

    return { ok: true };
  } catch (e) {
    logger.error("[mock-interview] completeAttempt failed", {
      interviewId,
      error: String(e),
    });
    return {
      ok: false,
      reason: "ERROR",
      message: "Could not save your interview result.",
    };
  }
}

/**
 * Closes an attempt without scoring it.
 *
 * The row keeps its transcript and evidence for audit but never reaches
 * COMPLETED. On the cohort path that is what stops a technical failure burning
 * someone's one attempt; here retakes are unlimited anyway, so the value is
 * narrower — it keeps an abandoned session out of the user's history as a
 * result, and keeps `countCompletedAttempts` honest.
 */
export async function closeAttemptWithoutScoring(
  interviewId: string,
  userId: string,
  status: "ABANDONED" | "INVALID",
  reason: string | null,
): Promise<void> {
  await prisma.mockInterview.updateMany({
    where: { id: interviewId, userId, status: "IN_PROGRESS" },
    data: { status, endedAt: new Date(), invalidReason: reason },
  });
}

/**
 * Marks stale open attempts as ABANDONED.
 *
 * An attempt whose tab was closed leaves an IN_PROGRESS row forever, which
 * would otherwise trip the one-open-attempt rule and lock the user out of the
 * whole catalogue.
 */
export async function abandonStaleAttempts(
  userId: string,
  olderThanMs: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const result = await prisma.mockInterview.updateMany({
    where: { userId, status: "IN_PROGRESS", startedAt: { lt: cutoff } },
    data: {
      status: "ABANDONED",
      endedAt: new Date(),
      invalidReason: "Session went stale and was closed automatically.",
    },
  });
  return result.count;
}

/* ------------------------------------------------------------- the history */

export type AttemptSummary = {
  id: string;
  domainSlug: string;
  attemptNumber: number;
  status: string;
  overallScore: number | null;
  durationSec: number | null;
  evaluatedAt: Date | null;
  createdAt: Date;
  hasReport: boolean;
};

/**
 * The user's attempts, newest first.
 *
 * Retakes are the reason this exists: with one completion per blueprint there
 * was only ever "the result", and a single denormalized row answered it. Here a
 * user can hold many attempts at one domain, so history is a list and a report
 * is addressed by attempt rather than by domain.
 */
export async function listAttempts(
  userId: string,
  limit = 50,
): Promise<AttemptSummary[]> {
  const rows = await prisma.mockInterview.findMany({
    where: { userId, status: { in: ["COMPLETED", "ABANDONED", "INVALID"] } },
    select: {
      id: true,
      domainSlug: true,
      attemptNumber: true,
      status: true,
      overallScore: true,
      durationSec: true,
      evaluatedAt: true,
      createdAt: true,
      report: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map((r) => ({
    id: r.id,
    domainSlug: r.domainSlug,
    attemptNumber: r.attemptNumber,
    status: r.status,
    overallScore: r.overallScore,
    durationSec: r.durationSec,
    evaluatedAt: r.evaluatedAt,
    createdAt: r.createdAt,
    hasReport: r.report !== null,
  }));
}

/* -------------------------------------------------------------- the report */

/**
 * Stores a generated report.
 *
 * `upsert` rather than `create`: regenerating a report for an attempt is a
 * legitimate operation (a narrative outage today should not permanently cost
 * this candidate their prose), and it must replace rather than accumulate.
 *
 * VALIDATION IS THE CALLER'S JOB, and Phase 3 will do it. The cohort repository
 * calls `parseReport` here; the platform's document schema does not exist yet,
 * so this function takes an already-validated document and a pre-extracted
 * score rather than pretending to validate something it has no schema for.
 * Wiring it to a schema that does not exist would be a validation boundary in
 * name only.
 */
export async function saveReport(
  interviewId: string,
  userId: string,
  params: {
    version: number;
    overallScore: number;
    report: unknown;
    narrativeDegraded: boolean;
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const owned = await prisma.mockInterview.findFirst({
    where: { id: interviewId, userId },
    select: { id: true },
  });
  if (!owned) return { ok: false, message: "Interview not found." };

  await prisma.mockInterviewReport.upsert({
    where: { interviewId },
    create: {
      interviewId,
      version: params.version,
      overallScore: params.overallScore,
      report: params.report as Prisma.InputJsonValue,
      narrativeDegraded: params.narrativeDegraded,
    },
    update: {
      version: params.version,
      overallScore: params.overallScore,
      report: params.report as Prisma.InputJsonValue,
      narrativeDegraded: params.narrativeDegraded,
      generatedAt: new Date(),
    },
  });

  return { ok: true };
}

export type LoadedReport = {
  interviewId: string;
  domainSlug: string;
  attemptNumber: number;
  version: number;
  /** Unvalidated. The caller parses it against the document schema (Phase 3). */
  report: unknown;
  generatedAt: Date;
  narrativeDegraded: boolean;
};

/**
 * Reads a stored report back, scoped to its owner.
 *
 * The ownership filter is on the PARENT attempt, so an interview id belonging
 * to someone else resolves to null rather than to their report.
 */
export async function loadReport(
  interviewId: string,
  userId: string,
): Promise<LoadedReport | null> {
  const row = await prisma.mockInterviewReport.findFirst({
    where: { interviewId, interview: { userId } },
    select: {
      version: true,
      report: true,
      generatedAt: true,
      narrativeDegraded: true,
      interview: { select: { id: true, domainSlug: true, attemptNumber: true } },
    },
  });
  if (!row) return null;

  return {
    interviewId: row.interview.id,
    domainSlug: row.interview.domainSlug,
    attemptNumber: row.interview.attemptNumber,
    version: row.version,
    report: row.report,
    generatedAt: row.generatedAt,
    narrativeDegraded: row.narrativeDegraded,
  };
}
