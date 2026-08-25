/**
 * The English-only gate for candidate answers.
 *
 * This is an INPUT-QUALITY check, not an assessment one. It runs between
 * transcription and evidence extraction, so nothing downstream — evidence,
 * routing, scoring, the report — ever learns that language detection exists.
 * An answer that fails the gate is not a bad answer; it is an answer we cannot
 * assess, and the candidate is asked once, in English, to give it again.
 *
 * Pure module: no Prisma, no network, no `server-only`. That is what lets the
 * whole thing be tested deterministically without touching a provider.
 */

/**
 * Proportion of letters that must be non-Latin before an answer is treated as
 * another language.
 *
 * The discriminator that actually works here is SCRIPT, not vocabulary. With
 * auto-detect on, Whisper writes Hindi and Urdu speech in Devanagari or Arabic
 * script; Hinglish spoken with English structure comes back in Latin script.
 * So a candidate saying "mujhe local testing easier laga" reads as Latin and
 * passes, while someone answering wholly in Hindi does not.
 *
 * Deliberately high. This is an English-language interview, not a vocabulary
 * purity test, and the cost of a false positive — telling a candidate who
 * answered in English to answer in English — is far worse than the cost of
 * assessing a heavily accented but comprehensible answer.
 */
const NON_LATIN_RATIO = 0.3;

/** Below this many letters, the ratio is noise rather than a signal. */
const MIN_LETTERS_FOR_SCRIPT_CHECK = 12;

/**
 * Language codes we accept without argument.
 *
 * Whisper reports either an ISO-639-1 code or an English language NAME
 * depending on the endpoint and format, so both spellings are listed.
 */
const ENGLISH_CODES = new Set(["en", "eng", "english"]);

export type LanguageVerdict = {
  /** True when the answer can be assessed as an English response. */
  ok: boolean;
  /** Why it was rejected. Logged; never shown to the candidate. */
  reason: "provider" | "script" | null;
  /** Proportion of non-Latin letters, for logging and tests. */
  nonLatinRatio: number;
};

const LETTER = /\p{L}/u;
const LATIN_LETTER = /\p{Script=Latin}/u;

/**
 * Proportion of letters that are not Latin.
 *
 * Counts LETTERS only. Digits, punctuation and whitespace are script-neutral
 * and would otherwise dilute the ratio differently depending on how much
 * numeric detail an answer happened to contain.
 */
export function nonLatinRatio(text: string): number {
  let letters = 0;
  let nonLatin = 0;
  for (const ch of text) {
    if (!LETTER.test(ch)) continue;
    letters += 1;
    if (!LATIN_LETTER.test(ch)) nonLatin += 1;
  }
  return letters === 0 ? 0 : nonLatin / letters;
}

/**
 * Decides whether a transcribed answer can be assessed as English.
 *
 * `providerLanguage` is used when the speech provider reports one, because a
 * model that listened to the audio knows more than any test over its output.
 * Not every model returns it — `gpt-4o-mini-transcribe` has no `verbose_json`
 * — so the script check is the fallback rather than the primary rule.
 *
 * A provider that says "en" is trusted outright: it heard the audio, and
 * second-guessing it with a script test is how a correct English answer
 * containing one Devanagari-transcribed proper noun gets rejected.
 */
export function checkLanguage(
  text: string,
  providerLanguage?: string | null,
): LanguageVerdict {
  const ratio = nonLatinRatio(text);

  if (providerLanguage) {
    const code = providerLanguage.trim().toLowerCase();
    if (ENGLISH_CODES.has(code)) {
      return { ok: true, reason: null, nonLatinRatio: ratio };
    }
    return { ok: false, reason: "provider", nonLatinRatio: ratio };
  }

  const letters = [...text].filter((c) => LETTER.test(c)).length;
  if (letters < MIN_LETTERS_FOR_SCRIPT_CHECK) {
    // Too short to judge. A three-word reply is handled by the ordinary
    // stuck/relevance path, which is better at it than a script ratio.
    return { ok: true, reason: null, nonLatinRatio: ratio };
  }

  if (ratio >= NON_LATIN_RATIO) {
    return { ok: false, reason: "script", nonLatinRatio: ratio };
  }
  return { ok: true, reason: null, nonLatinRatio: ratio };
}

/**
 * What the interviewer says when an answer was not in English.
 *
 * Said in English, briefly, without apology or explanation — the candidate
 * knows what happened. The question is restated by the caller, so this line
 * does not repeat it.
 */
export const LANGUAGE_RETRY_LINE =
  "Sorry, this interview needs to be in English. Could you answer that again in English?";
