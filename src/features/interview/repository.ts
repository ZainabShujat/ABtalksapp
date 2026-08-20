import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { InterviewBlueprintKey } from "@/features/interview/cohort/blueprint";
import { scopeDaysFor } from "@/features/interview/cohort/planner";
import type {
  AnswerEvidence,
  InterviewPlan,
  InterviewScores,
  InterviewState,
  InterviewStatus,
} from "@/features/interview/types";
import {
  parseReport,
  type InterviewReportDocument,
} from "@/features/interview/report-assembly";

/**
 * All `GeneralInterview` database access. Nothing else in the module touches
 * Prisma for interview rows, so these invariants hold in one place.
 *
 * Rewritten for the post-Day-1 schema. The previous version implemented the
 * 60-day challenge's submission-consumption retake model — `attemptNumber`,
 * `eligibleSubmissionIds`, `consumedSubmissionIds`, and a per-user advisory
 * lock to serialize attempt numbering. All four columns are gone, and so is the
 * mechanism: V1 is one completed interview per member per blueprint, and the
 * partial unique index
 *
 *   GeneralInterview_one_completed_per_blueprint
 *     ON (memberId, blueprint) WHERE status = 'COMPLETED'
 *
 * is the source of truth for it. That is strictly stronger than the old
 * application-level lock — it holds even against a request that bypasses this
 * module entirely, and it is why ABANDONED and INVALID attempts consume nothing
 * and may repeat freely.
 *
 * Every function is scoped by `memberId`. Ownership is part of the WHERE clause
 * rather than a follow-up check, so another member's interview id is
 * indistinguishable from a nonexistent one.
 */

/** Postgres unique-violation. Raised by the partial index on second completion. */
const UNIQUE_VIOLATION = "P2002";

export type LoadedAttempt = {
  id: string;
  blueprint: InterviewBlueprintKey;
  plan: InterviewPlan;
  state: InterviewState;
  startedAt: Date | null;
};

/**
 * Loads an in-progress attempt for a member. Returns null when the row is
 * missing, owned by someone else, no longer IN_PROGRESS, or has no state —
 * every one of which means "not resumable" to the caller.
 */
export async function loadActiveAttempt(
  interviewId: string,
  memberId: string,
): Promise<LoadedAttempt | null> {
  const row = await prisma.generalInterview.findFirst({
    where: { id: interviewId, memberId, status: "IN_PROGRESS" },
    select: {
      id: true,
      blueprint: true,
      plan: true,
      state: true,
      startedAt: true,
    },
  });

  if (!row || !row.state) return null;

  return {
    id: row.id,
    blueprint: row.blueprint as InterviewBlueprintKey,
    plan: row.plan as unknown as InterviewPlan,
    state: row.state as unknown as InterviewState,
    startedAt: row.startedAt,
  };
}

/** The member's open attempt for one blueprint, if any. */
export async function findActiveAttemptId(
  memberId: string,
  blueprint: InterviewBlueprintKey,
): Promise<string | null> {
  const row = await prisma.generalInterview.findFirst({
    where: { memberId, blueprint, status: "IN_PROGRESS" },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  return row?.id ?? null;
}

/** True when this member already holds a completed interview for a blueprint. */
export async function hasCompletedAttempt(
  memberId: string,
  blueprint: InterviewBlueprintKey,
): Promise<boolean> {
  const row = await prisma.generalInterview.findFirst({
    where: { memberId, blueprint, status: "COMPLETED" },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Opens an attempt.
 *
 * `plan` and `scopeDays` are written from server-derived values only. The plan
 * is frozen here so that changing the question bank later cannot retroactively
 * alter an interview already in flight, and `scopeDays` records which
 * curriculum window the attempt covered for provenance — it is never read back
 * to decide eligibility.
 */
export async function createAttempt(
  memberId: string,
  blueprint: InterviewBlueprintKey,
  plan: InterviewPlan,
  state: InterviewState,
): Promise<{ id: string }> {
  return prisma.generalInterview.create({
    data: {
      memberId,
      blueprint,
      status: "IN_PROGRESS",
      plan: plan as unknown as Prisma.InputJsonValue,
      state: state as unknown as Prisma.InputJsonValue,
      transcript: state.transcript as unknown as Prisma.InputJsonValue,
      evidence: state.evidenceByQuestionId as unknown as Prisma.InputJsonValue,
      scopeDays: scopeDaysFor(blueprint),
      startedAt: new Date(),
    },
    select: { id: true },
  });
}

/**
 * Persists turn progress. `transcript` and `evidence` are projections of the
 * same state object, kept as columns so admin reads don't have to parse state.
 *
 * `updateMany` with an IN_PROGRESS guard rather than `update`: a turn arriving
 * after the interview closed becomes a no-op instead of resurrecting state onto
 * a finished row.
 */
export async function saveTurn(
  interviewId: string,
  memberId: string,
  state: InterviewState,
  turn?: TurnRecord,
): Promise<void> {
  const updated = await prisma.generalInterview.updateMany({
    where: { id: interviewId, memberId, status: "IN_PROGRESS" },
    data: {
      state: state as unknown as Prisma.InputJsonValue,
      transcript: state.transcript as unknown as Prisma.InputJsonValue,
      evidence: state.evidenceByQuestionId as unknown as Prisma.InputJsonValue,
    },
  });

  // The audit row is written only if the runtime state was actually accepted.
  // Writing it unconditionally would leave turns hanging off an interview that
  // had already closed, and a report is only as trustworthy as the trail
  // behind it.
  if (updated.count === 0 || !turn) return;

  try {
    await prisma.interviewTurn.create({
      data: {
        interviewId,
        turnIndex: turn.turnIndex,
        questionId: turn.questionId,
        tier: turn.tier,
        depthLevel: turn.depthLevel,
        action: turn.action,
        promptText: turn.promptText.slice(0, 4000),
        answerText: turn.answerText.slice(0, 8000),
        evidence: turn.evidence
          ? (turn.evidence as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
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
      logger.warn("[interview] duplicate turn index ignored", {
        interviewId,
        turnIndex: turn.turnIndex,
      });
      return;
    }
    logger.error("[interview] failed to persist turn", {
      interviewId,
      turnIndex: turn.turnIndex,
      error: String(e),
    });
  }
}

/** One durable audit row. Built by the service from the agent's turn result. */
export type TurnRecord = {
  turnIndex: number;
  questionId: string;
  tier: "CORE" | "EXTENSION";
  depthLevel: number;
  action: string;
  promptText: string;
  answerText: string;
  evidence: AnswerEvidence | null;
  degraded: boolean;
  latencyMs?: number;
};

/** Every recorded turn for an interview, in order. */
export async function loadTurns(
  interviewId: string,
  memberId: string,
): Promise<
  {
    turnIndex: number;
    questionId: string;
    tier: string;
    depthLevel: number;
    action: string;
    promptText: string;
    answerText: string;
    evidence: AnswerEvidence | null;
    degraded: boolean;
  }[]
> {
  const rows = await prisma.interviewTurn.findMany({
    where: { interviewId, interview: { memberId } },
    select: {
      turnIndex: true,
      questionId: true,
      tier: true,
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

/** Next turn index for an interview. */
export async function nextTurnIndex(interviewId: string): Promise<number> {
  const last = await prisma.interviewTurn.findFirst({
    where: { interviewId },
    select: { turnIndex: true },
    orderBy: { turnIndex: "desc" },
  });
  return (last?.turnIndex ?? -1) + 1;
}

export type CompleteAttemptResult =
  | { ok: true }
  | { ok: false; message: string; reason: "NOT_OPEN" | "ALREADY_TAKEN" | "ERROR" };

/**
 * Completes an attempt: writes final state, transcript, evidence and scores in
 * one update.
 *
 * Two guards, both necessary:
 *
 *   1. `status: "IN_PROGRESS"` in the WHERE clause makes a replayed completion
 *      a no-op rather than a second write.
 *   2. The partial unique index rejects a second COMPLETED row for the same
 *      (member, blueprint) at the database level. A P2002 here is not a bug —
 *      it is the milestone limit doing its job under a race, and it is reported
 *      as ALREADY_TAKEN rather than a server error.
 *
 * No advisory lock is needed. The old one existed only to serialize
 * `attemptNumber = max + 1`, a computation this schema no longer performs.
 */
export async function completeAttempt(
  interviewId: string,
  memberId: string,
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

  const now = new Date();

  try {
    const result = await prisma.generalInterview.updateMany({
      where: { id: interviewId, memberId, status: "IN_PROGRESS" },
      data: {
        status: "COMPLETED",
        state: state as unknown as Prisma.InputJsonValue,
        transcript: state.transcript as unknown as Prisma.InputJsonValue,
        evidence: state.evidenceByQuestionId as unknown as Prisma.InputJsonValue,
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

    if (result.count === 0) {
      return {
        ok: false,
        reason: "NOT_OPEN",
        message: "This interview is no longer in progress.",
      };
    }

    return { ok: true };
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === UNIQUE_VIOLATION
    ) {
      logger.warn("[interview] completion blocked by milestone limit", {
        interviewId,
        memberId,
      });
      return {
        ok: false,
        reason: "ALREADY_TAKEN",
        message: "You have already completed this interview.",
      };
    }

    logger.error("[interview] completeAttempt failed", {
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
 * Closes an attempt without consuming the milestone.
 *
 * The row keeps its transcript and evidence for audit, but never reaches
 * COMPLETED, so the partial unique index does not see it and the member may
 * take the interview again. This is what makes a dropped connection or a
 * technical failure structurally incapable of burning someone's one attempt.
 */
export async function closeAttemptWithoutConsuming(
  interviewId: string,
  memberId: string,
  status: Extract<InterviewStatus, "ABANDONED" | "INVALID">,
  reason: string | null,
): Promise<void> {
  await prisma.generalInterview.updateMany({
    where: { id: interviewId, memberId, status: "IN_PROGRESS" },
    data: { status, endedAt: new Date(), invalidReason: reason },
  });
}

export type AttemptResult = {
  blueprint: InterviewBlueprintKey;
  overallScore: number | null;
  conceptualScore: number | null;
  practicalScore: number | null;
  problemSolvingScore: number | null;
  technicalDepthScore: number | null;
  communicationScore: number | null;
  summary: string | null;
  durationSec: number | null;
  evaluatedAt: Date | null;
};

/** The member's completed result for one blueprint, if they have one. */
export async function loadCompletedResult(
  memberId: string,
  blueprint: InterviewBlueprintKey,
): Promise<AttemptResult | null> {
  const row = await prisma.generalInterview.findFirst({
    where: { memberId, blueprint, status: "COMPLETED" },
    select: {
      blueprint: true,
      overallScore: true,
      conceptualScore: true,
      practicalScore: true,
      problemSolvingScore: true,
      technicalDepthScore: true,
      communicationScore: true,
      summary: true,
      durationSec: true,
      evaluatedAt: true,
    },
  });

  if (!row) return null;
  return { ...row, blueprint: row.blueprint as InterviewBlueprintKey };
}

/**
 * Marks stale open attempts as ABANDONED.
 *
 * An interview whose tab was closed leaves an IN_PROGRESS row forever, which
 * would otherwise block the member from ever starting again. Sweeping them
 * costs nothing — abandoned attempts consume no milestone.
 */
export async function abandonStaleAttempts(
  memberId: string,
  olderThanMs: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const result = await prisma.generalInterview.updateMany({
    where: {
      memberId,
      status: "IN_PROGRESS",
      startedAt: { lt: cutoff },
    },
    data: {
      status: "ABANDONED",
      endedAt: new Date(),
      invalidReason: "Session went stale and was closed automatically.",
    },
  });
  return result.count;
}


/* ------------------------------------------------------------- the report */

/**
 * Stores the generated report.
 *
 * `upsert` rather than `create`: regenerating a report for an interview is a
 * legitimate operation (a narrative model outage today should not permanently
 * cost this candidate their prose), and it must replace rather than accumulate.
 * The interview row itself is untouched — the report is derived data, and the
 * interview stays the source of truth for what happened.
 */
export async function saveReport(
  interviewId: string,
  memberId: string,
  report: InterviewReportDocument,
): Promise<{ ok: true } | { ok: false; message: string }> {
  // Validate on WRITE. A document that cannot be parsed back is a document
  // that will render as "unavailable" later, and it is far cheaper to refuse
  // it here than to discover it on the candidate's screen.
  const validated = parseReport(report);
  if (!validated.ok) {
    logger.error("[interview-report] refused to store invalid report", {
      interviewId,
      message: validated.message,
    });
    return { ok: false, message: "Generated report failed validation." };
  }

  const owned = await prisma.generalInterview.findFirst({
    where: { id: interviewId, memberId },
    select: { id: true },
  });
  if (!owned) return { ok: false, message: "Interview not found." };

  await prisma.interviewReport.upsert({
    where: { interviewId },
    create: {
      interviewId,
      version: report.version,
      overallScore: report.overall.score,
      report: report as unknown as Prisma.InputJsonValue,
      narrativeDegraded: report.narrativeDegraded,
    },
    update: {
      version: report.version,
      overallScore: report.overall.score,
      report: report as unknown as Prisma.InputJsonValue,
      narrativeDegraded: report.narrativeDegraded,
      generatedAt: new Date(),
    },
  });

  return { ok: true };
}

export type LoadedReport = {
  report: InterviewReportDocument;
  generatedAt: Date;
  narrativeDegraded: boolean;
};

/**
 * Reads a stored report back, scoped to its owner.
 *
 * Validated on READ as well as on write: this column outlives any single
 * deploy, so a row written against an older shape must degrade to "unavailable"
 * rather than crash the page rendering it.
 */
export async function loadReport(
  interviewId: string,
  memberId: string,
): Promise<LoadedReport | null> {
  const row = await prisma.interviewReport.findFirst({
    where: { interviewId, interview: { memberId } },
    select: { report: true, generatedAt: true, narrativeDegraded: true },
  });
  if (!row) return null;

  const parsed = parseReport(row.report);
  if (!parsed.ok) {
    logger.error("[interview-report] stored report failed validation on read", {
      interviewId,
      message: parsed.message,
    });
    return null;
  }

  return {
    report: parsed.data,
    generatedAt: row.generatedAt,
    narrativeDegraded: row.narrativeDegraded,
  };
}

/** The report for a member's completed blueprint, if one exists. */
export async function loadReportForBlueprint(
  memberId: string,
  blueprint: InterviewBlueprintKey,
): Promise<LoadedReport | null> {
  const interview = await prisma.generalInterview.findFirst({
    where: { memberId, blueprint, status: "COMPLETED" },
    select: { id: true },
    orderBy: { evaluatedAt: "desc" },
  });
  if (!interview) return null;
  return loadReport(interview.id, memberId);
}
