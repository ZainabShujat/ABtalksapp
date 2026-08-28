import "server-only";
import type { InterviewBlueprintKey } from "@/features/interview/cohort/blueprint";
import {
  COHORT_INTERVIEW_MIN_ANSWERED_CORE,
  COHORT_INTERVIEW_MIN_DURATION_SEC,
} from "@/features/interview/constants";
import { scoreQuestion } from "@/features/interview/module-scoring";
import {
  assessCompetencies,
  overallFromCompetencies,
} from "@/features/interview/scoring";
import { appendLine, startInterview } from "@/features/interview/state";
import { runInterviewTurn } from "@/features/interview/agent";
import { openingLine } from "@/features/interview/agent/policy";
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
  /**
   * True when the model could not be reached and the deterministic fallback
   * judged this answer. Carried all the way to the persisted turn row, because
   * the report needs it to tell a genuinely weak interview apart from one the
   * provider failed to grade.
   */
  degraded: boolean;
};

export type TurnOutcome =
  | { ok: true; data: TurnResult }
  | { ok: false; message: string };

/** Opens the interview and puts the first question on the floor. */
export function beginInterview(
  plan: InterviewPlan,
  state: InterviewState,
  /**
   * Varies the opening wording. Unique per attempt in production; tests and the
   * mock provider pass a constant so their expected transcript is stable.
   */
  seed: string = `${Date.now()}`,
): TurnOutcome {
  if (state.status !== "NOT_STARTED") {
    return { ok: false, message: "This interview has already started." };
  }

  const first = plan.questions[0];
  if (!first) {
    return { ok: false, message: "This interview has no questions planned." };
  }

  // The opening is spoken as its own paragraph, then the question. Previously
  // both were one run-on string, so the interview appeared to begin mid-thought.
  const ctx = plan.contextSummary;
  const intro =
    ctx.kind === "COHORT"
      ? openingLine({
          firstName: ctx.candidateFirstName,
          blueprint: ctx.blueprint,
          questionCount: ctx.questionCount,
          seed,
        })
      : "Thanks for making the time. Talk me through your thinking rather than giving me the short version — and if you don't know something, just say so and we'll move on.\n\nLet's start here.";

  const firstPrompt = `${intro}\n\n${first.text}`;

  // The opening question counts as asked. Without this the planner would see it
  // as an unassessed target and could route straight back to it on the first
  // advance — the one question we know for certain has already been put.
  const started = {
    ...startInterview(state),
    askedQuestionIds: [first.id],
  };
  return {
    ok: true,
    data: {
      state: appendLine(started, "interviewer", firstPrompt, first.id),
      action: "NEXT_QUESTION",
      nextPrompt: firstPrompt,
      nextQuestion: first,
      finished: false,
      degraded: false,
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
  context?: {
    interviewId: string;
    blueprint: InterviewBlueprintKey;
    minutesLeft?: number | null;
  },
): Promise<TurnOutcome> {
  const blueprint =
    context?.blueprint ??
    (plan.contextSummary.kind === "COHORT"
      ? plan.contextSummary.blueprint
      : "DAY_31");

  const turn = await runInterviewTurn(resolveInterviewLLM(), {
    interviewId: context?.interviewId ?? "unknown",
    minutesLeft: context?.minutesLeft ?? null,
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
      degraded: data.degraded,
    },
  };
}

export type FinalizeResult =
  | { ok: true; data: { state: InterviewState; scores: InterviewScores } }
  | { ok: false; message: string };

/**
 * Closes the interview and produces final scores.
 *
 * NO model is involved. Scores are computed from the evidence recorded during
 * the interview: which expected-evidence items each answer covered, aggregated
 * per competency and weighted by the rubric. `evaluation.ts`'s `judgeInterview`
 * — which asked a model for a tier per competency — is no longer on this path.
 * It stays on disk as the reference implementation of that prompt, but a score
 * a model can nudge is not a score two candidates can be compared on.
 *
 * Only CORE questions count. Extension questions about work beyond the
 * milestone are reported separately and never move this number.
 *
 * A session with too little evidence is rejected rather than scored — nothing to
 * compare against candidates who sat a full one. The caller marks such attempts
 * INVALID so they do not consume a retake.
 *
 * "Too little evidence" is measured two ways, and either is enough to pass. The
 * clock is the cheap proxy; the count of ANSWERED CORE QUESTIONS is the real
 * thing. Time alone used to be the only test, which created a dead end: when the
 * interviewer ended a session early — three consecutive stuck answers, or simply
 * a candidate who answered quickly — the interview was over, had real evidence
 * behind it, and was still refused for being under three minutes. No question
 * remained to answer and no report could be reached. An interview that produced
 * answers is scorable on those answers.
 */
export async function finalizeInterview(
  plan: InterviewPlan,
  state: InterviewState,
  durationSec: number,
  minDurationSec: number = COHORT_INTERVIEW_MIN_DURATION_SEC,
  minAnsweredCore: number = COHORT_INTERVIEW_MIN_ANSWERED_CORE,
): Promise<FinalizeResult> {
  if (state.status === "NOT_STARTED") {
    return { ok: false, message: "This interview never started." };
  }

  const coreScores = plan.questions
    .filter((q) => (q.tier ?? "CORE") === "CORE")
    .map((q) => scoreQuestion(q, state));

  const answered = coreScores.filter((s) => s.answered);

  if (durationSec < minDurationSec && answered.length < minAnsweredCore) {
    return {
      ok: false,
      message: `An interview needs at least ${Math.round(
        minDurationSec / 60,
      )} minutes or ${minAnsweredCore} answered questions to be scored.`,
    };
  }

  const competencies = assessCompetencies(coreScores, state, plan);
  const overallScore = overallFromCompetencies(competencies);

  const cleared = answered.filter((s) => s.cleared).length;

  return {
    ok: true,
    data: {
      state: { ...state, status: "COMPLETED" },
      scores: {
        perCompetency: competencies.map((c) => ({
          competency: c.competency,
          score: c.score,
          tier: c.tier,
        })),
        overallScore,
        // A factual placeholder. The readable summary belongs to the report,
        // which is generated after this and written to the interview row.
        summary:
          `Cleared the evidence bar on ${cleared} of ${answered.length} ` +
          `answered questions.`,
      },
    },
  };
}
