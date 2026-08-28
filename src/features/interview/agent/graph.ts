import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { logger } from "@/lib/logger";
import type { InterviewBlueprintKey } from "@/features/interview/cohort/blueprint";
import { followUpBudgetFor, getCurrentQuestion } from "@/features/interview/state";
import type {
  AnswerEvidence,
  InterviewPlan,
  InterviewState,
  InterviewStatus,
} from "@/features/interview/types";
import {
  applyEscalate,
  applyFollowUp,
  applyNextQuestion,
  applyClarify,
  applyRedirect,
  applyRepeat,
  completeInterview,
  createAnalyzeAnswer,
  receiveAnswer,
  routeResponse,
  shouldContinue,
  updateState,
} from "@/features/interview/agent/nodes";
import type {
  AgentAction,
  InterviewAgentState,
  InterviewDecision,
  LlmAction,
  TranscriptTurn,
} from "@/features/interview/agent/types";
import type { InterviewLLM } from "@/features/interview/agent/llm/provider";

/**
 * The LangGraph interview agent.
 *
 *   START -> receiveAnswer -> analyzeAnswer -> routeResponse
 *                                                 |
 *                +--------------+-----------------+--------------+
 *                |              |                 |              |
 *            followUp      nextQuestion       redirect        repeat
 *                +--------------+-----------------+--------------+
 *                                    |
 *                               updateState
 *                                    |
 *                             shouldContinue?
 *                              /            \
 *                        complete            END
 *
 * One invocation handles ONE candidate answer and returns the interviewer's
 * next line plus the new persisted state. The graph is not the interview loop —
 * the loop is the candidate speaking again, which arrives as another request.
 * Holding no cross-request memory is what keeps the database authoritative and
 * makes the whole thing safe on serverless.
 *
 * Why a graph rather than one prompt: the transitions ARE the assessment rules.
 * As named nodes and edges they can be read, tested and audited; inside a
 * prompt they are suggestions a model may ignore.
 */

const InterviewAnnotation = Annotation.Root({
  interviewId: Annotation<string>,
  blueprint: Annotation<InterviewBlueprintKey>,

  plan: Annotation<InterviewPlan>,
  interviewState: Annotation<InterviewState>,

  currentQuestionId: Annotation<string>,
  currentQuestionIndex: Annotation<number>,
  currentQuestion: Annotation<string>,

  candidateAnswer: Annotation<string>,

  transcript: Annotation<TranscriptTurn[]>,
  evidence: Annotation<Record<string, AnswerEvidence>>,

  followUpCount: Annotation<number>,
  maxFollowUps: Annotation<number>,
  redirectCount: Annotation<number>,
  repeatCount: Annotation<number>,
  depthLevel: Annotation<number>,
  escalationsAsked: Annotation<number>,

  decision: Annotation<InterviewDecision | null>,
  lastDecision: Annotation<AgentAction | null>,
  nextPrompt: Annotation<string | null>,
  finished: Annotation<boolean>,
  status: Annotation<InterviewStatus>,
  error: Annotation<string | null>,
});

/** Branch taken straight after `receiveAnswer` rejects a turn. */
function guardBranch(state: InterviewAgentState): "analyze" | "abort" {
  return state.error ? "abort" : "analyze";
}

/** Names the branch node for the routed action. */
function actionBranch(
  state: InterviewAgentState,
): "followUp" | "escalate" | "nextQuestion" | "redirect" | "repeat" | "clarify" {
  switch (state.lastDecision) {
    case "FOLLOW_UP":
      return "followUp";
    case "ESCALATE":
      return "escalate";
    case "REDIRECT":
      return "redirect";
    case "CLARIFY":
      return "clarify";
    case "REPEAT":
      return "repeat";
    default:
      return "nextQuestion";
  }
}

export function buildInterviewGraph(llm: InterviewLLM) {
  return new StateGraph(InterviewAnnotation)
    .addNode("receiveAnswer", receiveAnswer)
    .addNode("analyzeAnswer", createAnalyzeAnswer(llm))
    .addNode("routeResponse", routeResponse)
    .addNode("followUp", applyFollowUp)
    .addNode("escalate", applyEscalate)
    .addNode("nextQuestion", applyNextQuestion)
    .addNode("redirect", applyRedirect)
    .addNode("repeat", applyRepeat)
    .addNode("clarify", applyClarify)
    .addNode("updateState", updateState)
    .addNode("complete", completeInterview)
    .addEdge(START, "receiveAnswer")
    .addConditionalEdges("receiveAnswer", guardBranch, {
      analyze: "analyzeAnswer",
      abort: END,
    })
    .addEdge("analyzeAnswer", "routeResponse")
    .addConditionalEdges("routeResponse", actionBranch, {
      followUp: "followUp",
      escalate: "escalate",
      nextQuestion: "nextQuestion",
      redirect: "redirect",
      repeat: "repeat",
      clarify: "clarify",
    })
    .addEdge("followUp", "updateState")
    .addEdge("escalate", "updateState")
    .addEdge("nextQuestion", "updateState")
    .addEdge("redirect", "updateState")
    .addEdge("repeat", "updateState")
    .addEdge("clarify", "updateState")
    .addConditionalEdges("updateState", shouldContinue, {
      complete: "complete",
      continue: END,
    })
    .addEdge("complete", END)
    .compile();
}

/**
 * Compiling is not free, and the provider is resolved once per process, so the
 * compiled graph is cached against its provider instance.
 */
const compiled = new WeakMap<
  InterviewLLM,
  ReturnType<typeof buildInterviewGraph>
>();

function graphFor(llm: InterviewLLM) {
  const existing = compiled.get(llm);
  if (existing) return existing;
  const graph = buildInterviewGraph(llm);
  compiled.set(llm, graph);
  return graph;
}

export type RunTurnInput = {
  /** Minutes left in the session, from the server clock. Null when unknown. */
  minutesLeft?: number | null;
  interviewId: string;
  blueprint: InterviewBlueprintKey;
  plan: InterviewPlan;
  state: InterviewState;
  questionId: string;
  answerText: string;
};

export type RunTurnResult =
  | {
      ok: true;
      data: {
        state: InterviewState;
        action: AgentAction;
        /** What the interviewer says next. Null only if the graph aborted. */
        prompt: string | null;
        /** The question now on the floor; unchanged unless action moved on. */
        questionId: string | null;
        finished: boolean;
        /** True when a model failure forced the deterministic path. */
        degraded: boolean;
        /**
         * What the model ASKED for, before policy. Differs from `action`
         * whenever a budget or the off-topic rule overrode it — which is the
         * clearest single piece of evidence that the LLM is not in charge.
         */
        proposed: LlmAction | null;
        /**
         * Node names in the order LangGraph actually executed them.
         *
         * Taken from the graph's own `updates` stream rather than written by
         * hand, so it is evidence of what ran, not a description of it. Used by
         * the developer demo; ignored in production.
         */
        trace: string[];
      };
    }
  | { ok: false; message: string };

/**
 * Runs one turn through the graph.
 *
 * This is the seam the rest of the application uses — `orchestrator.ts` today,
 * and tomorrow the voice transport, which will call exactly this with a
 * transcribed utterance instead of typed text. Nothing above this function
 * knows LangGraph exists.
 */
export async function runInterviewTurn(
  llm: InterviewLLM,
  input: RunTurnInput,
): Promise<RunTurnResult> {
  const openQuestion = getCurrentQuestion(input.plan, input.state);

  const initial: InterviewAgentState = {
    interviewId: input.interviewId,
    minutesLeft: input.minutesLeft ?? null,
    blueprint: input.blueprint,
    plan: input.plan,
    interviewState: input.state,
    currentQuestionId: input.questionId,
    currentQuestionIndex: input.state.currentQuestionIndex,
    currentQuestion: openQuestion?.spokenText ?? openQuestion?.text ?? "",
    candidateAnswer: input.answerText,
    transcript: input.state.transcript,
    evidence: input.state.evidenceByQuestionId,
    followUpCount: input.state.followUpsAsked,
    maxFollowUps: followUpBudgetFor(openQuestion),
    redirectCount: input.state.redirectsAsked ?? 0,
    repeatCount: input.state.repeatsAsked ?? 0,
    depthLevel: input.state.depthLevel ?? 1,
    escalationsAsked: input.state.escalationsAsked ?? 0,
    decision: null,
    lastDecision: null,
    nextPrompt: null,
    finished: false,
    status: input.state.status,
    error: null,
  };

  let final: InterviewAgentState = initial;
  const trace: string[] = [];
  try {
    // Streamed rather than invoked so the executed node names are captured.
    // `updates` names each node as it finishes; `values` carries the merged
    // state, whose last emission is the final state `invoke` would have
    // returned. Same execution, one extra piece of evidence.
    const stream = await graphFor(llm).stream(initial, {
      streamMode: ["updates", "values"],
    });
    for await (const [mode, chunk] of stream as AsyncIterable<
      [string, unknown]
    >) {
      if (mode === "updates") {
        trace.push(...Object.keys(chunk as Record<string, unknown>));
      } else if (mode === "values") {
        final = chunk as InterviewAgentState;
      }
    }
  } catch (error) {
    // A graph-level throw is a bug, not a candidate problem. Surface it as a
    // failed turn so the caller leaves the persisted state untouched and the
    // candidate can retry rather than losing the attempt.
    logger.error("[interview-agent] graph invocation failed", {
      interviewId: input.interviewId,
      questionId: input.questionId,
      error: String(error),
    });
    return { ok: false, message: "The interview could not process that answer." };
  }

  if (final.error) return { ok: false, message: final.error };

  return {
    ok: true,
    data: {
      state: final.interviewState,
      action: final.lastDecision ?? "NEXT_QUESTION",
      prompt: final.nextPrompt,
      questionId: final.finished ? null : final.currentQuestionId,
      finished: final.finished,
      degraded: final.decision?.degraded ?? false,
      proposed: final.decision?.action ?? null,
      trace,
    },
  };
}
