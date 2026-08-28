import {
  curriculumForDays,
  type DayCurriculum,
} from "@/features/interview/cohort/curriculum-context";

/**
 * The curriculum's own vocabulary, used to decide what a candidate just talked
 * about and which assessment target is closest to it.
 *
 * WHY THIS EXISTS. The interview used to walk `plan.questions` in array order,
 * so "the candidate mentioned chunking" could never change what was asked next.
 * To move toward a concept the candidate raised, the planner needs to know
 * which concepts exist and which question assesses each one. That mapping has
 * to come from somewhere authoritative, and inventing a topic taxonomy would be
 * exactly the invention the grounding rules forbid.
 *
 * So the vocabulary is READ FROM THE CURRICULUM. `days.json` already carries a
 * `tools` array per day ("Chroma", "query routing", "hybrid retrieval") and a
 * set of objectives written in the cohort's own words. Those are the concepts
 * the cohort was actually taught, which makes every routing decision traceable
 * to curriculum rather than to a model's opinion.
 *
 * The day number remains a LOOKUP KEY and never becomes a concept: `day 11` is
 * how we find "RAG End-to-End", and it is the topic that travels forward.
 *
 * Pure module. No database, no model, no `server-only` — `days.json` is a
 * build-time import, so this is testable from a plain script.
 */

/** Words too common to identify a topic. Kept small and curriculum-specific. */
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
  "add", "set", "new", "own", "via", "per", "let", "put", "see", "say",
]);

/**
 * Denominator floor for topical overlap. Roughly one clause of real speech:
 * enough that a candidate who actually engaged with a topic clears it, and a
 * throwaway phrase does not.
 */
const MIN_TOKENS_FOR_CONTINUITY = 8;

/** Lowercase alphanumeric tokens, stopwords and very short words dropped. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((w) => w.replace(/^[.]+|[.]+$/g, ""))
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * One concept: a curriculum term plus the tokens that identify it in speech.
 *
 * `tools` entries are multi-word ("metadata filtering"), and a candidate saying
 * "I filtered on metadata" should still match. Holding the tokens alongside the
 * label is what makes that possible without a model.
 */
export type Concept = {
  /** Curriculum wording, e.g. "hybrid retrieval". Used in logs and traces. */
  label: string;
  /** Identifying tokens, lowercased. */
  tokens: string[];
  /** Days this concept is taught on. Provenance only. */
  days: number[];
};

function conceptsFromDay(day: DayCurriculum): Concept[] {
  const out: Concept[] = [];

  // Tools are the highest-signal concepts: short, specific, and already the
  // vocabulary the cohort uses out loud.
  for (const tool of day.tools) {
    const tokens = tokenize(tool);
    if (tokens.length === 0) continue;
    out.push({ label: tool, tokens, days: [day.dayNumber] });
  }

  // Objectives are sentences, so the whole sentence is not a concept. The
  // distinctive tokens in it are, and they cover topics the tools list misses
  // ("chunk", "overlap", "routing").
  for (const objective of day.objectives) {
    const tokens = tokenize(objective);
    if (tokens.length === 0) continue;
    out.push({ label: objective, tokens, days: [day.dayNumber] });
  }

  return out;
}

/** Every concept taught across the given days. */
export function conceptsForDays(dayNumbers: readonly number[]): Concept[] {
  return curriculumForDays(dayNumbers).flatMap(conceptsFromDay);
}

/**
 * The token set a question assesses, from the days it draws on.
 *
 * Used both ways: to score how close a question is to what the candidate just
 * said, and to describe why a target was chosen.
 */
export function conceptTokensForDays(
  dayNumbers: readonly number[],
): Set<string> {
  const tokens = new Set<string>();
  for (const concept of conceptsForDays(dayNumbers)) {
    for (const token of concept.tokens) tokens.add(token);
  }
  return tokens;
}

/**
 * Which curriculum concepts the candidate actually raised.
 *
 * A concept counts as mentioned when EVERY one of its tokens appears in the
 * answer. Requiring all of them is what keeps "metadata filtering" from
 * matching a stray "metadata" — a planner that hops topics on one shared word
 * feels more random than an interviewer that simply carries on.
 *
 * Single-token concepts therefore match on that token alone, which is correct:
 * a candidate who says "Chroma" has raised Chroma.
 */
export function mentionedConcepts(
  answerText: string,
  concepts: readonly Concept[],
): Concept[] {
  const said = new Set(tokenize(answerText));
  if (said.size === 0) return [];

  return concepts.filter(
    (concept) =>
      concept.tokens.length > 0 &&
      concept.tokens.every((token) => said.has(token)),
  );
}

/**
 * How strongly an answer points at a set of concept tokens.
 *
 * Returns the share of the candidate's distinctive words that belong to this
 * target's vocabulary, so a long answer that grazes a topic scores lower than a
 * short answer that is entirely about it. Bounded 0..1.
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

  // A FLOOR ON THE DENOMINATOR, not merely a divide.
  //
  // Dividing by the answer's own length made short answers explosive: "because
  // it is free and private" carries two distinctive words, so a single
  // incidental match scored 0.5 and could reroute the whole interview. A
  // two-word answer is the LEAST informative thing a candidate can say and must
  // not be the strongest steer. Below this length an answer can still register
  // interest, but it cannot outweigh the authored order on its own.
  return hits / Math.max(unique.size, MIN_TOKENS_FOR_CONTINUITY);
}
