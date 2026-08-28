import { createHash } from "node:crypto";

/**
 * The voice transport's contract, as pure functions.
 *
 * Separated from `voice.ts` — which is `server-only` because it reaches the
 * database and the speech APIs — so the parts that decide what is ACCEPTED can
 * be tested without either. Upload limits and format checks are security
 * boundaries, and a security boundary that is awkward to test is one that stops
 * being tested.
 */

/**
 * Upload ceiling, just under the 25 MB both speech vendors accept.
 *
 * Was 8 MB. Opus at conversational bitrates is small, but a browser that falls
 * back to a less efficient container can produce far more per minute, and a
 * long, detailed answer is precisely the one worth keeping. The provider limit
 * is the only ceiling with a real reason behind it, so that is the one used.
 */
export const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
<<<<<<< Updated upstream

/**
 * Smallest upload that could possibly contain speech.
 *
 * A MediaRecorder whose track has been DISABLED still emits a valid container:
 * webm headers, cues, no audio. That is a few hundred bytes, it passes a
 * `size > 0` check, and the provider answers "Audio file might be corrupted or
 * unsupported" with a 400. One second of Opus at the browser's default bitrate
 * is roughly 3 KB, so anything under 2 KB is a header and nothing else.
 */
export const MIN_AUDIO_BYTES = 2048;
=======
>>>>>>> Stashed changes

export const ALLOWED_AUDIO_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
] as const;

/**
 * Pseudonymous abuse identifier, ported verbatim from the legacy interview.
 *
 * A stable hash of the member id: it lets the provider rate-limit a single
 * abusive account without ever receiving a name, an email, or anything else
 * that identifies a real person.
 */
export function safetyIdentifierFor(memberId: string): string {
  return createHash("sha256").update(memberId).digest("hex").slice(0, 64);
}

/**
 * The base MIME type, without codec parameters.
 *
 * MediaRecorder reports `audio/webm;codecs=opus`, so a naive equality check
 * against the allow-list rejects every real recording the browser produces.
 */
export function normalizeAudioType(rawType: string): string {
  return (rawType || "").split(";")[0]!.trim().toLowerCase();
}

export function isAllowedAudioType(rawType: string): boolean {
  return (ALLOWED_AUDIO_TYPES as readonly string[]).includes(
    normalizeAudioType(rawType),
  );
}

/** Upload filename for a recording. The provider infers the container from it. */
export function audioFilenameFor(rawType: string): string {
  const subtype = normalizeAudioType(rawType).split("/")[1] ?? "webm";
  return `answer.${subtype === "x-wav" ? "wav" : subtype}`;
}

export type AudioRejection = "EMPTY" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | null;

/**
 * The whole upload gate, in one place so the route reads as policy rather than
 * as a pile of conditionals.
 */
export function rejectAudioUpload(
  size: number,
  rawType: string,
): AudioRejection {
  if (size < MIN_AUDIO_BYTES) return "EMPTY";
  if (size > MAX_AUDIO_BYTES) return "TOO_LARGE";
  if (!isAllowedAudioType(rawType)) return "UNSUPPORTED_TYPE";
  return null;
}
