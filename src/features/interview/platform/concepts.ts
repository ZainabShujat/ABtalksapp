import type { PlannedQuestion } from "@/features/interview/types";

/**
 * The curriculum's own vocabulary, used to work out what a candidate just
 * talked about and which assessment target sits closest to it.
 *
 * WHERE THE VOCABULARY COMES FROM. The cohort reads `days.json` — a per-day
 * `tools` array and objectives. A pack has no days, so the vocabulary is taken
 * from the pack itself: each question's own text plus its `expectedEvidence`
 * items. That is not a convenience, it is the same principle. Expected evidence
 * is authored curriculum content — "predicts text rather than looking up a
 * stored answer" is exactly the concept that question assesses — so routing on
 * it keeps every decision traceable to something a human wrote, never to a
 * topic a model invented.
 *
 * The consequence worth stating: the planner can only ever move toward a
 * question that already exists in the pack. There is no path by which a
 * candidate mentioning something interesting produces a question nobody
 * authored.
 *
 * Pure module. No model, no database, no I/O.
 */

/** Words too common to identify a topic. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "with", "for", "from", "into", "your",
  "you", "that", "this", "then", "than", "them", "they", "what", "when", "how",
  "why", "which", "who", "was", "were", "are", "is", "be", "been", "being",
  "it", "its", "of", "to", "in", "on", "at", "by", "as", "if", "so", "do",
  "does", "did", "can", "could", "would", "should", "will", "have", "has",
  "had", "not", "no", "yes", "run", "use", "used", "using", "make", "build",
  "built", "get", "got", "one", "two", "all", "any", "own", "out", "up",
  "about", "over", "each", "more", "most", "some", "such", "only", "same",
  "just", "also", "very", "well", "way", "thing", "things", "first", "next",
  "add", "set", "new", "via", "per", "let", "put", "see", "say", "something",
  "actually", "really", "would", "there", "their", "been", "much", "many",
  "give", "take", "want", "need", "know", "think", "like", "look", "come",
  "back", "even", "still", "than", "also", "other", "answer", "question",
  "candidate", "interview", "example", "describes", "explains", "names",
]);

/**
 * Denominator floor for topical overlap. Roughly one clause of real speech.
 *
 * Without it, short answers are explosive: "because it was free" carries two
 * distinctive words, so a single incidental match would score 0.5 and could
 * reroute the whole interview. A two-word answer is the LEAST informative thing
 * a candidate can say and must not be the strongest steer.
 */
const MIN_TOKENS_FOR_CONTINUITY = 8;

/** Lowercase alphanumeric tokens, stopwords and very short words dropped. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((w) => w.replace(/^[.]+|[.]+$/g, ""))
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * The token set one question assesses.
 *
 * Built from the authored question and its expected evidence, plus any deep
 * probe text — a rung is still this question's subject matter, and a candidate
 * who raises it should be steered here rather than away.
 */
export function conceptTokensForQuestion(
  question: PlannedQuestion,
): Set<string> {
  const parts: string[] = [question.text, ...(question.expectedEvidence ?? [])];
  for (const probe of question.deepProbes ?? []) {
    parts.push(probe.text, ...probe.expectedEvidence);
  }

  const tokens = new Set<string>();
  for (const token of tokenize(parts.join(" "))) tokens.add(token);
  return tokens;
}

/**
 * How strongly an answer points at a set of concept tokens, 0..1.
 *
 * The share of the candidate's distinctive words that belong to this target's
 * vocabulary, so a long answer that grazes a topic scores lower than a short
 * one that is entirely about it.
 */
export function topicalOverlap(
  answerText: string,
  targetTokens: ReadonlySet<string>,
): number {
  const said = tokenize(answerText);
  if (said.length === 0 || targetTokens.size === 0) return 0;

  const unique = new Set(said);
  let hits = 0;
  for (const word of unique) if (targetTokens.has(word)) hits += 1;

  return hits / Math.max(unique.size, MIN_TOKENS_FOR_CONTINUITY);
}

/**
 * Which curriculum concepts, across the whole plan, the candidate just raised.
 *
 * Used for the audit trail rather than for routing: it names what the planner
 * saw, so a reordering decision can be explained after the fact.
 */
export function conceptsRaised(
  answerText: string,
  plan: { questions: PlannedQuestion[] },
  limit = 5,
): string[] {
  const said = new Set(tokenize(answerText));
  if (said.size === 0) return [];

  const hits = new Set<string>();
  for (const question of plan.questions) {
    for (const item of question.expectedEvidence ?? []) {
      const tokens = tokenize(item);
      if (tokens.length === 0) continue;
      // Every distinctive word of the item must appear, so "metadata filtering"
      // is not matched by a stray "metadata".
      if (tokens.every((t) => said.has(t))) hits.add(item);
      if (hits.size >= limit) return [...hits];
    }
  }
  return [...hits];
}
