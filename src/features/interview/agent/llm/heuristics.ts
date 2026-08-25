import type { AnswerEvidence } from "@/features/interview/types";
import type {
  InterviewDecision,
  LlmAction,
} from "@/features/interview/agent/types";
import type { AnalyzeAnswerInput } from "@/features/interview/agent/llm/provider";

/**
 * Model-free answer classification.
 *
 * Two jobs, both deliberately crude:
 *   1. the DETERMINISTIC FALLBACK when a provider fails or returns garbage —
 *      the interview must keep running rather than ending on a model outage
 *   2. the engine behind the mock provider used by tests and local development
 *
 * These are structural rules, not understanding. They exist so that "the LLM is
 * down" degrades the quality of probing rather than the integrity of the
 * interview. Anything requiring comprehension — relevance, which checklist
 * items an answer covered — is deliberately NOT attempted here.
 */

const BLANK_ANSWER_CHARS = 5;

const STUCK_PATTERNS = [
  /^i (don'?t|do not) know\b/i,
  /^no idea\b/i,
  /^not sure\b/i,
  /^(skip|pass|next)\b/i,
  /^(idk|dunno)\b/i,
];

const REPEAT_PATTERNS = [
  /\b(repeat|say that again|come again)\b/i,
  /\bcould you (repeat|rephrase|say)\b/i,
  /\bwhat (was|is) the question\b/i,
  /\bdidn'?t (hear|catch)\b/i,
  /\bcan you rephrase\b/i,
];

/**
 * Off-topic detection is NOT done here any more.
 *
 * This module used to carry a list of topical regexes — Prime Minister, the
 * weather, "tell me a joke". That list was deleted deliberately. Relevance is a
 * semantic judgment: a keyword list cannot tell an on-topic answer that happens
 * to mention cricket from an actual request for the cricket score, and every
 * pattern it does catch is one a candidate can trivially rephrase past.
 *
 * The model reports `relevance` (see `prompt.ts`). When no model is available,
 * the degraded path below reports ON_TOPIC and lets the answer through: during
 * an outage, wrongly redirecting a candidate who gave a good answer is a far
 * worse failure than missing a redirect on someone who asked about the weather.
 *
 * What remains here is STRUCTURAL only — signals that need no understanding of
 * the subject: an empty answer, an explicit "I don't know", a request to repeat
 * the question.
 */

const TRADEOFF_PATTERNS =
  /\b(trade-?off|however|but|limitation|downside|instead of|versus|vs\.?|edge case|fails? when|doesn'?t scale|drawback)\b/i;

const PRACTICAL_PATTERNS =
  /\b(i (built|wrote|used|ran|added|fixed|deployed|tested|implemented|configured|debugged)|we (built|used|ran)|my (code|script|repo|project|chatbot)|ollama|chroma|langchain|fastapi|streamlit|python|prisma|api key|\.py\b|\.json\b)/i;

const CONCEPTUAL_PATTERNS =
  /\b(because|so that|the reason|which means|in other words|the idea is|it works by|this lets|allows us to)\b/i;

export function isBlankAnswer(text: string): boolean {
  return text.trim().length < BLANK_ANSWER_CHARS;
}

export function looksStuck(text: string): boolean {
  const t = text.trim();
  if (isBlankAnswer(t)) return true;
  return STUCK_PATTERNS.some((p) => p.test(t));
}

/**
 * "What do you mean by X?" — a request to define a term IN the question.
 *
 * Distinct from a repeat request, which asks for the same words again. This
 * asks what the words mean, and the honest answer is to explain them. Without
 * this the phrasing shares no vocabulary with the question and gets scored
 * OFF_TOPIC, so a candidate is redirected for asking a fair question.
 *
 * Deliberately narrow. It matches askING about the question, not any sentence
 * containing "mean" — "the mean pooling step" must never land here.
 */
const CLARIFY_PATTERNS = [
  /\bwhat do you mean\b/i,
  /\bwhat does .{1,40} mean\b/i,
  /\bcould you clarify\b/i,
  /\bcan you clarify\b/i,
  /\bnot sure what you('?re| are) asking\b/i,
  /\bwhat exactly (do|are) you\b/i,
];

export function looksLikeClarifyRequest(text: string): boolean {
  return CLARIFY_PATTERNS.some((p) => p.test(text));
}

export function looksLikeRepeatRequest(text: string): boolean {
  return REPEAT_PATTERNS.some((p) => p.test(text));
}

/** Word count is a weak proxy for depth; used only to separate "thin" answers. */
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function heuristicEvidence(answerText: string): AnswerEvidence {
  const stuck = looksStuck(answerText);
  const words = wordCount(answerText);

  const practicalFound = !stuck && PRACTICAL_PATTERNS.test(answerText);
  const conceptualFound =
    !stuck && words >= 20 && CONCEPTUAL_PATTERNS.test(answerText);
  const tradeoffsFound =
    !stuck && TRADEOFF_PATTERNS.test(answerText) && words >= 25;

  const flaggedIssues: AnswerEvidence["flaggedIssues"] = [];
  if (stuck) flaggedIssues.push("stuck_or_evasive");
  if (!stuck && !practicalFound && words >= 15) {
    flaggedIssues.push("no_practical_evidence");
  }

  return {
    conceptualFound,
    practicalFound,
    tradeoffsFound,
    flaggedIssues,
    // No matched-evidence claim: matching an answer to a checklist item needs
    // comprehension, and asserting [] would be read as "covered nothing".
    // Leaving it undefined keeps the degraded turn out of the depth ladder's
    // strong/weak arithmetic entirely.
    relevance: "ON_TOPIC",
    reasoning: "Structural heuristic — no semantic model was available.",
  };
}

/**
 * The decision used when no validated model output exists.
 *
 * Bias is intentional: when in doubt, MOVE ON. A wrongly-granted follow-up
 * costs the candidate time on a question the system cannot even judge, while a
 * wrongly-skipped one only forfeits a probe. Relevance is NOT judged here — see
 * the note at the top of this file — so a degraded turn never redirects.
 */
export function fallbackDecision(input: AnalyzeAnswerInput): InterviewDecision {
  const { answerText, question, followUpsRemaining } = input;
  const evidence = heuristicEvidence(answerText);

  let action: LlmAction = "NEXT_QUESTION";
  if (looksLikeRepeatRequest(answerText)) action = "REPEAT";
  else if (looksLikeClarifyRequest(answerText)) action = "CLARIFY";
  else if (
    !looksStuck(answerText) &&
    followUpsRemaining > 0 &&
    !evidence.practicalFound &&
    question.followUpPrompt
  ) {
    action = "FOLLOW_UP";
  }

  return {
    action,
    reason: "Deterministic fallback — semantic analysis unavailable.",
    evidence,
    followUpQuestion:
      action === "FOLLOW_UP" ? (question.followUpPrompt ?? null) : null,
    confidence: 0.2,
    degraded: true,
  };
}
