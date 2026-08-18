import {
  MAX_FOLLOW_UPS_PER_QUESTION,
  STUCK_ANSWERS_BEFORE_EARLY_END,
} from "@/features/interview/constants";
import type {
  AnswerEvidence,
  InterviewPlan,
  InterviewState,
  PlannedQuestion,
  TurnAction,
} from "@/features/interview/types";

/**
 * Deterministic interview state. The LLM proposes a turn action; this module
 * decides what actually happens, so budget and termination rules cannot be
 * talked around by a model.
 */

export function createInitialState(): InterviewState {
  return {
    status: "NOT_STARTED",
    currentQuestionIndex: 0,
    followUpsAsked: 0,
    consecutiveStuckAnswers: 0,
    transcript: [],
    evidenceByQuestionId: {},
    startedAtMs: null,
  };
}

export function startInterview(state: InterviewState): InterviewState {
  return { ...state, status: "IN_PROGRESS", startedAtMs: Date.now() };
}

export function getCurrentQuestion(
  plan: InterviewPlan,
  state: InterviewState,
): PlannedQuestion | null {
  return plan.questions[state.currentQuestionIndex] ?? null;
}

export function appendLine(
  state: InterviewState,
  role: "interviewer" | "candidate",
  text: string,
  questionId: string | null,
): InterviewState {
  return {
    ...state,
    transcript: [
      ...state.transcript,
      { role, text, questionId, ts: Date.now() },
    ],
  };
}

/**
 * Follow-up budget for one question.
 *
 * Cohort bank questions carry their own budget (0, 1 or 2) because the right
 * amount of probing is a property of the question, not of the interview: a
 * recall-level opener should never be probed, while "fine-tuning or retrieval?"
 * needs room to think out loud. The global constant caps whatever the bank asks
 * for, so a bank edit can never make an interview unbounded. General-interview
 * questions carry no budget and fall back to the global value.
 */
export function followUpBudgetFor(question: PlannedQuestion | null): number {
  const requested = question?.maxFollowUps ?? MAX_FOLLOW_UPS_PER_QUESTION;
  return Math.max(0, Math.min(requested, MAX_FOLLOW_UPS_PER_QUESTION));
}

/**
 * Applies a turn decision under deterministic budget rules.
 *
 * The proposed action is honoured only when it is affordable: a FOLLOW_UP past
 * the per-question budget becomes NEXT_QUESTION, and the interview ends when the
 * plan is exhausted or the candidate has been stuck too many times in a row.
 */
export function advanceTurn(
  plan: InterviewPlan,
  state: InterviewState,
  questionId: string,
  evidence: AnswerEvidence,
  proposedAction: TurnAction,
): { state: InterviewState; action: TurnAction } {
  const stuck = evidence.flaggedIssues.includes("stuck_or_evasive");
  const consecutiveStuckAnswers = stuck ? state.consecutiveStuckAnswers + 1 : 0;
  const budget = followUpBudgetFor(
    plan.questions.find((q) => q.id === questionId) ?? null,
  );

  const next: InterviewState = {
    ...state,
    consecutiveStuckAnswers,
    evidenceByQuestionId: {
      ...state.evidenceByQuestionId,
      [questionId]: evidence,
    },
  };

  if (consecutiveStuckAnswers >= STUCK_ANSWERS_BEFORE_EARLY_END) {
    return {
      state: { ...next, status: "COMPLETED" },
      action: "END_INTERVIEW",
    };
  }

  const canFollowUp =
    proposedAction === "FOLLOW_UP" && !stuck && next.followUpsAsked < budget;

  if (canFollowUp) {
    return {
      state: { ...next, followUpsAsked: next.followUpsAsked + 1 },
      action: "FOLLOW_UP",
    };
  }

  const nextIndex = next.currentQuestionIndex + 1;
  if (nextIndex >= plan.questions.length) {
    return {
      state: { ...next, currentQuestionIndex: nextIndex, status: "COMPLETED" },
      action: "END_INTERVIEW",
    };
  }

  return {
    state: { ...next, currentQuestionIndex: nextIndex, followUpsAsked: 0 },
    action: "NEXT_QUESTION",
  };
}

export function transcriptToText(state: InterviewState): string {
  return state.transcript
    .map(
      (l) =>
        `${l.role === "interviewer" ? "Interviewer" : "Candidate"}: ${l.text}`,
    )
    .join("\n");
}
