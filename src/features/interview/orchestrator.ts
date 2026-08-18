import "server-only";
import { COHORT_INTERVIEW_MIN_DURATION_SEC } from "@/features/interview/constants";
import { evaluateAnswer, judgeInterview } from "@/features/interview/evaluation";
import { mergeEvidence } from "@/features/interview/evidence";
import { aggregateScores } from "@/features/interview/scoring";
import {
  advanceTurn,
  appendLine,
  getCurrentQuestion,
  startInterview,
} from "@/features/interview/state";
import type {
  InterviewPlan,
  InterviewScores,
  InterviewState,
  PlannedQuestion,
  TurnAction,
} from "@/features/interview/types";

/**
 * The live interview loop: begin → (submitAnswer)* → finalize.
 *
 * Thin glue by design. Every rule that decides what happens next lives in
 * `state.ts` (routing/budgets) or `evidence.ts` (evidence arithmetic), both pure
 * and independently tested. This file only sequences them around the LLM calls.
 */

export type TurnResult = {
  state: InterviewState;
  action: TurnAction;
  /** What the interviewer says next; null once the interview is over. */
  nextPrompt: string | null;
  /** The question now on the floor — unchanged when action is FOLLOW_UP. */
  nextQuestion: PlannedQuestion | null;
  finished: boolean;
};

export type TurnOutcome =
  | { ok: true; data: TurnResult }
  | { ok: false; message: string };

const CLOSING_LINE =
  "That's everything I wanted to cover. Thanks for walking me through your work.";

/** Opens the interview and puts the first question on the floor. */
export function beginInterview(
  plan: InterviewPlan,
  state: InterviewState,
): TurnOutcome {
  if (state.status !== "NOT_STARTED") {
    return { ok: false, message: "This interview has already started." };
  }

  const first = plan.questions[0];
  if (!first) {
    return { ok: false, message: "This interview has no questions planned." };
  }

  const started = startInterview(state);
  return {
    ok: true,
    data: {
      state: appendLine(started, "interviewer", first.text, first.id),
      action: "NEXT_QUESTION",
      nextPrompt: first.text,
      nextQuestion: first,
      finished: false,
    },
  };
}

/**
 * Processes one candidate answer. Exactly one LLM call per invocation.
 */
export async function submitAnswer(
  plan: InterviewPlan,
  state: InterviewState,
  questionId: string,
  answerText: string,
): Promise<TurnOutcome> {
  if (state.status !== "IN_PROGRESS") {
    return { ok: false, message: "This interview is not in progress." };
  }

  const current = getCurrentQuestion(plan, state);
  if (!current) {
    return { ok: false, message: "No question is currently open." };
  }

  // Answers must land against the question actually on the floor. A mismatch
  // means a stale or replayed client, not a valid turn.
  if (current.id !== questionId) {
    return { ok: false, message: "That answer is for a different question." };
  }

  const priorEvidence = state.evidenceByQuestionId[questionId];
  const withAnswer = appendLine(state, "candidate", answerText, questionId);

  const decision = await evaluateAnswer(
    current,
    answerText,
    priorEvidence ?? null,
  );

  // Routing uses the RAW evidence for this answer: a candidate who recovers on
  // a follow-up must not stay flagged stuck by the merged history.
  const advanced = advanceTurn(
    plan,
    withAnswer,
    questionId,
    decision.evidence,
    decision.action,
  );

  // Storage uses the MERGED evidence so credit earned earlier in the question
  // survives the follow-up.
  let nextState: InterviewState = priorEvidence
    ? {
        ...advanced.state,
        evidenceByQuestionId: {
          ...advanced.state.evidenceByQuestionId,
          [questionId]: mergeEvidence(priorEvidence, decision.evidence),
        },
      }
    : advanced.state;

  if (advanced.action === "FOLLOW_UP" && decision.followUpText) {
    nextState = appendLine(
      nextState,
      "interviewer",
      decision.followUpText,
      questionId,
    );
    return {
      ok: true,
      data: {
        state: nextState,
        action: "FOLLOW_UP",
        nextPrompt: decision.followUpText,
        nextQuestion: current,
        finished: false,
      },
    };
  }

  if (advanced.action === "END_INTERVIEW") {
    nextState = appendLine(nextState, "interviewer", CLOSING_LINE, null);
    return {
      ok: true,
      data: {
        state: nextState,
        action: "END_INTERVIEW",
        nextPrompt: CLOSING_LINE,
        nextQuestion: null,
        finished: true,
      },
    };
  }

  const next = getCurrentQuestion(plan, nextState);
  if (!next) {
    nextState = appendLine(nextState, "interviewer", CLOSING_LINE, null);
    return {
      ok: true,
      data: {
        state: { ...nextState, status: "COMPLETED" },
        action: "END_INTERVIEW",
        nextPrompt: CLOSING_LINE,
        nextQuestion: null,
        finished: true,
      },
    };
  }

  nextState = appendLine(nextState, "interviewer", next.text, next.id);
  return {
    ok: true,
    data: {
      state: nextState,
      action: "NEXT_QUESTION",
      nextPrompt: next.text,
      nextQuestion: next,
      finished: false,
    },
  };
}

export type FinalizeResult =
  | { ok: true; data: { state: InterviewState; scores: InterviewScores } }
  | { ok: false; message: string };

/**
 * Closes the interview and produces final scores. One LLM call for the semantic
 * judgment; all arithmetic afterwards is deterministic.
 *
 * A session shorter than the floor is rejected rather than scored — too little
 * evidence to be comparable. The caller marks such attempts INVALID so they do
 * not consume a retake.
 */
export async function finalizeInterview(
  plan: InterviewPlan,
  state: InterviewState,
  durationSec: number,
  minDurationSec: number = COHORT_INTERVIEW_MIN_DURATION_SEC,
): Promise<FinalizeResult> {
  if (state.status === "NOT_STARTED") {
    return { ok: false, message: "This interview never started." };
  }

  if (durationSec < minDurationSec) {
    return {
      ok: false,
      message: `An interview must run at least ${Math.round(
        minDurationSec / 60,
      )} minutes to be scored.`,
    };
  }

  const { judgments, summary } = await judgeInterview(plan, state);

  return {
    ok: true,
    data: {
      state: { ...state, status: "COMPLETED" },
      scores: aggregateScores(judgments, summary),
    },
  };
}
