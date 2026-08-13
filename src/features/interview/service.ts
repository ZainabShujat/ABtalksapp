import "server-only";
import { logger } from "@/lib/logger";
import {
  beginInterview,
  finalizeInterview,
  submitAnswer,
} from "@/features/interview/orchestrator";
import {
  closeAttemptWithoutConsuming,
  completeAttempt,
  createAttempt,
  findActiveAttemptId,
  loadActiveAttemptForUser,
  loadLatestResult,
  saveTurn,
} from "@/features/interview/repository";
import {
  buildInterviewSession,
  resolveEligibility,
} from "@/features/interview/session";
import { createInitialState } from "@/features/interview/state";
import { INTERVIEW_QUESTION_COUNT } from "@/features/interview/constants";
import type {
  InterviewEligibility,
  InterviewScores,
  PlannedQuestion,
} from "@/features/interview/types";

/**
 * The persistence-wired interview flow. Server Actions call only these
 * functions, and pass only ids — never plan, state, or entitlement. Everything
 * that determines a score or an attempt's cost is loaded server-side.
 */

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

/**
 * What the client is allowed to see about a question. Deliberately excludes the
 * rubric, expected evidence, and source refs — revealing what the evaluator
 * looks for would let candidates recite it back.
 */
export type ClientQuestion = {
  id: string;
  order: number;
  text: string;
  totalQuestions: number;
};

function toClientQuestion(question: PlannedQuestion): ClientQuestion {
  return {
    id: question.id,
    order: question.order,
    text: question.text,
    totalQuestions: INTERVIEW_QUESTION_COUNT,
  };
}

/* ------------------------------------------------------------------ start */

export type StartInterviewData = {
  interviewId: string;
  question: ClientQuestion;
};

export async function startInterviewForUser(
  userId: string,
): Promise<ServiceResult<StartInterviewData>> {
  const activeId = await findActiveAttemptId(userId);
  if (activeId) {
    return { ok: false, message: "You already have an interview in progress." };
  }

  const session = await buildInterviewSession(userId);
  if (!session.ok) return { ok: false, message: session.message };

  const { eligibility, plan, eligibleSubmissionIds } = session.data;
  if (eligibility.state !== "ready") {
    return {
      ok: false,
      message:
        eligibility.state === "locked" || eligibility.state === "retake_locked"
          ? eligibility.reason
          : "You already have an interview in progress.",
    };
  }

  const opened = beginInterview(plan, createInitialState());
  if (!opened.ok) return { ok: false, message: opened.message };

  const firstQuestion = opened.data.nextQuestion;
  if (!firstQuestion) {
    return { ok: false, message: "Could not start this interview." };
  }

  const attempt = await createAttempt(
    userId,
    plan,
    opened.data.state,
    eligibleSubmissionIds,
  );

  return {
    ok: true,
    data: {
      interviewId: attempt.id,
      question: toClientQuestion(firstQuestion),
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
 * Processes one answer. Plan and state are reloaded from the database, so a
 * tampered client payload cannot change question order, evidence, or budgets.
 */
export async function recordAnswer(
  userId: string,
  interviewId: string,
  questionId: string,
  answerText: string,
): Promise<ServiceResult<AnswerTurnData>> {
  const attempt = await loadActiveAttemptForUser(interviewId, userId);
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

  await saveTurn(interviewId, turn.data.state);

  return {
    ok: true,
    data: {
      isFollowUp: turn.data.action === "FOLLOW_UP",
      prompt: turn.data.nextPrompt,
      question: turn.data.nextQuestion
        ? toClientQuestion(turn.data.nextQuestion)
        : null,
      finished: turn.data.finished,
    },
  };
}

/* --------------------------------------------------------------- finalize */

export type FinishInterviewData = {
  attemptNumber: number;
  scores: InterviewScores;
};

/**
 * Scores the interview and commits the attempt.
 *
 * Duration is derived from the persisted `startedAt`, not from the client — a
 * client-supplied duration could clear the minimum-length floor on an interview
 * that never actually ran. A session that cannot be scored is closed INVALID and
 * consumes nothing.
 */
export async function finishInterview(
  userId: string,
  interviewId: string,
): Promise<ServiceResult<FinishInterviewData>> {
  const attempt = await loadActiveAttemptForUser(interviewId, userId);
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
  );

  if (!finalized.ok) {
    await closeAttemptWithoutConsuming(
      interviewId,
      "INVALID",
      finalized.message,
    );
    logger.warn("[interview] attempt closed without consuming", {
      interviewId,
      reason: finalized.message,
    });
    return { ok: false, message: finalized.message };
  }

  const committed = await completeAttempt(interviewId, userId, {
    state: finalized.data.state,
    scores: finalized.data.scores,
    durationSec,
  });

  if (!committed.ok) return { ok: false, message: committed.message };

  return {
    ok: true,
    data: {
      attemptNumber: committed.attemptNumber,
      scores: finalized.data.scores,
    },
  };
}

/* ------------------------------------------------------------------ close */

export async function abandonInterview(
  userId: string,
  interviewId: string,
): Promise<ServiceResult<null>> {
  const attempt = await loadActiveAttemptForUser(interviewId, userId);
  if (!attempt) return { ok: false, message: "No interview in progress." };

  await closeAttemptWithoutConsuming(interviewId, "ABANDONED", null);
  return { ok: true, data: null };
}

/* ------------------------------------------------------------------- read */

export type InterviewOverview = {
  eligibility: InterviewEligibility;
  activeInterviewId: string | null;
  totalCompletedDays: number;
  latestResult: Awaited<ReturnType<typeof loadLatestResult>>;
};

/**
 * Read model for the pre-interview screen. A Server Component calls this
 * directly — it is not a Server Action, because nothing mutates.
 *
 * Uses the LLM-free eligibility path: this runs on every page load, and question
 * phrasing is only worth paying for once an interview actually starts.
 */
export async function getInterviewOverview(
  userId: string,
): Promise<ServiceResult<InterviewOverview>> {
  const resolved = await resolveEligibility(userId);
  if (!resolved.ok) return { ok: false, message: resolved.message };

  const [activeInterviewId, latestResult] = await Promise.all([
    findActiveAttemptId(userId),
    loadLatestResult(userId),
  ]);

  return {
    ok: true,
    data: {
      eligibility: resolved.data.eligibility,
      activeInterviewId,
      totalCompletedDays: resolved.data.context.challenge.totalCompletedDays,
      latestResult,
    },
  };
}
