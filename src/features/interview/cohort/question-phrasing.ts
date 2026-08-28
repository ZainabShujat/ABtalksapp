import {
  MAX_GENERATED_QUESTION_CHARS,
  MIN_QUESTION_OVERLAP,
} from "@/features/interview/constants";

/**
 * Validation and framing for LLM-phrased CORE questions.
 *
 * The split this module enforces: the BANK owns what is assessed, the model owns
 * how it is asked. A generated question is accepted only if it is still
 * recognisably the authored question — same subject, one thing asked, no part of
 * the answer handed over. Anything else falls back to the authored text, so the
 * worst case is exactly today's behaviour.
 *
 * Pure on purpose: no `server-only`, no network, no Prisma. The rules that decide
 * whether a candidate hears a generated question are the ones most worth testing
 * deterministically, so they cannot live inside the call that produces them.
 */

export type DifficultyBand = "FOUNDATIONS" | "WORKING" | "ADVANCED";

/**
 * How a level changes the way a target is approached.
 *
 * This is the part that was missing: calibration used to move only the
 * escalation ceiling and the model's tone, so a FOUNDATIONS candidate and an
 * ADVANCED one heard the identical sentence. The TARGET and its evidence
 * checklist are unchanged here — `minEvidence`, competency and scoring do not
 * move. What changes is the route in.
 */
export const FRAMING: Record<DifficultyBand, string> = {
  FOUNDATIONS:
    "Ask concretely about what THEY personally did. One clause, no theory, no hypotheticals. Anchor it in the artifact they actually built.",
  WORKING:
    "Ask why or how they made the choice they made. One implementation decision or one trade-off, no more.",
  ADVANCED:
    "Ask about failure modes, scale, or the design alternative they rejected. Assume the basics and go at the reasoning.",
};

/** Words too common to say anything about what a question is about. */
const STOPWORDS = new Set([
  "what", "why", "how", "when", "which", "who", "did", "do", "does", "you",
  "your", "the", "a", "an", "and", "or", "but", "if", "in", "on", "at", "to",
  "for", "of", "with", "that", "this", "it", "its", "was", "were", "is", "are",
  "be", "been", "would", "could", "should", "have", "has", "had", "make",
  "made", "use", "used", "using", "about", "there", "then", "than", "from",
  "into", "over", "after", "before", "them", "they", "their", "me", "my",
  "walk", "tell", "give", "think", "actually", "specifically", "between",
]);

/**
 * Openers a technical interviewer uses instead of a question mark.
 *
 * Anchored to the START of the sentence: "walk me through" mid-sentence is part
 * of a compound ask, not the ask itself.
 */
const IMPERATIVE_ASK_SOURCE =
  "(^|[.?!]\\s+)(walk me through|talk me through|tell me|give me|describe|explain)";

/**
 * Counts the asks in a question.
 *
 * An ask is a question mark OR a sentence that opens with an interviewer
 * imperative. It must be checked per SENTENCE, not against the whole string:
 * bank questions routinely open with a factual setup and put the ask second —
 * "You attached metadata to every chunk. Walk me through what differs." —
 * and anchoring to the start of the string counted that as no ask at all.
 */
function countAsks(text: string): number {
  const marks = (text.match(/\?/g) ?? []).length;
  const lastMark = text.lastIndexOf("?");

  // An imperative AFTER the last question mark is an elaboration of it:
  // "Would you fix that with fine-tuning or retrieval? Walk me through your
  // reasoning." is one question. An imperative BEFORE it is a separate ask:
  // "Give me an example. And what would you change?" is two, and asking both
  // at once produces the monologue the bank was narrowed to avoid.
  //
  // Built fresh per call: a module-level /g/ regex carries `lastIndex`
  // between calls, and this runs once per question in a loop.
  const re = new RegExp(IMPERATIVE_ASK_SOURCE, "gi");
  let imperatives = 0;
  for (const m of text.matchAll(re)) {
    if (lastMark === -1 || m.index < lastMark) imperatives += 1;
  }
  return marks + imperatives;
}

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/**
 * Share of the authored question's content words that the candidate one reuses.
 *
 * Directional on purpose: we care whether the generated question still covers
 * the authored subject, not whether it introduced words of its own. A natural
 * rephrasing adds words freely; what it must not do is drop the subject.
 */
export function questionOverlap(authored: string, generated: string): number {
  const target = contentWords(authored);
  if (target.size === 0) return 1;
  const candidate = contentWords(generated);
  let shared = 0;
  for (const word of target) if (candidate.has(word)) shared += 1;
  return shared / target.size;
}

/**
 * Overlap required of a SIMPLIFIED question.
 *
 * Much lower than the rephrasing bar, and deliberately so: simplifying means
 * replacing the vocabulary the candidate did not follow, so a good
 * simplification shares few words with the original by construction. Holding it
 * to the rephrasing bar rejected every genuine attempt and read the same
 * sentence back at someone who had just said they did not understand it.
 *
 * The other guards do the real protecting here — one ask, no evidence named,
 * length capped — and they are unchanged.
 */
export const MIN_SIMPLIFIED_OVERLAP = 0.08;

export type PhrasingRejection =
  | "EMPTY"
  | "TOO_LONG"
  | "NOT_A_QUESTION"
  | "MULTIPLE_QUESTIONS"
  | "LEAKS_EVIDENCE"
  | "OFF_TARGET"
  | "DAY_REFERENCE"
  | null;

/**
 * "Day 11", "day 3", "on day 12".
 *
 * The generator is handed curriculum and submission context that carries day
 * numbers, because that is how the cohort content is keyed. It must not put
 * them in the candidate's ear: the interview assesses what someone knows, not
 * when they were taught it, and "what did you do on Day 11" turns a technical
 * interview into a quiz about the calendar. Enforced here rather than trusted
 * to the prompt, because a rejected phrasing falls back to the authored
 * question, which is always safe.
 */
const DAY_REFERENCE = /(^|[^a-z])days?[ ]*[0-9]/i;

/**
 * Decides whether a generated question may be asked in place of the authored one.
 *
 * Every rule here exists to protect something specific:
 *
 *   - MULTIPLE_QUESTIONS — a compound question produces the multi-minute
 *     monologue the bank was narrowed to avoid, and makes evidence impossible to
 *     attribute to a prompt.
 *   - LEAKS_EVIDENCE — naming an expected-evidence item inside the question
 *     hands the candidate the answer and silently inflates their score.
 *   - OFF_TARGET — the score points at the authored target, so a question that
 *     wandered to an adjacent topic would be graded against something nobody
 *     asked.
 */
export function rejectPhrasing(
  generated: string,
  authored: string,
  expectedEvidence: readonly string[],
  minOverlap: number = MIN_QUESTION_OVERLAP,
  maxChars: number = MAX_GENERATED_QUESTION_CHARS,
): PhrasingRejection {
  const text = generated.trim();
  if (text.length === 0) return "EMPTY";
  if (text.length > maxChars) return "TOO_LONG";

  // An ask is either a question mark or an interviewer imperative. Requiring a
  // "?" was wrong: "Walk me through what happens when the filter is removed."
  // is a question in every sense that matters, and two of the authored bank
  // questions are phrased exactly that way.
  const asks = countAsks(text);

  if (DAY_REFERENCE.test(text)) return "DAY_REFERENCE";

  if (asks === 0) return "NOT_A_QUESTION";
  // Two asks is two questions wearing one sentence, whether that is "why? and
  // how?" or "walk me through X, then tell me why?".
  if (asks > 1) return "MULTIPLE_QUESTIONS";

  // Each expected item is a phrase like "chose Chroma for local persistence".
  // If the question repeats that phrase's distinctive words, it is telling the
  // candidate what to say.
  for (const item of expectedEvidence) {
    const itemWords = [...contentWords(item)];
    if (itemWords.length === 0) continue;
    const asked = contentWords(text);
    const hits = itemWords.filter((w) => asked.has(w)).length;
    if (hits / itemWords.length >= 0.8) return "LEAKS_EVIDENCE";
  }

  if (questionOverlap(authored, text) < minOverlap) return "OFF_TARGET";
  return null;
}

/**
 * The question the candidate actually hears for one target.
 *
 * Returns the authored text on any rejection, so a bad generation, a provider
 * outage and a missing key all degrade to the interview that exists today.
 */
export function choosePhrasing(
  generated: string | null | undefined,
  authored: string,
  expectedEvidence: readonly string[],
  minOverlap: number = MIN_QUESTION_OVERLAP,
  maxChars: number = MAX_GENERATED_QUESTION_CHARS,
): { text: string; generated: boolean; rejection: PhrasingRejection } {
  if (!generated) return { text: authored, generated: false, rejection: "EMPTY" };
  const rejection = rejectPhrasing(
    generated,
    authored,
    expectedEvidence,
    minOverlap,
    maxChars,
  );
  return rejection === null
    ? { text: generated.trim(), generated: true, rejection: null }
    : { text: authored, generated: false, rejection };
}
