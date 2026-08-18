import "server-only";
import type { InterviewBlueprintKey } from "@/features/interview/cohort/blueprint";
import { COHORT_INTERVIEW_MIN_DURATION_SEC } from "@/features/interview/constants";
import { judgeInterview } from "@/features/interview/evaluation";
import { aggregateScores } from "@/features/interview/scoring";
import { appendLine, startInterview } from "@/features/interview/state";
import { runInterviewTurn } from "@/features/interview/agent";
import { resolveInterviewLLM } from "@/features/interview/agent/llm/registry";
import type { AgentAction } from "@/features/interview/agent";
import type {
  InterviewPlan,
  InterviewScores,
  InterviewState,
  PlannedQuestion,
} from "@/features/interview/types";

/**
 * The live interview loop: begin → (submitAnswer)* → finalize.
 *
 * Thin glue by design. Since the LangGraph agent landed, `submitAnswer` no
 * longer contains any turn logic at all — it resolves the configured provider
 * and hands the turn to the graph (`features/interview/agent`), which owns
 * analysis, routing and state transitions. The rules themselves still live
 * where they always did: `state.ts` (budgets/termination), `agent/policy.ts`
 * (action policy) and `evidence.ts` (evidence arithmetic), all pure and
 * independently tested.
 *
 * `beginInterview` and `finalizeInterview` stay here: opening and closing an
 * attempt are not conversation turns and never enter the graph.
 */

export type TurnResult = {
  state: InterviewState;
  /**
   * Widened from the persisted `TurnAction` to the agent's action set: REDIRECT
   * and REPEAT are real outcomes of a turn that leave the question on the floor.
   */
  action: AgentAction;
  /** What the interviewer says next; null once the interview is over. */
  nextPrompt: string | null;
  /** The question now on the floor — unchanged unless the turn moved on. */
  nextQuestion: PlannedQuestion | null;
  finished: boolean;
};

export type TurnOutcome =
  | { ok: true; data: TurnResult }
  | { ok: false; message: string };

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
 * Processes one candidate answer by running it through the LangGraph agent.
 *
 * Everything this function once did inline — evaluate, route under budget,
 * merge evidence, advance or hold the question, draft the interviewer's next
 * line — now happens as explicit graph nodes. What is left here is the two
 * things the graph should not own: choosing the provider, and translating the
 * agent's result into the shape the service layer already speaks.
 *
 * Exactly one LLM call per invocation, unchanged.
 */
export async function submitAnswer(
  plan: InterviewPlan,
  state: InterviewState,
  questionId: string,
  answerText: string,
  context?: { interviewId: string; blueprint: InterviewBlueprintKey },
): Promise<TurnOutcome> {
  const blueprint =
    context?.blueprint ??
    (plan.contextSummary.kind === "COHORT"
      ? plan.contextSummary.blueprint
      : "DAY_31");

  const turn = await runInterviewTurn(resolveInterviewLLM(), {
    interviewId: context?.interviewId ?? "unknown",
    blueprint,
    plan,
    state,
    questionId,
    answerText,
  });

  if (!turn.ok) return turn;

  const { data } = turn;
  const nextQuestion = data.questionId
    ? (plan.questions.find((q) => q.id === data.questionId) ?? null)
    : null;

  return {
    ok: true,
    data: {
      state: data.state,
      action: data.action,
      nextPrompt: data.prompt,
      nextQuestion,
      finished: data.finished,
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
