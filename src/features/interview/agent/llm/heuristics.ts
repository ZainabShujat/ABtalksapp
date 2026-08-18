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
 *      the interview must keep running, and it must keep refusing to answer
 *      off-topic questions even with no model available
 *   2. the engine behind the mock provider used by tests and local development
 *
 * These are keyword rules, not understanding. They exist so that "the LLM is
 * down" degrades the quality of probing rather than the integrity of the
 * interview.
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
 * Off-topic detection. Anything that reads as the candidate interrogating the
 * interviewer, or as general trivia, is off-topic — the interviewer is not a
 * chatbot and must not be turned into one mid-assessment.
 */
const OFF_TOPIC_PATTERNS = [
  /\bwho (is|was|are) the (pm|prime minister|president|ceo)\b/i,
  /\bwhat('?s| is) the (capital|weather|time|date)\b/i,
  /\btell me a (joke|story)\b/i,
  /\bwrite (me )?(a|some) (poem|code|essay|program)\b/i,
  /\bwhat model are you\b/i,
  /\bare you (an? )?(ai|bot|human|chatgpt|claude)\b/i,
  /\b(who|what) (is|are) you\b/i,
  /\bcan you (answer|solve|do) (this|it) for me\b/i,
  /\bhow (much|many) (do|does) .* (cost|earn|pay)\b/i,
  /\bwhat('?s| is) my score\b/i,
];

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

export function looksLikeRepeatRequest(text: string): boolean {
  return REPEAT_PATTERNS.some((p) => p.test(text));
}

export function looksOffTopic(text: string): boolean {
  return OFF_TOPIC_PATTERNS.some((p) => p.test(text));
}

/** Word count is a weak proxy for depth; used only to separate "thin" answers. */
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function heuristicEvidence(answerText: string): AnswerEvidence {
  const stuck = looksStuck(answerText);
  const offTopic = looksOffTopic(answerText);
  const words = wordCount(answerText);

  const practicalFound = !stuck && !offTopic && PRACTICAL_PATTERNS.test(answerText);
  const conceptualFound =
    !stuck && !offTopic && words >= 20 && CONCEPTUAL_PATTERNS.test(answerText);
  const tradeoffsFound =
    !stuck && !offTopic && TRADEOFF_PATTERNS.test(answerText) && words >= 25;

  const flaggedIssues: AnswerEvidence["flaggedIssues"] = [];
  if (stuck) flaggedIssues.push("stuck_or_evasive");
  if (offTopic) flaggedIssues.push("off_topic");
  if (!stuck && !offTopic && !practicalFound && words >= 15) {
    flaggedIssues.push("no_practical_evidence");
  }

  return {
    conceptualFound,
    practicalFound,
    tradeoffsFound,
    flaggedIssues,
    reasoning: "Keyword heuristic — no semantic model was available.",
  };
}

/**
 * The decision used when no validated model output exists.
 *
 * Bias is intentional: when in doubt, MOVE ON. A wrongly-granted follow-up
 * costs the candidate time on a question the system cannot even judge, while a
 * wrongly-skipped one only forfeits a probe. Off-topic still redirects, because
 * that rule protects the interview rather than the score.
 */
export function fallbackDecision(input: AnalyzeAnswerInput): InterviewDecision {
  const { answerText, question, followUpsRemaining } = input;
  const evidence = heuristicEvidence(answerText);

  let action: LlmAction = "NEXT_QUESTION";
  if (looksOffTopic(answerText)) action = "REDIRECT";
  else if (looksLikeRepeatRequest(answerText)) action = "REPEAT";
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
