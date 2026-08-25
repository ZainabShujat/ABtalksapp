import {
  MAX_CLARIFICATIONS_PER_QUESTION,
  MAX_REDIRECTS_PER_QUESTION,
  MAX_REPEATS_PER_QUESTION,
} from "@/features/interview/constants";
import { followUpBudgetFor } from "@/features/interview/state";
import type {
  InterviewState,
  PlannedQuestion,
} from "@/features/interview/types";
import {
  decideLadderMove,
  nextScaffoldProbe,
} from "@/features/interview/agent/depth";
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

export const REPEAT_LINE = "Sure. Here's the question again.";

/**
 * The interviewer's opening, spoken before the first question.
 *
 * This used to be one flat sentence — "Welcome to your AI Cohort Interview.
 * I'll be asking you a few questions about what you've learned. Let's begin." —
 * concatenated straight onto the first banked question. It announced a product
 * rather than opening a conversation, and because the question followed in the
 * same breath, the interview appeared to start mid-sentence.
 *
 * What a real interviewer does in the first fifteen seconds, and what this now
 * does: greet the person by name, say what the next fifteen minutes are, set
 * two expectations that change how someone answers (think out loud; "I don't
 * know" is a fine answer), and hand over to the first question as a deliberate
 * move rather than a collision.
 *
 * Deterministic, never model-drafted. Every candidate hears the same opening,
 * which is part of what makes two interviews comparable — and the one line
 * guaranteed to be spoken cannot be left to a provider that might be down.
 */
export function openingLine(params: {
  firstName?: string | null;
  blueprint: "DAY_15" | "DAY_31";
  questionCount: number;
}): string {
  const name = (params.firstName ?? "").trim();
  const greeting = name ? `Hi ${name}, thanks for making the time.` : "Thanks for making the time.";

  const framing =
    params.blueprint === "DAY_15"
      ? "This is your Day 15 checkpoint."
      : "This is your final interview for the cohort.";

  const shape =
    params.blueprint === "DAY_15"
      ? "I'll ask you about the work you've submitted so far, and I'll dig deeper into some of your answers as we go."
      : "I'll ask you about what you built across the thirty-one days, and I'll dig deeper into some of your answers as we go.";

  const permission =
    "If you'd like me to repeat or clarify anything, just ask. And if you don't know something, say so and we'll move on.";

  const handover = "Let's start here.";

  return `${greeting} ${framing}\n\n${shape} ${permission}\n\n${handover}`;
}

/** Said once, when the interview ends. */
export const CLOSING_LINE =
  "That's everything I wanted to cover. Thanks for walking me through your work.";

export type PolicyCounters = {
  followUpsAsked: number;
  redirectsAsked: number;
  repeatsAsked: number;
  clarificationsAsked: number;
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
  /** One sentence spoken before `probeText`, linking it to the last answer. */
  bridgeText?: string;
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

  // A clarification is a meta-request about the QUESTION, like REPEAT, and is
  // checked in the same place and for the same reason: relevance scoring reads
  // "what do you mean by locally?" as OFF_TOPIC, because it shares no
  // vocabulary with the question it is asking about. Redirecting someone for
  // asking what a term means punishes the honest candidate and teaches the rest
  // to guess silently. It records no evidence and spends no follow-up budget,
  // so answering costs the assessment nothing.
  if (decision.action === "CLARIFY") {
    if (counters.clarificationsAsked < MAX_CLARIFICATIONS_PER_QUESTION) {
      return {
        action: "CLARIFY",
        rationale: "Candidate asked what the question means.",
      };
    }
    // Out of clarifications: restate rather than explain again. Repeated
    // "explain it differently" is a way to have the question answered for you.
    return {
      action: "REPEAT",
      rationale: `Clarification cap (${MAX_CLARIFICATIONS_PER_QUESTION}) reached; restating.`,
    };
  }

  // "I don't know" / "I can't do that" is checked BEFORE relevance, for the
  // same reason REPEAT is. A candidate who admits they cannot answer has not
  // changed the subject — they have answered honestly with nothing. Relevance
  // scoring reads that as OFF_TOPIC because it shares no vocabulary with the
  // question, and the candidate then gets "I'll keep us focused on the
  // interview", which accuses an honest person of dodging. Moving on records
  // the question as unanswered, which is the correct and sufficient penalty.
  if (stuck) {
    // One nudge, then move on. Answering "I don't know" with silence and the
    // next question is not what an interviewer does: they offer a smaller way
    // in, and only move on if that lands nowhere either. `consecutiveStuckAnswers`
    // is what distinguishes the two — zero means this is their first blank, so
    // they have not been helped yet on this question.
    const scaffold = nextScaffoldProbe(question, decision.evidence);
    const nudge = speakable(scaffold?.text ?? question.followUpPrompt ?? "");
    const alreadyNudged = (state.consecutiveStuckAnswers ?? 0) > 0;
    const budget = followUpBudgetFor(question);

    if (!alreadyNudged && nudge.length > 0 && counters.followUpsAsked < budget) {
      return {
        action: "FOLLOW_UP",
        rationale: "Candidate is stuck; offering one scaffold before moving on.",
        probeText: nudge,
      };
    }

    return {
      action: "NEXT_QUESTION",
      rationale: alreadyNudged
        ? "Candidate still stuck after a scaffold; moving on."
        : "Candidate does not know and no scaffold is available; moving on.",
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
      // The probe text stays the AUTHORED rung, verbatim — an escalation that
      // varied per candidate would stop meaning the same thing on two
      // transcripts. The bridge is the one sentence in front of it that makes
      // it land as a follow-on from what they just said rather than as the next
      // item on a list.
      probeText: ladder.probe.text,
      probeLevel: ladder.probe.level,
      bridgeText: resolveBridge(decision),
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
  "Understood, thanks.",
  "Thanks, that's useful.",
];

/**
 * Used instead when the candidate said they did not know.
 *
 * Thanking someone "for walking me through that" after they said "I don't
 * know" is the single most obviously wrong thing the interviewer can say: it
 * proves nothing was listened to. These lines accept the gap without praising
 * an answer that was never given, and without scolding. The question is already
 * recorded unanswered, so the transcript carries the penalty — the spoken line
 * does not need to.
 */
const STUCK_ACKNOWLEDGEMENTS = [
  "That's alright. Let's move on.",
  "No problem, we can leave that one.",
  "That's fine. Let's try a different one.",
  "Okay, no problem.",
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
  const stuck = decision.evidence.flaggedIssues.includes("stuck_or_evasive");
  const drafted = speakable((decision.acknowledgement ?? "").replace(/\s+/g, " "));

  const usable =
    drafted.length > 0 &&
    drafted.length <= MAX_ACKNOWLEDGEMENT_CHARS &&
    !drafted.includes("?");

  // A drafted line is only trusted when there was something to react to. On a
  // stuck answer the model has nothing to work from and tends to thank the
  // candidate anyway, so the deterministic pool wins.
  if (usable && !stuck) return drafted;

  const pool = stuck ? STUCK_ACKNOWLEDGEMENTS : NEUTRAL_ACKNOWLEDGEMENTS;
  return pool[Math.max(0, questionOrder - 1) % pool.length]!;
}

/** Clarifications may run a little longer than an acknowledgement, not much. */
const MAX_CLARIFICATION_CHARS = 320;

/**
 * Removes the punctuation that makes generated text read as generated.
 *
 * Em dashes are the strongest tell, and they are worse than cosmetic here: the
 * transcript is read by a recruiter, and speech synthesis renders a dash as an
 * abrupt stop rather than the soft aside a writer intended. People speaking
 * out loud use commas and full stops, so that is what the interviewer uses.
 *
 * Applied to every model-drafted line before it is spoken or stored. The
 * authored bank text is written without them in the first place.
 */
export function speakable(text: string): string {
  return text
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s*–\s*/g, ", ")
    .replace(/\s*;\s*/g, ". ")
    .replace(/,\s*([.,!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * The sentence that carries an authored deep probe into the conversation.
 *
 * The probe itself is fixed; what varies is whether it lands as a follow-on
 * from what the candidate just said, or as the next item read off a list. That
 * difference is the whole gap between an interview and a questionnaire, and it
 * costs the assessment nothing because the graded text is unchanged.
 *
 * Rejected if it asks a question: a bridge that asks something is an
 * unbudgeted follow-up in disguise, and would let the model put a second
 * question in front of the one the ladder chose.
 */
export function resolveBridge(decision: InterviewDecision): string {
  const drafted = speakable((decision.bridge ?? "").replace(/\s+/g, " "));
  if (drafted.length === 0 || drafted.length > MAX_ACKNOWLEDGEMENT_CHARS) return "";
  if (drafted.includes("?")) return "";
  return drafted;
}

/**
 * The answer to "what do you mean by X?", spoken before the question is
 * restated verbatim.
 *
 * The model writes this, because a canned gloss cannot answer an arbitrary
 * question about an arbitrary term. Two guards keep it honest: it may not ask
 * anything back, and it is length-capped so the interviewer defines a term
 * rather than delivering a lecture that contains the answer.
 *
 * Falls back to the standard repeat line, so a drafting failure restates the
 * question instead of leaving the candidate with silence.
 */
export function resolveClarification(decision: InterviewDecision): string {
  const drafted = speakable((decision.clarification ?? "").replace(/\s+/g, " "));
  const usable =
    drafted.length > 0 &&
    drafted.length <= MAX_CLARIFICATION_CHARS &&
    !drafted.includes("?");
  return usable ? drafted : REPEAT_LINE;
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
  const drafted = speakable(decision.followUpQuestion ?? "");
  if (drafted.length > 0) return drafted;
  const banked = (question.followUpPrompt ?? "").trim();
  return banked.length > 0 ? banked : null;
}
