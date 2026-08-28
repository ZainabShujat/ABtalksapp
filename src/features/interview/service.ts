import "server-only";
import { logger } from "@/lib/logger";
import {
  COHORT_INTERVIEW_DURATION_SEC,
  COHORT_INTERVIEW_MIN_ANSWERED_CORE,
  COHORT_INTERVIEW_MIN_DURATION_SEC,
  COHORT_INTERVIEW_STALE_MS,
} from "@/features/interview/constants";
import type { InterviewBlueprintKey } from "@/features/interview/cohort/blueprint";
import { questionCountFor } from "@/features/interview/cohort/question-bank";
import {
  beginInterview,
  finalizeInterview,
  submitAnswer,
} from "@/features/interview/orchestrator";
import {
  abandonStaleAttempts,
  closeAttemptWithoutConsuming,
  completeAttempt,
  createAttempt,
  findActiveAttemptId,
  loadActiveAttempt,
  loadCompletedResult,
  loadReport,
  loadReportForBlueprint,
  loadTurns,
  nextTurnIndex,
  saveReport,
  saveTurn,
  type LoadedReport,
  type TurnRecord,
} from "@/features/interview/repository";
import { buildCohortCandidateContext } from "@/features/interview/cohort/candidate-context";
import { buildInterviewReport } from "@/features/interview/report";
import { coreProgressFor, type CoreProgress } from "@/features/interview/report-analysis";
import { askForReport } from "@/features/interview/report-provider";
import { scopeDaysFor } from "@/features/interview/cohort/planner";
import {
  buildCohortPlan,
  gateStart,
  resolveCohortEligibility,
} from "@/features/interview/session";
import { createInitialState, getCurrentQuestion } from "@/features/interview/state";
import type { AgentAction } from "@/features/interview/agent";
import type {
  CohortEligibility,
  InterviewScores,
  PlannedQuestion,
} from "@/features/interview/types";

/**
 * The AI Cohort interview flow. Server Actions call only these functions and
 * pass only ids — never a plan, state, score, blueprint the server did not
 * validate, or question index.
 *
 * The security posture, stated once:
 *
 *   - `memberId` is always resolved from the session, never from a payload
 *   - the blueprint is validated against the enum before it reaches here
 *   - eligibility is re-derived from the database at start, not carried
 *   - plan and state are reloaded from the row on every turn
 *   - duration is computed from the persisted `startedAt`
 *   - an answer must match the question the SERVER believes is open
 *
 * The only thing a client contributes to an interview is the text of an answer.
 */

export type { CoreProgress };

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

/**
 * What the client is allowed to see about a question. Deliberately excludes
 * `expectedEvidence`, `minEvidence` and the rubric — revealing what the
 * evaluator looks for would let candidates recite the checklist back.
 */
export type ClientQuestion = {
  id: string;
  order: number;
  text: string;
  totalQuestions: number;
};

function toClientQuestion(
  question: PlannedQuestion,
  blueprint: InterviewBlueprintKey,
): ClientQuestion {
  return {
    id: question.id,
    order: question.order,
    // The SPOKEN form — the bank text with its grounding clause, if the
    // candidate has a real artifact for it. `question.text` stays the canonical
    // wording that evaluation grades against; sending it here instead would
    // compute the grounding and then throw it away, which is what happened
    // until the database-backed run caught it.
    text: question.spokenText ?? question.text,
    totalQuestions: questionCountFor(blueprint),
  };
}

/* ------------------------------------------------------------------ start */

export type StartInterviewData = {
  interviewId: string;
  blueprint: InterviewBlueprintKey;
  question: ClientQuestion;
  prompt?: string;
  /** True when an existing open attempt was resumed rather than created. */
  resumed: boolean;
  durationSec: number;
};

/**
 * Opens — or resumes — an attempt and returns the question on the floor.
 *
 * Order of operations is load-bearing:
 *   1. sweep stale attempts, so a closed tab does not lock the member out
 *   2. resume an existing open attempt if there is one (not a new attempt)
 *   3. ONLY THEN run the start gate and create a row
 *
 * The gate runs immediately before `createAttempt` in the same request. There is
 * no path to `createAttempt` that skips it.
 */
export async function startCohortInterview(
  memberId: string,
  blueprint: InterviewBlueprintKey,
): Promise<ServiceResult<StartInterviewData>> {
  await abandonStaleAttempts(memberId, COHORT_INTERVIEW_STALE_MS);

  // An interview is an assessment, not a conversation you can walk away from
  // and pick up later. A half-finished attempt would let a candidate hear the
  // questions, leave, prepare, and return — which is a different instrument
  // from the one everyone else sat. So any open attempt is closed as ABANDONED
  // and a fresh one begins. The row survives for audit; it is simply never
  // resumable, and it consumes nothing because only COMPLETED rows do.
  const existingId = await findActiveAttemptId(memberId, blueprint);
  if (existingId) {
    await closeAttemptWithoutConsuming(
      existingId,
      memberId,
      "ABANDONED",
      "Superseded by a new attempt; interviews are not resumable.",
    );
    logger.info("[cohort-interview] previous open attempt abandoned", {
      interviewId: existingId,
      memberId,
      blueprint,
    });
  }

  const gate = await gateStart(memberId, blueprint);
  if (!gate.ok) return { ok: false, message: gate.message };

  const plan = await buildCohortPlan(memberId, blueprint);
  // Seeded per attempt so no two interviews open with the same sentence, and
  // so two members starting in the same second still differ.
  const opened = beginInterview(
    plan,
    createInitialState(),
    `${memberId}:${Date.now()}`,
  );
  if (!opened.ok) return { ok: false, message: opened.message };

  const firstQuestion = opened.data.nextQuestion;
  if (!firstQuestion) {
    return { ok: false, message: "Could not start this interview." };
  }

  const attempt = await createAttempt(
    memberId,
    blueprint,
    plan,
    opened.data.state,
  );

  logger.info("[cohort-interview] attempt opened", {
    interviewId: attempt.id,
    memberId,
    blueprint,
  });

  return {
    ok: true,
    data: {
      interviewId: attempt.id,
      blueprint,
      question: toClientQuestion(firstQuestion, blueprint),
      prompt: opened.data.nextPrompt ?? undefined,
      resumed: false,
      durationSec: COHORT_INTERVIEW_DURATION_SEC,
    },
  };
}

/** Re-opens an in-progress attempt at the question the server has on the floor. */
export async function resumeCohortInterview(
  memberId: string,
  interviewId: string,
): Promise<ServiceResult<StartInterviewData>> {
  const attempt = await loadActiveAttempt(interviewId, memberId);
  if (!attempt) {
    return { ok: false, message: "This interview is no longer in progress." };
  }

  const question = getCurrentQuestion(attempt.plan, attempt.state);
  if (!question) {
    return { ok: false, message: "This interview has no question open." };
  }

  return {
    ok: true,
    data: {
      interviewId: attempt.id,
      blueprint: attempt.blueprint,
      question: toClientQuestion(question, attempt.blueprint),
      resumed: true,
      durationSec: COHORT_INTERVIEW_DURATION_SEC,
    },
  };
}

/* ----------------------------------------------------------------- answer */

export type AnswerTurnData = {
  /** True whenever the same question stays open — follow-up, redirect or repeat. */
  isFollowUp: boolean;
  /**
   * What the agent actually did. Sent so the voice layer can choose delivery
   * (a redirect should sound firmer than a follow-up) without re-deriving it.
   */
  action: AgentAction;
  prompt: string | null;
  question: ClientQuestion | null;
  finished: boolean;
  progress: CoreProgress;
};

/**
 * Processes one answer.
 *
 * Plan and state are reloaded from the row, so a tampered payload cannot change
 * question order, evidence, budgets, or which question is open. The orchestrator
 * rejects an answer whose `questionId` does not match the open question, which
 * makes a replayed or stale turn a no-op rather than a double-scored answer.
 */
export async function recordCohortAnswer(
  memberId: string,
  interviewId: string,
  questionId: string,
  answerText: string,
): Promise<ServiceResult<AnswerTurnData>> {
  const attempt = await loadActiveAttempt(interviewId, memberId);
  if (!attempt) {
    return { ok: false, message: "This interview is no longer in progress." };
  }

  const startedMs = Date.now();

  // Started BEFORE the model call and awaited after it. The next turn index
  // depends only on the interview id, never on the answer or the decision, so
  // waiting for the model before asking the database for it added a full round
  // trip to the gap the candidate hears as silence. A duplicate index remains
  // impossible in practice (one candidate, one open turn) and is already
  // handled idempotently by `saveTurn`.
  const turnIndexPromise = nextTurnIndex(interviewId);

  const llmStartedMs = Date.now();
  const turn = await submitAnswer(
    attempt.plan,
    attempt.state,
    questionId,
    answerText,
    {
      interviewId,
      blueprint: attempt.blueprint,
      // Minutes left in the session, from the PERSISTED start time. The
      // interviewer needs it to pace itself; taking it from the client would
      // let a candidate claim they had all day.
      minutesLeft: attempt.startedAt
        ? Math.max(
            0,
            Math.round(
              (COHORT_INTERVIEW_DURATION_SEC * 1000 -
                (Date.now() - attempt.startedAt.getTime())) /
                60_000,
            ),
          )
        : null,
    },
  );
  if (!turn.ok) return turn;

  // The durable audit row. Built here rather than inside the graph because the
  // graph is transport-agnostic and holds no notion of storage — and because
  // the turn index must come from the database, which is the only thing that
  // knows how many turns actually landed.
  const llmMs = Date.now() - llmStartedMs;

  const asked = attempt.plan.questions.find((q) => q.id === questionId);
  const depthLevel = attempt.state.depthLevel ?? 1;
  const record: TurnRecord = {
    turnIndex: await turnIndexPromise,
    questionId,
    tier: (asked?.tier ?? "CORE") as "CORE" | "EXTENSION",
    depthLevel,
    action: turn.data.action,
    promptText: turn.data.nextPrompt ?? "",
    answerText,
    // REDIRECT and REPEAT record no evidence by design; storing a null makes
    // that explicit in the trail rather than leaving it to be inferred.
    evidence:
      turn.data.action === "REDIRECT" || turn.data.action === "REPEAT"
        ? null
        : (turn.data.state.evidenceByQuestionId[
            depthLevel > 1 ? `${questionId}@L${depthLevel}` : questionId
          ] ?? null),
    degraded: turn.data.degraded,
    latencyMs: Date.now() - startedMs,
  };

  const persistStartedMs = Date.now();
  await saveTurn(interviewId, memberId, turn.data.state, record);

  // The middle leg of the turn, split into the part spent waiting on the model
  // and the part spent persisting. Both happen before the room can start
  // speaking, so both belong in any latency conversation.
  logger.info("[interview] turn latency", {
    interviewId,
    action: turn.data.action,
    llmMs,
    persistMs: Date.now() - persistStartedMs,
    serverMs: Date.now() - startedMs,
  });

  return {
    ok: true,
    data: {
      isFollowUp:
        turn.data.action === "FOLLOW_UP" ||
        turn.data.action === "REDIRECT" ||
        turn.data.action === "REPEAT",
      action: turn.data.action,
      prompt: turn.data.nextPrompt,
      question: turn.data.nextQuestion
        ? toClientQuestion(turn.data.nextQuestion, attempt.blueprint)
        : null,
      finished: turn.data.finished,
      progress: coreProgressFor(attempt.plan, turn.data.state),
    },
  };
}

/* --------------------------------------------------------------- finalize */

export type FinishInterviewData = {
  blueprint: InterviewBlueprintKey;
  scores: InterviewScores;
  durationSec: number;
  /**
   * True when the evidence-backed report was generated and stored.
   *
   * Optional so that a caller constructing this shape by hand — a UI stub, a
   * test — does not have to know about report persistence. The service always
   * sets it; treat `undefined` as "no report".
   */
  reportReady?: boolean;
};

/**
 * Scores the interview and consumes the milestone.
 *
 * Duration comes from the persisted `startedAt`, never from the client — a
 * client-supplied duration could clear the minimum-length floor on an interview
 * that never actually ran.
 *
 * A session that cannot be scored is closed INVALID and consumes nothing, so a
 * technical failure structurally cannot burn the member's one attempt.
 */
export async function finishCohortInterview(
  memberId: string,
  interviewId: string,
): Promise<ServiceResult<FinishInterviewData>> {
  const attempt = await loadActiveAttempt(interviewId, memberId);
  if (!attempt) {
    return { ok: false, message: "This interview is no longer in progress." };
  }

  const durationSec = attempt.startedAt
    ? Math.round((Date.now() - attempt.startedAt.getTime()) / 1000)
    : 0;

  const finalized = await finalizeInterview(
    attempt.plan,
    attempt.state,
    durationSec,
    COHORT_INTERVIEW_MIN_DURATION_SEC,
    COHORT_INTERVIEW_MIN_ANSWERED_CORE,
  );

  if (!finalized.ok) {
    await closeAttemptWithoutConsuming(
      interviewId,
      memberId,
      "INVALID",
      finalized.message,
    );
    logger.warn("[cohort-interview] attempt closed without consuming", {
      interviewId,
      memberId,
      blueprint: attempt.blueprint,
      reason: finalized.message,
    });
    return { ok: false, message: finalized.message };
  }

  // The report is generated BEFORE the attempt is committed, so its summary can
  // be written onto the interview row in the same completion — and so a
  // candidate never sees a completed interview that has no report behind it.
  const context = await buildCohortCandidateContext(memberId, attempt.blueprint);

  // The turn rows carry the deep-probe answers and the degraded flags, which
  // the report cannot reconstruct from the runtime state alone.
  const turns = await loadTurns(interviewId, memberId);

  const report = await buildInterviewReport(askForReport, {
    plan: attempt.plan,
    state: finalized.data.state,
    turns,
    blueprint: attempt.blueprint,
    scopeDays: scopeDaysFor(attempt.blueprint),
    candidate: {
      name: context?.fullName ?? "Candidate",
      cohort: context?.cohortName ?? "AI Cohort",
      jobRole: context?.jobRole ?? "",
      company: context?.company ?? "",
    },
    progressDay: context?.progressDay ?? null,
    durationSec,
  });

  const committed = await completeAttempt(interviewId, memberId, {
    state: finalized.data.state,
    scores: {
      ...finalized.data.scores,
      // The readable summary comes from the report; the row keeps a copy so
      // list views and the talent pool need not load the whole document.
      summary: report.summary || finalized.data.scores.summary,
    },
    durationSec,
  });

  if (!committed.ok) return { ok: false, message: committed.message };

  // Storing the report is deliberately NOT fatal. The interview is complete and
  // scored either way; a failed report write is something to retry, not a
  // reason to tell someone their interview did not count.
  const stored = await saveReport(interviewId, memberId, report);
  if (!stored.ok) {
    logger.error("[cohort-interview] report not stored", {
      interviewId,
      memberId,
      message: stored.message,
    });
  }

  logger.info("[cohort-interview] attempt completed", {
    interviewId,
    memberId,
    blueprint: attempt.blueprint,
    overallScore: finalized.data.scores.overallScore,
  });

  return {
    ok: true,
    data: {
      blueprint: attempt.blueprint,
      scores: finalized.data.scores,
      durationSec,
      reportReady: stored.ok,
    },
  };
}

/* ------------------------------------------------------------------ close */

/** Abandons an in-progress attempt. Consumes no milestone. */
export async function abandonCohortInterview(
  memberId: string,
  interviewId: string,
): Promise<ServiceResult<null>> {
  const attempt = await loadActiveAttempt(interviewId, memberId);
  if (!attempt) return { ok: false, message: "No interview in progress." };

  await closeAttemptWithoutConsuming(interviewId, memberId, "ABANDONED", null);
  return { ok: true, data: null };
}

/* ------------------------------------------------------------------- read */

export type CohortInterviewOverview = {
  blueprint: InterviewBlueprintKey;
  eligibility: CohortEligibility;
  questionCount: number;
  durationSec: number;
  result: Awaited<ReturnType<typeof loadCompletedResult>>;
};

/**
 * Read model for the pre-interview screen. A Server Component calls this
 * directly — it is not a Server Action, because nothing mutates.
 */
export async function getCohortInterviewOverview(
  memberId: string,
  blueprint: InterviewBlueprintKey,
): Promise<ServiceResult<CohortInterviewOverview>> {
  const [eligibility, result] = await Promise.all([
    resolveCohortEligibility(memberId, blueprint),
    loadCompletedResult(memberId, blueprint),
  ]);

  return {
    ok: true,
    data: {
      blueprint,
      eligibility,
      questionCount: questionCountFor(blueprint),
      durationSec: COHORT_INTERVIEW_DURATION_SEC,
      result,
    },
  };
}


/* ----------------------------------------------------------- the report */

/**
 * The stored report for a completed milestone.
 *
 * Member-scoped at the query level, so an interview id belonging to someone
 * else resolves to null rather than to their report. Nothing is regenerated
 * here — a report is a record of an assessment that happened, and re-running
 * the narrative on every page view would let the same interview say different
 * things on different days.
 */
export async function getCohortInterviewReport(
  memberId: string,
  blueprint: InterviewBlueprintKey,
): Promise<ServiceResult<LoadedReport>> {
  const found = await loadReportForBlueprint(memberId, blueprint);
  if (!found) {
    return { ok: false, message: "No report is available for this interview." };
  }
  return { ok: true, data: found };
}

/** The report for one specific attempt. */
export async function getInterviewReportById(
  memberId: string,
  interviewId: string,
): Promise<ServiceResult<LoadedReport>> {
  const found = await loadReport(interviewId, memberId);
  if (!found) {
    return { ok: false, message: "No report is available for this interview." };
  }
  return { ok: true, data: found };
}
