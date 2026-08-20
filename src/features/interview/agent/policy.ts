import {
  MAX_REDIRECTS_PER_QUESTION,
  MAX_REPEATS_PER_QUESTION,
} from "@/features/interview/constants";
import { followUpBudgetFor } from "@/features/interview/state";
import type {
  InterviewState,
  PlannedQuestion,
} from "@/features/interview/types";
import { decideLadderMove } from "@/features/interview/agent/depth";
import type {
  AgentAction,
  InterviewDecision,
} from "@/features/interview/agent/types";

/**
 * The deterministic routing policy — the boundary between "what the model
 * noticed" and "what the interview does".
 *
 * Everything here is a pure function of the proposed decision plus counters the
 * server holds. The model's action is treated as a REQUEST that must be
 * affordable. If it is not, the request is downgraded, never negotiated:
 *
 *   FOLLOW_UP over budget      -> NEXT_QUESTION
 *   FOLLOW_UP with no text     -> NEXT_QUESTION
 *   FOLLOW_UP on a stuck answer-> NEXT_QUESTION  (probing a blank is cruelty)
 *   REDIRECT over cap          -> NEXT_QUESTION
 *   REPEAT over cap            -> NEXT_QUESTION
 *
 * A model that hallucinates unlimited follow-ups, or that decides to be helpful
 * and answer a trivia question, changes nothing: the action set it can reach is
 * bounded here.
 */

/** Said verbatim on every redirect. Standardized so no candidate gets a softer one. */
export const REDIRECT_LINE =
  "I'll keep us focused on the interview for now. Let's continue with the current question.";

export const REPEAT_LINE = "Sure — here's the question again.";

/** Said once, when the interview ends. */
export const CLOSING_LINE =
  "That's everything I wanted to cover. Thanks for walking me through your work.";

export type PolicyCounters = {
  followUpsAsked: number;
  redirectsAsked: number;
  repeatsAsked: number;
};

export type PolicyOutcome = {
  action: Exclude<AgentAction, "COMPLETE">;
  /** Why the proposal was or was not honoured. Logged, never shown to candidates. */
  rationale: string;
  /**
   * Text for an ESCALATE turn, taken from the bank rung. Follow-up text is
   * still resolved by `resolveFollowUpText`, because it may legitimately come
   * from the model; an escalation may not.
   */
  probeText?: string;
  /** Depth being moved to, for logging and the demo view. */
  probeLevel?: number;
};

/**
 * Turns the model's report into the interview's next move.
 *
 * Order matters and encodes the product rules:
 *   1. OFF_TOPIC never becomes an answer, whatever the model proposed
 *   2. REPEAT is free and legitimate on a voice interview
 *   3. everything else goes to the depth ladder, which decides DIRECTION
 *   4. budgets decide whether the ladder's choice is affordable
 *
 * Step 3 is the new behaviour. Previously a sufficient answer always fell
 * through to NEXT_QUESTION, which is what made the interview a questionnaire.
 */
export function routeDecision(
  question: PlannedQuestion,
  decision: InterviewDecision,
  counters: PolicyCounters,
  state: InterviewState,
): PolicyOutcome {
  const stuck = decision.evidence.flaggedIssues.includes("stuck_or_evasive");
  const relevance = decision.evidence.relevance ?? "ON_TOPIC";
  const offTopic =
    decision.evidence.flaggedIssues.includes("off_topic") ||
    relevance === "OFF_TOPIC";

  // REPEAT is checked BEFORE relevance. "Sorry, could you say that again?" has
  // nothing in common with the question's subject matter, so any relevance
  // judgment will read it as off-topic — but it is a legitimate meta-request,
  // especially on a voice interview where audio genuinely drops. Redirecting
  // someone who simply could not hear the question would be a bug that only
  // ever hurts honest candidates. Repeats are capped and record no evidence, so
  // letting them take precedence costs nothing.
  if (decision.action === "REPEAT") {
    if (counters.repeatsAsked < MAX_REPEATS_PER_QUESTION) {
      return { action: "REPEAT", rationale: "Candidate asked for the question again." };
    }
    return {
      action: "NEXT_QUESTION",
      rationale: `Repeat cap (${MAX_REPEATS_PER_QUESTION}) reached; moving on.`,
    };
  }

  // Off-topic is decided by the EVIDENCE as well as the proposed action. A
  // model that reports off_topic but proposes NEXT_QUESTION would otherwise let
  // a non-answer count as an answered question.
  const wantsRedirect = decision.action === "REDIRECT" || offTopic;

  if (wantsRedirect) {
    if (counters.redirectsAsked < MAX_REDIRECTS_PER_QUESTION) {
      return { action: "REDIRECT", rationale: "Off-topic; question stays open." };
    }
    return {
      action: "NEXT_QUESTION",
      rationale: `Redirect cap (${MAX_REDIRECTS_PER_QUESTION}) reached; moving on.`,
    };
  }

  if (stuck) {
    return {
      action: "NEXT_QUESTION",
      rationale: "Candidate is stuck; probing further would not help.",
    };
  }

  const ladder = decideLadderMove(question, decision.evidence, state);

  if (ladder.move === "ESCALATE") {
    return {
      action: "ESCALATE",
      rationale: ladder.rationale,
      probeText: ladder.probe.text,
      probeLevel: ladder.probe.level,
    };
  }

  if (ladder.move === "SCAFFOLD") {
    const budget = followUpBudgetFor(question);

    if (counters.followUpsAsked >= budget) {
      return {
        action: "NEXT_QUESTION",
        rationale: `Follow-up budget for ${question.id} is ${budget}, already used ${counters.followUpsAsked}.`,
      };
    }

    // WHICH probe to use depends on how the candidate is doing, not on what is
    // available:
    //
    //   WEAK    → the banked scaffold first. It is deliberately narrower and
    //             simpler than the question. A model's contextual probe is
    //             often just as hard as the thing they already could not
    //             answer, which helps nobody.
    //   PARTIAL → the model's probe first. They are one item short, so the best
    //             question is the one that targets what they actually said.
    //
    // The bank's generic follow-up backstops both.
    const modelProbe = (decision.followUpQuestion ?? "").trim();
    const scaffold = (ladder.probe?.text ?? "").trim();
    const banked = (question.followUpPrompt ?? "").trim();

    const text =
      ladder.strength === "WEAK"
        ? scaffold || modelProbe || banked
        : modelProbe || scaffold || banked;

    if (text.length === 0) {
      return {
        action: "NEXT_QUESTION",
        rationale: "No usable probe text available.",
      };
    }

    return {
      action: "FOLLOW_UP",
      rationale: ladder.rationale,
      probeText: text,
    };
  }

  return { action: "NEXT_QUESTION", rationale: ladder.rationale };
}

/**
 * Neutral fallbacks, used when the model gives no usable acknowledgement — the
 * mock provider, a degraded turn, or a sentence rejected by the rules below.
 * Chosen by question order rather than at random so a given interview is
 * reproducible and the same candidate never hears the same line twice running.
 */
const NEUTRAL_ACKNOWLEDGEMENTS = [
  "Thanks for walking me through that.",
  "Got it, thank you.",
  "Understood — thanks.",
  "Thanks, that's useful.",
];

/** Hard ceiling on a spoken acknowledgement. */
const MAX_ACKNOWLEDGEMENT_CHARS = 200;

/**
 * The sentence spoken before the next question.
 *
 * The model drafts it, but this function decides whether it may be said. Two
 * rules are enforced in code rather than trusted to the prompt:
 *
 *   - it may not contain a question. An acknowledgement that asks something is
 *     an unbudgeted follow-up wearing a friendly hat, and would let the model
 *     route around `routeDecision` entirely.
 *   - it is length-capped, so a model that starts monologuing cannot turn the
 *     hand-off into a speech.
 *
 * Anything rejected falls back to a neutral line, so the interview always sounds
 * continuous even when the model is unavailable.
 */
export function resolveAcknowledgement(
  decision: InterviewDecision,
  questionOrder: number,
): string {
  const drafted = (decision.acknowledgement ?? "").replace(/\s+/g, " ").trim();

  const usable =
    drafted.length > 0 &&
    drafted.length <= MAX_ACKNOWLEDGEMENT_CHARS &&
    !drafted.includes("?");

  if (usable) return drafted;

  return NEUTRAL_ACKNOWLEDGEMENTS[
    Math.max(0, questionOrder - 1) % NEUTRAL_ACKNOWLEDGEMENTS.length
  ]!;
}

/**
 * The follow-up text actually spoken. Prefers the model's contextual wording and
 * falls back to the bank's own probe, which targets the gap the question was
 * written to expose — so a drafting failure still produces an on-topic probe.
 */
export function resolveFollowUpText(
  question: PlannedQuestion,
  decision: InterviewDecision,
): string | null {
  const drafted = (decision.followUpQuestion ?? "").trim();
  if (drafted.length > 0) return drafted;
  const banked = (question.followUpPrompt ?? "").trim();
  return banked.length > 0 ? banked : null;
}
