import "server-only";
import { logger } from "@/lib/logger";
import {
  COHORT_INTERVIEW_DURATION_SEC,
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
  saveTurn,
} from "@/features/interview/repository";
import {
  buildCohortPlan,
  gateStart,
  resolveCohortEligibility,
} from "@/features/interview/session";
import { createInitialState, getCurrentQuestion } from "@/features/interview/state";
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
    text: question.text,
    totalQuestions: questionCountFor(blueprint),
  };
}

/* ------------------------------------------------------------------ start */

export type StartInterviewData = {
  interviewId: string;
  blueprint: InterviewBlueprintKey;
  question: ClientQuestion;
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

  const existingId = await findActiveAttemptId(memberId, blueprint);
  if (existingId) {
    const resumed = await resumeCohortInterview(memberId, existingId);
    if (resumed.ok) return resumed;
    // The row vanished or went unresumable between the two reads. Fall through
    // and let the gate decide whether a fresh attempt is allowed.
  }

  const gate = await gateStart(memberId, blueprint);
  if (!gate.ok) return { ok: false, message: gate.message };

  const plan = buildCohortPlan(blueprint);
  const opened = beginInterview(plan, createInitialState());
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
  /** True when the same question stays open with a follow-up probe. */
  isFollowUp: boolean;
  prompt: string | null;
  question: ClientQuestion | null;
  finished: boolean;
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

  const turn = await submitAnswer(
    attempt.plan,
    attempt.state,
    questionId,
    answerText,
  );
  if (!turn.ok) return turn;

  await saveTurn(interviewId, memberId, turn.data.state);

  return {
    ok: true,
    data: {
      isFollowUp: turn.data.action === "FOLLOW_UP",
      prompt: turn.data.nextPrompt,
      question: turn.data.nextQuestion
        ? toClientQuestion(turn.data.nextQuestion, attempt.blueprint)
        : null,
      finished: turn.data.finished,
    },
  };
}

/* --------------------------------------------------------------- finalize */

export type FinishInterviewData = {
  blueprint: InterviewBlueprintKey;
  scores: InterviewScores;
  durationSec: number;
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

  const committed = await completeAttempt(interviewId, memberId, {
    state: finalized.data.state,
    scores: finalized.data.scores,
    durationSec,
  });

  if (!committed.ok) return { ok: false, message: committed.message };

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
