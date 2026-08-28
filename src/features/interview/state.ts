import {
  askedIds,
  selectNextTarget,
} from "@/features/interview/agent/target-planner";
import {
  MAX_ESCALATIONS_PER_QUESTION,
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
    askedQuestionIds: [],
    followUpsAsked: 0,
    consecutiveStuckAnswers: 0,
    redirectsAsked: 0,
    repeatsAsked: 0,
    clarificationsAsked: 0,
    depthLevel: 1,
    escalationsAsked: 0,
    competenceSignal: {},
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
  /**
   * Where to file this answer's evidence. Defaults to the question id; an
   * escalated turn passes a rung-scoped key so the two checklists' index spaces
   * never mix. Budgets are still looked up by `questionId`, which is why the
   * two are separate parameters rather than one.
   */
  evidenceKey: string = questionId,
  /**
   * What the candidate just said. The conversation planner routes on it: an
   * answer that raises a curriculum concept pulls the interview toward the
   * target that assesses it. Empty is normal and simply means authored order
   * governs.
   */
  answerText: string = "",
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
      [evidenceKey]: evidence,
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

  // Escalation draws on its OWN budget, not the follow-up budget: a follow-up
  // closes a gap, an escalation looks for the ceiling of a candidate who has
  // no gap left. A recall question with `maxFollowUps: 0` can therefore still
  // reward a strong answer with a harder one.
  const canEscalate =
    proposedAction === "ESCALATE" &&
    !stuck &&
    (next.escalationsAsked ?? 0) < MAX_ESCALATIONS_PER_QUESTION;

  if (canEscalate) {
    return {
      state: {
        ...next,
        escalationsAsked: (next.escalationsAsked ?? 0) + 1,
        depthLevel: (next.depthLevel ?? 1) + 1,
      },
      action: "ESCALATE",
    };
  }

  // THE CONVERSATION PLANNER, replacing `currentQuestionIndex + 1`.
  //
  // This single line is what turns a bounded question list into a conversation:
  // the next target is chosen from everything still unassessed, weighing what
  // the candidate just talked about against what the interview still needs to
  // find out. `selectNextTarget` is pure, so the choice is reproducible and the
  // interview stays bounded — targets are only ever removed from the pool.
  const target = selectNextTarget(plan, next, answerText);

  const asked = askedIds(plan, next);

  if (target.questionId === null) {
    return {
      state: {
        ...next,
        currentQuestionIndex: plan.questions.length,
        askedQuestionIds: asked,
        status: "COMPLETED",
      },
      action: "END_INTERVIEW",
    };
  }

  const nextIndex = target.index;

  // Per-question counters all reset together: the budgets belong to the
  // question, not to the interview.
  return {
    state: {
      ...next,
      currentQuestionIndex: nextIndex,
      askedQuestionIds: [...asked, target.questionId],
      followUpsAsked: 0,
      redirectsAsked: 0,
      repeatsAsked: 0,
      clarificationsAsked: 0,
      depthLevel: 1,
      escalationsAsked: 0,
    },
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
