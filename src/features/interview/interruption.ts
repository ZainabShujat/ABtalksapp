import { z } from "zod";

/**
 * What a candidate MEANT by cutting the interviewer off.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: an interruption is not automatically an
 * answer. Treating it as one is the failure mode that would make barge-in worse
 * than not having it — someone asks "sorry, what do you mean by retrieval
 * quality?", it is scored as their answer to the question, the evidence read
 * comes back empty, and they have lost a question by asking a reasonable thing.
 *
 * So the interruption is classified first, and only ONE of the six outcomes is
 * allowed to advance the interview. That constraint is enforced in
 * `platform/service.ts:recordInterruption` and asserted in
 * `scripts/verify-interview-barge-in.ts`; the types here exist to make it
 * expressible.
 *
 * Pure: no `server-only`, no network, no Prisma. Imported by the client room,
 * the service, and the test harness.
 */

export const INTERRUPTION_KINDS = [
  /** "What do you mean by X?" — asking about the question itself. */
  "CLARIFY",
  /** "Sorry, can you say that again?" — asking to hear it again. */
  "REPEAT",
  /** They started answering before the question finished. */
  "ANSWER",
  /** "Actually, that's not what I said" — fixing the record. */
  "CORRECT",
  /** "Oh, and I also used..." — adding to an answer already given. */
  "ADD_INFORMATION",
  /** Anything else: off-topic, a remark, an aside. */
  "OTHER",
] as const;

export type InterruptionKind = (typeof INTERRUPTION_KINDS)[number];

/**
 * The single place that says which classification may move the interview on.
 *
 * A function rather than a boolean on each branch, so there is exactly one
 * expression to read and exactly one to change. `recordInterruption` calls it;
 * a test asserts every other kind leaves the question index and the evidence
 * keys untouched.
 */
export function advancesInterview(kind: InterruptionKind): boolean {
  return kind === "ANSWER";
}

/**
 * Whether an interruption submission is fresh enough to act on.
 *
 * THE BROWSER IS NOT TRUSTED. `speechGeneration` arrives in the request body,
 * so it can be anything: a number from a tab that has been open since an
 * earlier question, the same number sent twice by a retry, or a value someone
 * typed into a console. The rule has to hold in all three cases and it has to
 * hold without a second store, because a guard kept somewhere other than the
 * interview state can disagree with the interview state.
 *
 * Strictly-greater-than is what does the work, and it covers both threats with
 * one comparison:
 *
 *   - REPLAY. The same generation submitted twice is not greater than itself
 *     the second time, so the second submission is refused. This is what stops
 *     one utterance becoming two turns, and in particular stops an utterance
 *     classified as ANSWER advancing the interview twice.
 *   - STALENESS. A generation from an older spoken line is below the recorded
 *     high-water mark, so it is refused. A tab that was left mid-question
 *     cannot post an interruption against a question that has since moved on.
 *
 * `-1` as the floor rather than `0`, because the client's counter starts at 0
 * and a first submission must be admitted. A client that never sets the field
 * therefore gets exactly one interruption accepted and no more. That is a
 * deliberate fail-closed default: silently degraded is the correct direction
 * for a guard, and both real callers send a real generation.
 */
export function isFreshGeneration(
  submitted: number,
  lastAccepted: number | undefined,
): boolean {
  if (!Number.isInteger(submitted) || submitted < 0) return false;
  return submitted > (lastAccepted ?? -1);
}

export const interruptionClassificationSchema = z.object({
  kind: z.enum(INTERRUPTION_KINDS),
  /** One short line, logged. Never spoken. */
  reason: z.string().max(200).default(""),
  /**
   * For CLARIFY: what they asked about, so the clarification answers the actual
   * question rather than the topic in general.
   */
  subject: z.string().max(200).default(""),
  /**
   * What the interviewer says back, for every kind EXCEPT `ANSWER`.
   *
   * Carried on the classification rather than fetched by a second call, and
   * that is a deliberate cost decision: an interruption is the moment the
   * candidate is most acutely waiting, and a second round trip to write one
   * sentence would be felt. The classifier already has the question, the
   * interrupted line and the utterance in front of it, so it is the cheapest
   * place this sentence can come from.
   *
   * It is a REPLY, never a question and never a restatement — the question is
   * re-put verbatim by the caller afterwards, from the SERVER's own copy. So
   * this field can no more reword what is being assessed than the old
   * `clarification` field could.
   */
  reply: z.string().max(400).default(""),
  confidence: z.number().min(0).max(1).default(0),
});

export type InterruptionClassification = z.infer<
  typeof interruptionClassificationSchema
>;

/* ------------------------------------------------- deterministic fast path */

/**
 * Forms whose meaning is not in doubt.
 *
 * These skip the model entirely. Two reasons, and the second is the important
 * one:
 *
 *   1. Cost and latency. "Can you repeat that?" does not need a language model,
 *      and this is the moment the candidate is waiting on.
 *   2. RELIABILITY. A repeat request that a model classifies as ANSWER costs
 *      someone a question. Where the phrasing is unambiguous, a regex cannot
 *      have a bad day, and the classifier is only consulted where genuine
 *      judgement is required.
 *
 * Deliberately narrow. Anything with real content after the stock phrase falls
 * through to the model, because "sorry, what — I mean, I used Chroma for that"
 * is not a repeat request.
 */
const REPEAT_PATTERNS: RegExp[] = [
  /^(sorry[,.\s]*)?(can|could) you (please )?(say that again|repeat that|repeat the question|say it again)\b/i,
  /^(sorry[,.\s]*)?(what was the question|come again|say again|one more time)\b/i,
  /^(sorry[,.\s]*)?i (didn'?t|did not) (catch|hear) (that|you)\b/i,
  /^(sorry[,.\s]*)?(pardon|repeat)\??$/i,
];

/**
 * Shapes that are ASKING ABOUT THE QUESTION.
 *
 * NOT a fast path any more, and that reversal is the point. These used to
 * short-circuit to CLARIFY with an empty `reply`, which meant the single most
 * natural thing a candidate says — "what do you mean by X?" — reliably produced
 * no explanation at all: the caller had nothing to speak, so it restated the
 * question verbatim and moved on. The candidate asked a reasonable question and
 * the interviewer ignored it.
 *
 * A CLARIFY is the one kind whose whole value IS the sentence that comes back,
 * and recognising the shape of a request tells you nothing about what was asked
 * about. So these are now used only to guarantee the opposite: an utterance
 * matching one of them is never claimed by the fast path and always reaches the
 * model, which has the question and the utterance in front of it and can
 * actually answer.
 *
 * REPEAT keeps its fast path, because "say that again" needs no understanding —
 * the reply is the authored restatement either way.
 */
const CLARIFY_PATTERNS: RegExp[] = [
  /^(sorry[,.\s]*)?what do you mean\b/i,
  /^(sorry[,.\s]*)?(can|could) you (clarify|explain|rephrase)\b/i,
  /^(sorry[,.\s]*)?i (don'?t|do not) (understand|follow|get) (the question|what|that)\b/i,
  /^(sorry[,.\s]*)?what (do you mean by|is) .{1,60}\?$/i,
  /^(sorry[,.\s]*)?in what sense\b/i,
];

/**
 * Wording that changes the meaning of an otherwise-stock opener.
 *
 * "Sorry, what — anyway, I used FAISS because..." opens like a repeat request
 * and is not one. Length alone is not the test: a long repeat request is still
 * a repeat request. The test is whether the utterance carries a clause that
 * only an answer would carry.
 */
const CARRIES_CONTENT =
  /\b(because|so i|i used|i built|i tried|actually|the reason|what i did|i think it|we used|it was)\b/i;

/**
 * Classifies without a model, or returns null to defer to one.
 *
 * Null is not a failure. It is the ordinary case: most interruptions are
 * genuine speech whose intent needs reading, and this function only claims the
 * ones where reading is not required.
 */
export function preClassifyInterruption(
  utterance: string,
): InterruptionClassification | null {
  const text = utterance.trim();
  if (text.length === 0) return null;

  // Too long to be a stock phrase, whatever it starts with.
  if (text.length > 90) return null;
  if (CARRIES_CONTENT.test(text)) return null;

  for (const pattern of REPEAT_PATTERNS) {
    if (pattern.test(text)) {
      return {
        kind: "REPEAT",
        reason: "Unambiguous request to hear the question again.",
        subject: "",
        // Empty: the caller supplies the authored repeat line. Nothing about
        // restating a question needs a model.
        reply: "",
        confidence: 0.95,
      };
    }
  }

  // Deliberately falls through for CLARIFY. See `CLARIFY_PATTERNS`: claiming
  // one here would produce a classification with nothing to say.
  return null;
}

/**
 * Whether this utterance is asking about the question rather than answering it.
 *
 * Exported so the classifier's own reading can be checked against it: a request
 * that plainly opens "what do you mean by…" must never come back as ANSWER,
 * because that is the misreading that costs a candidate a question for asking
 * something reasonable.
 */
export function looksLikeClarificationRequest(utterance: string): boolean {
  const text = utterance.trim();
  if (text.length === 0 || CARRIES_CONTENT.test(text)) return false;
  return CLARIFY_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Said when the classifier could not be reached and a clarification was asked
 * for.
 *
 * It admits the failure instead of papering over it. The alternative that
 * shipped, "Let me clarify what I mean." followed by the unchanged question,
 * promises an explanation and then does not give one, which reads worse than
 * saying nothing. The question is still re-put immediately after this, so the
 * candidate is never left without something to answer.
 */
export const CLARIFY_UNAVAILABLE_LINE =
  "Sorry, I did not catch which part you wanted me to explain. Here it is again.";

/** Blank line between a spoken reply and the question re-put after it. */
export function joinSpoken(lead: string, question: string): string {
  const head = lead.trim();
  const tail = question.trim();
  if (head.length === 0) return tail;
  if (tail.length === 0) return head;
  return `${head}\n\n${tail}`;
}

/** Hard ceiling on a spoken interruption reply, matching `resolveClarification`. */
const MAX_REPLY_CHARS = 320;

/**
 * The sentence the interviewer actually says back after an interruption.
 *
 * The same three rules `policy.ts:resolveClarification` applies to the ordinary
 * CLARIFY path, applied here so the two cannot drift:
 *
 *   - no question mark. A reply that asks something is an unbudgeted extra
 *     question, and the real question is re-put verbatim immediately after it.
 *   - length-capped, so a model that starts monologuing cannot turn a
 *     clarification into a lecture.
 *   - no em/en dashes, which speech synthesis reads as an audible stumble.
 *
 * Returns null when nothing usable came back, so the caller can decide what to
 * do about it rather than being handed an empty string that reads as success.
 */
export function resolveInterruptionReply(reply: string | undefined): string | null {
  const cleaned = (reply ?? "")
    .replace(/[—–]/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0 || cleaned.length > MAX_REPLY_CHARS) return null;
  if (cleaned.includes("?")) return null;
  return cleaned;
}

/**
 * What the room sends when the candidate interrupts.
 *
 * `interruptedText` and `interruptedChars` preserve what the candidate ACTUALLY
 * HEARD before cutting in, which is not what the server sent: the transcript
 * would otherwise claim they were asked a full question they only heard half
 * of, and a report built on that is wrong about the interview it describes.
 * The room already computes the revealed character count for its own display
 * (`startReveal` tracks `audio.currentTime / audio.duration`), so this is a
 * number it has rather than one it has to estimate.
 */
export type InterruptionSubmission = {
  utterance: string;
  /** The interviewer line that was cut off, as far as it was heard. */
  interruptedText: string;
  interruptedChars: number;
  /**
   * Which spoken line this interrupted, from the room's `speakGenRef`.
   *
   * The duplicate-submission guard: two submissions carrying the same
   * generation are the same interruption arriving twice, and the second is
   * dropped. Without it a slow network plus a retry could submit one utterance
   * as two turns.
   */
  speechGeneration: number;
};
