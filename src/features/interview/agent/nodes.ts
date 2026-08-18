import { logger } from "@/lib/logger";
import { mergeEvidence } from "@/features/interview/evidence";
import {
  advanceTurn,
  appendLine,
  followUpBudgetFor,
  getCurrentQuestion,
} from "@/features/interview/state";
import type { InterviewState, TurnAction } from "@/features/interview/types";
import {
  CLOSING_LINE,
  REDIRECT_LINE,
  REPEAT_LINE,
  resolveAcknowledgement,
  resolveFollowUpText,
  routeDecision,
} from "@/features/interview/agent/policy";
import type { InterviewAgentState } from "@/features/interview/agent/types";
import type { InterviewLLM } from "@/features/interview/agent/llm/provider";

/**
 * The graph's nodes. Each is a plain async function of state that returns a
 * PARTIAL state — no node mutates its input, so a turn can be replayed or
 * inspected step by step.
 *
 * Only `analyzeAnswer` talks to a model. Every other node is deterministic,
 * which is what lets the routing tests run with no network at all.
 */

export type NodeUpdate = Partial<InterviewAgentState>;

/* ------------------------------------------------------------ receiveAnswer */

/**
 * Admits the answer into the turn.
 *
 * The server-side guards live here rather than in the caller so that every path
 * into the graph — text runner today, voice transport tomorrow — gets them:
 * the interview must be open, and the answer must belong to the question the
 * SERVER believes is on the floor. A mismatch is a stale or replayed client,
 * not a valid turn, and short-circuits to END.
 */
export function receiveAnswer(state: InterviewAgentState): NodeUpdate {
  if (state.interviewState.status !== "IN_PROGRESS") {
    return { error: "This interview is not in progress.", finished: true };
  }

  const current = getCurrentQuestion(state.plan, state.interviewState);
  if (!current) {
    return { error: "No question is currently open.", finished: true };
  }
  if (current.id !== state.currentQuestionId) {
    return { error: "That answer is for a different question.", finished: true };
  }

  const withAnswer = appendLine(
    state.interviewState,
    "candidate",
    state.candidateAnswer,
    current.id,
  );

  return {
    interviewState: withAnswer,
    transcript: withAnswer.transcript,
    currentQuestion: current.text,
    currentQuestionIndex: withAnswer.currentQuestionIndex,
    followUpCount: withAnswer.followUpsAsked,
    maxFollowUps: followUpBudgetFor(current),
    redirectCount: withAnswer.redirectsAsked ?? 0,
    repeatCount: withAnswer.repeatsAsked ?? 0,
  };
}

/* ------------------------------------------------------------ analyzeAnswer */

/**
 * The single LLM call site in the graph.
 *
 * It produces an already-validated `InterviewDecision`; the provider handles
 * schema validation, one retry and the deterministic fallback, so this node has
 * no error branch. That is deliberate — "the model failed" must not be a
 * control-flow concept inside the interview graph.
 */
export function createAnalyzeAnswer(llm: InterviewLLM) {
  return async function analyzeAnswer(
    state: InterviewAgentState,
  ): Promise<NodeUpdate> {
    const question = getCurrentQuestion(state.plan, state.interviewState);
    if (!question) {
      return { error: "No question is currently open.", finished: true };
    }

    const decision = await llm.analyzeAnswer({
      question,
      answerText: state.candidateAnswer,
      priorEvidence:
        state.interviewState.evidenceByQuestionId[question.id] ?? null,
      followUpsRemaining: Math.max(
        0,
        state.maxFollowUps - state.interviewState.followUpsAsked,
      ),
      recentTranscript: state.interviewState.transcript,
    });

    logger.info("[interview-agent] answer analyzed", {
      interviewId: state.interviewId,
      questionId: question.id,
      provider: llm.name,
      proposed: decision.action,
      degraded: decision.degraded,
    });

    return { decision };
  };
}

/* ------------------------------------------------------------ routeResponse */

/**
 * Turns the model's PROPOSAL into the interview's DECISION, under budgets the
 * model never sees enforced. Nothing is persisted here — this node only names
 * the branch to take.
 */
export function routeResponse(state: InterviewAgentState): NodeUpdate {
  const question = getCurrentQuestion(state.plan, state.interviewState);
  if (!question || !state.decision) {
    return { lastDecision: "NEXT_QUESTION" };
  }

  const outcome = routeDecision(question, state.decision, {
    followUpsAsked: state.interviewState.followUpsAsked,
    redirectsAsked: state.interviewState.redirectsAsked ?? 0,
    repeatsAsked: state.interviewState.repeatsAsked ?? 0,
  });

  if (outcome.action !== state.decision.action) {
    logger.info("[interview-agent] policy overrode model action", {
      interviewId: state.interviewId,
      questionId: question.id,
      proposed: state.decision.action,
      applied: outcome.action,
      rationale: outcome.rationale,
    });
  }

  return { lastDecision: outcome.action };
}

/* --------------------------------------------------- branch: prompt drafting */

/**
 * The four branch nodes exist as separate nodes rather than as `if` arms so the
 * graph matches the product spec, and so a later phase can hang extra behaviour
 * (a proctoring check on redirect, a hint budget on follow-up) on one branch
 * without touching the others.
 */

export function applyFollowUp(state: InterviewAgentState): NodeUpdate {
  const question = getCurrentQuestion(state.plan, state.interviewState);
  const text =
    question && state.decision
      ? resolveFollowUpText(question, state.decision)
      : null;
  // Policy already guaranteed usable text; this is belt-and-braces.
  return text
    ? { nextPrompt: text }
    : { lastDecision: "NEXT_QUESTION", nextPrompt: null };
}

export function applyRedirect(state: InterviewAgentState): NodeUpdate {
  return { nextPrompt: `${REDIRECT_LINE}\n\n${state.currentQuestion}` };
}

export function applyRepeat(state: InterviewAgentState): NodeUpdate {
  return { nextPrompt: `${REPEAT_LINE}\n\n${state.currentQuestion}` };
}

/** Next question text is only known after the state advances, so this is a no-op. */
export function applyNextQuestion(): NodeUpdate {
  return { nextPrompt: null };
}

/* -------------------------------------------------------------- updateState */

/**
 * The only node that writes to the persisted interview state.
 *
 * FOLLOW_UP and NEXT_QUESTION go through `advanceTurn`, the pre-existing
 * deterministic budget machine, so the LangGraph agent inherits the exact
 * termination rules the Day-1 backend was tested against rather than inventing
 * parallel ones.
 *
 * REDIRECT and REPEAT never reach `advanceTurn`: they record no evidence, spend
 * no follow-up, and leave the question index untouched. An off-topic remark is
 * not an answer, and must not be scored as one.
 */
export function updateState(state: InterviewAgentState): NodeUpdate {
  const question = getCurrentQuestion(state.plan, state.interviewState);
  if (!question || !state.decision) {
    return { finished: true, status: state.interviewState.status };
  }

  if (state.lastDecision === "REDIRECT" || state.lastDecision === "REPEAT") {
    const isRedirect = state.lastDecision === "REDIRECT";
    const bumped: InterviewState = {
      ...state.interviewState,
      redirectsAsked:
        (state.interviewState.redirectsAsked ?? 0) + (isRedirect ? 1 : 0),
      repeatsAsked:
        (state.interviewState.repeatsAsked ?? 0) + (isRedirect ? 0 : 1),
    };
    const next = appendLine(
      bumped,
      "interviewer",
      state.nextPrompt ?? question.text,
      question.id,
    );
    return {
      interviewState: next,
      transcript: next.transcript,
      redirectCount: next.redirectsAsked ?? 0,
      repeatCount: next.repeatsAsked ?? 0,
      status: next.status,
      finished: false,
    };
  }

  const proposed: TurnAction =
    state.lastDecision === "FOLLOW_UP" ? "FOLLOW_UP" : "NEXT_QUESTION";
  const prior = state.interviewState.evidenceByQuestionId[question.id];

  // Routing reads the RAW evidence for this answer so a candidate who recovers
  // on a follow-up is not still treated as stuck; storage keeps the MERGED
  // evidence so credit earned earlier in the question survives.
  const advanced = advanceTurn(
    state.plan,
    state.interviewState,
    question.id,
    state.decision.evidence,
    proposed,
  );

  let nextState: InterviewState = prior
    ? {
        ...advanced.state,
        evidenceByQuestionId: {
          ...advanced.state.evidenceByQuestionId,
          [question.id]: mergeEvidence(prior, state.decision.evidence),
        },
      }
    : advanced.state;

  if (advanced.action === "FOLLOW_UP" && state.nextPrompt) {
    nextState = appendLine(
      nextState,
      "interviewer",
      state.nextPrompt,
      question.id,
    );
    return {
      interviewState: nextState,
      transcript: nextState.transcript,
      evidence: nextState.evidenceByQuestionId,
      followUpCount: nextState.followUpsAsked,
      lastDecision: "FOLLOW_UP",
      status: nextState.status,
      finished: false,
    };
  }

  if (advanced.action === "END_INTERVIEW") {
    return {
      interviewState: nextState,
      transcript: nextState.transcript,
      evidence: nextState.evidenceByQuestionId,
      lastDecision: "COMPLETE",
      status: "COMPLETED",
      finished: true,
    };
  }

  const next = getCurrentQuestion(state.plan, nextState);
  if (!next) {
    return {
      interviewState: { ...nextState, status: "COMPLETED" },
      transcript: nextState.transcript,
      evidence: nextState.evidenceByQuestionId,
      lastDecision: "COMPLETE",
      status: "COMPLETED",
      finished: true,
    };
  }

  // The interviewer reacts to what was just said before moving on, so a handover
  // sounds like a conversation instead of a questionnaire advancing. The
  // acknowledgement is attached to the NEW question's turn because that is what
  // is spoken as one breath.
  const acknowledgement = resolveAcknowledgement(state.decision, question.order);
  const spoken = `${acknowledgement}\n\n${next.text}`;

  nextState = appendLine(nextState, "interviewer", spoken, next.id);
  return {
    interviewState: nextState,
    transcript: nextState.transcript,
    evidence: nextState.evidenceByQuestionId,
    currentQuestionId: next.id,
    currentQuestion: next.text,
    currentQuestionIndex: nextState.currentQuestionIndex,
    followUpCount: 0,
    maxFollowUps: followUpBudgetFor(next),
    redirectCount: 0,
    repeatCount: 0,
    nextPrompt: spoken,
    lastDecision: "NEXT_QUESTION",
    status: nextState.status,
    finished: false,
  };
}

/* ---------------------------------------------------------------- complete */

/** Appends the closing line. Reached only when `shouldContinue` says no. */
export function completeInterview(state: InterviewAgentState): NodeUpdate {
  const closed = appendLine(
    { ...state.interviewState, status: "COMPLETED" },
    "interviewer",
    CLOSING_LINE,
    null,
  );
  logger.info("[interview-agent] interview reached completion", {
    interviewId: state.interviewId,
    questionsAnswered: Object.keys(closed.evidenceByQuestionId).length,
  });
  return {
    interviewState: closed,
    transcript: closed.transcript,
    nextPrompt: CLOSING_LINE,
    lastDecision: "COMPLETE",
    status: "COMPLETED",
    finished: true,
  };
}

/** The `shouldContinue?` edge. Pure predicate over the persisted state. */
export function shouldContinue(
  state: InterviewAgentState,
): "continue" | "complete" {
  if (state.finished || state.interviewState.status === "COMPLETED") {
    return "complete";
  }
  return "continue";
}
