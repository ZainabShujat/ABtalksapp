import { logger } from "@/lib/logger";
import { mergeEvidence } from "@/features/interview/evidence";
import {
  activeQuestionView,
  classifyAnswer,
  questionAsAsked,
  updateCompetenceSignal,
} from "@/features/interview/agent/depth";
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
  resolveClarification,
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
    currentQuestion: current.spokenText ?? current.text,
    currentQuestionIndex: withAnswer.currentQuestionIndex,
    followUpCount: withAnswer.followUpsAsked,
    maxFollowUps: followUpBudgetFor(current),
    redirectCount: withAnswer.redirectsAsked ?? 0,
    repeatCount: withAnswer.repeatsAsked ?? 0,
    depthLevel: withAnswer.depthLevel ?? 1,
    escalationsAsked: withAnswer.escalationsAsked ?? 0,
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

    // Once escalated, the candidate is answering the RUNG, so that is what the
    // evaluator must grade against — its text and its checklist, not the core
    // question's.
    const depthLevel = state.interviewState.depthLevel ?? 1;
    const asked = questionAsAsked(question, depthLevel);
    const view = activeQuestionView(question, depthLevel);

    const decision = await llm.analyzeAnswer({
      question: asked,
      answerText: state.candidateAnswer,
      priorEvidence:
        state.interviewState.evidenceByQuestionId[view.evidenceKey] ?? null,
      followUpsRemaining: Math.max(
        0,
        state.maxFollowUps - state.interviewState.followUpsAsked,
      ),
      recentTranscript: state.interviewState.transcript,
    });

    logger.info("[interview-agent] answer analyzed", {
      interviewId: state.interviewId,
      questionId: view.evidenceKey,
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

  const outcome = routeDecision(
    questionAsAsked(question, state.interviewState.depthLevel ?? 1),
    state.decision,
    {
      followUpsAsked: state.interviewState.followUpsAsked,
      redirectsAsked: state.interviewState.redirectsAsked ?? 0,
      repeatsAsked: state.interviewState.repeatsAsked ?? 0,
      clarificationsAsked: state.interviewState.clarificationsAsked ?? 0,
    },
    state.interviewState,
  );

  if (outcome.action !== state.decision.action) {
    logger.info("[interview-agent] policy decided", {
      interviewId: state.interviewId,
      questionId: question.id,
      proposed: state.decision.action,
      applied: outcome.action,
      depthLevel: state.interviewState.depthLevel ?? 1,
      rationale: outcome.rationale,
    });
  }

  // The probe text is resolved by the policy (an escalation rung must come from
  // the bank, never from the model), so it is staged here for the branch node.
  // An escalation speaks the bridge first, then the authored rung. Joining
  // them here keeps `applyEscalate` a pass-through and leaves the bank text
  // the only thing the ladder actually chose.
  const staged =
    outcome.action === "ESCALATE" && outcome.probeText
      ? [outcome.bridgeText, outcome.probeText].filter(Boolean).join("\n\n")
      : (outcome.probeText ?? null);

  return {
    lastDecision: outcome.action,
    nextPrompt: staged,
  };
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
    state.nextPrompt ??
    (question && state.decision
      ? resolveFollowUpText(question, state.decision)
      : null);
  // Policy already guaranteed usable text; this is belt-and-braces.
  return text
    ? { nextPrompt: text }
    : { lastDecision: "NEXT_QUESTION", nextPrompt: null };
}

/**
 * The escalation branch: the candidate cleared the bar, so the interview asks a
 * harder question instead of thanking them and moving on.
 *
 * The text is ALWAYS the banked rung staged by the policy. There is no model
 * fallback here on purpose — an escalation that the model invented would not be
 * comparable between candidates, and "we went deeper" would stop meaning the
 * same thing on two transcripts. No rung, no escalation.
 */
export function applyEscalate(state: InterviewAgentState): NodeUpdate {
  if (!state.nextPrompt) {
    return { lastDecision: "NEXT_QUESTION", nextPrompt: null };
  }
  return { nextPrompt: state.nextPrompt };
}

export function applyRedirect(state: InterviewAgentState): NodeUpdate {
  return { nextPrompt: `${REDIRECT_LINE}\n\n${state.currentQuestion}` };
}

export function applyRepeat(state: InterviewAgentState): NodeUpdate {
  return { nextPrompt: `${REPEAT_LINE}\n\n${state.currentQuestion}` };
}

/**
 * Answers what the candidate asked about the question, then restates it.
 *
 * The restatement is `state.currentQuestion` — the banked text, verbatim. The
 * model explains a term; it never gets to reword the thing being assessed.
 */
export function applyClarify(state: InterviewAgentState): NodeUpdate {
  const answer = state.decision
    ? resolveClarification(state.decision)
    : REPEAT_LINE;
  return { nextPrompt: `${answer}\n\n${state.currentQuestion}` };
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

  if (
    state.lastDecision === "REDIRECT" ||
    state.lastDecision === "REPEAT" ||
    state.lastDecision === "CLARIFY"
  ) {
    const bumped: InterviewState = {
      ...state.interviewState,
      redirectsAsked:
        (state.interviewState.redirectsAsked ?? 0) +
        (state.lastDecision === "REDIRECT" ? 1 : 0),
      repeatsAsked:
        (state.interviewState.repeatsAsked ?? 0) +
        (state.lastDecision === "REPEAT" ? 1 : 0),
      clarificationsAsked:
        (state.interviewState.clarificationsAsked ?? 0) +
        (state.lastDecision === "CLARIFY" ? 1 : 0),
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

  const depthLevel = state.interviewState.depthLevel ?? 1;
  const asked = questionAsAsked(question, depthLevel);
  const view = activeQuestionView(question, depthLevel);

  const proposed: TurnAction =
    state.lastDecision === "FOLLOW_UP"
      ? "FOLLOW_UP"
      : state.lastDecision === "ESCALATE"
        ? "ESCALATE"
        : "NEXT_QUESTION";
  const prior = state.interviewState.evidenceByQuestionId[view.evidenceKey];

  // The competence read is updated from the RAW answer, before budgets are
  // applied: whether the candidate was strong is a fact about the answer, not
  // about whether we could afford to act on it.
  const strength = classifyAnswer(asked, state.decision.evidence);
  const withSignal: InterviewState = {
    ...state.interviewState,
    competenceSignal: updateCompetenceSignal(
      state.interviewState.competenceSignal,
      question.competency,
      strength,
    ),
  };

  // Routing reads the RAW evidence for this answer so a candidate who recovers
  // on a follow-up is not still treated as stuck; storage keeps the MERGED
  // evidence so credit earned earlier in the question survives.
  const advanced = advanceTurn(
    state.plan,
    withSignal,
    question.id,
    state.decision.evidence,
    proposed,
    view.evidenceKey,
  );

  let nextState: InterviewState = prior
    ? {
        ...advanced.state,
        evidenceByQuestionId: {
          ...advanced.state.evidenceByQuestionId,
          [view.evidenceKey]: mergeEvidence(prior, state.decision.evidence),
        },
      }
    : advanced.state;

  // FOLLOW_UP and ESCALATE both keep the same question on the floor; they
  // differ in which budget they spend and in why. Sharing the branch keeps that
  // symmetry visible rather than duplicating the transcript bookkeeping.
  if (
    (advanced.action === "FOLLOW_UP" || advanced.action === "ESCALATE") &&
    state.nextPrompt
  ) {
    // React before probing. Previously only NEXT_QUESTION carried an
    // acknowledgement, so a follow-up or an escalation arrived as a bare
    // harder question with no sign the previous answer had been heard — which
    // reads as the interviewer ignoring you and moving the goalposts.
    const probeAck = resolveAcknowledgement(state.decision, question.order);
    nextState = appendLine(
      nextState,
      "interviewer",
      `${probeAck}\n\n${state.nextPrompt}`,
      question.id,
    );
    return {
      interviewState: nextState,
      transcript: nextState.transcript,
      evidence: nextState.evidenceByQuestionId,
      followUpCount: nextState.followUpsAsked,
      depthLevel: nextState.depthLevel ?? 1,
      escalationsAsked: nextState.escalationsAsked ?? 0,
      lastDecision: advanced.action,
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
    currentQuestion: next.spokenText ?? next.text,
    currentQuestionIndex: nextState.currentQuestionIndex,
    followUpCount: 0,
    maxFollowUps: followUpBudgetFor(next),
    redirectCount: 0,
    repeatCount: 0,
    depthLevel: 1,
    escalationsAsked: 0,
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
