/**
 * Deciding whether the interviewer's voice actually reached the candidate.
 *
 * THE FAILURE THIS EXISTS TO NAME. A speech request can succeed completely —
 * Deepgram Aura-2 answers 200 with `audio/mpeg`, the bytes arrive, `play()`
 * resolves, `currentTime` is read without throwing — and the room can still be
 * silent. Three different things were being collapsed into one "no audio"
 * verdict and then all treated the same way, by falling back to the browser's
 * own voice:
 *
 *   1. the SPEECH PROVIDER failed (non-2xx, network, timeout)
 *   2. the provider succeeded and BROWSER PLAYBACK failed
 *   3. playback was CANCELLED on purpose, because the candidate interrupted
 *
 * Only the first two are failures, and only they may reach the fallback. The
 * third is the feature working. Conflating (3) with (1) is what makes an
 * interrupted interviewer start reading its abandoned sentence back through
 * `speechSynthesis`, and conflating (2) with "fine" is what makes a successful
 * Deepgram response inaudible while every log line says it worked.
 *
 * The other half of the job is not calling (2) too early. `currentTime` is
 * legitimately 0 for a while after `play()` resolves — the element may still be
 * fetching or decoding — so "still zero" alone is not evidence of failure. It
 * becomes evidence once the element claims to HAVE the data it is not playing.
 *
 * Pure: no DOM, no timers. The element is sampled into a `PlaybackProbe` by the
 * caller, so every rule below is exercised in
 * `scripts/verify-interview-playback.ts` with no browser and no audio device.
 */

/**
 * `HTMLMediaElement.HAVE_CURRENT_DATA`.
 *
 * Named rather than written as `2` at the comparison, because the whole meaning
 * of the stall rule is "the element says it has a frame to play and is not
 * playing it". Below this it has nothing to play yet and silence is expected.
 */
export const HAVE_CURRENT_DATA = 2;

/**
 * How long an element that HAS data may sit at `currentTime === 0`.
 *
 * Deliberately short: an element holding decoded audio and not advancing is
 * broken now, not slow. Real playback leaves 0 within a frame or two of
 * starting, so this cannot fire on a healthy line.
 */
export const PLAYBACK_STALL_MS = 1_200;

/**
 * How long an element that has NOT reached `HAVE_CURRENT_DATA` is given.
 *
 * This is the case the old rule got wrong. It tested `currentTime === 0` after
 * 1.2s against any element at all, so a line whose bytes were still arriving
 * counted as a playback failure and was re-read by the browser voice on top of
 * the Deepgram audio that then started. Buffering is not failure; it just has to
 * end eventually.
 */
export const PLAYBACK_BUFFER_GRACE_MS = 4_000;

export type AudioContextState = "running" | "suspended" | "closed" | "none";

export type PlaybackProbe = {
  /** `audio.currentTime`. */
  currentTime: number;
  /** `audio.paused`. Set by `cancelSpeech`, so it means "cancelled" here. */
  paused: boolean;
  /** `audio.ended`. */
  ended: boolean;
  /** `audio.readyState`. */
  readyState: number;
  /** Milliseconds since `play()` resolved. */
  elapsedMs: number;
  /**
   * State of the AudioContext the element's output is routed THROUGH, or
   * `"none"` when the element plays straight to the speakers.
   *
   * Load-bearing, and the reason this field exists at all.
   * `createMediaElementSource` reroutes an element's output away from the
   * speakers and into the graph, permanently. If that graph's context is
   * closed, the element plays into nothing: `play()` resolves and no human
   * hears anything. There is no property on the element that reports this, so
   * the context state has to be carried in alongside it.
   */
  contextState: AudioContextState;
};

export type PlaybackVerdict =
  /** Audio is advancing. The candidate is hearing the interviewer. */
  | "playing"
  /** Ran to the end. */
  | "ended"
  /** Paused by us — a barge-in or a superseding line. NOT a failure. */
  | "cancelled"
  /** The element will not produce sound. The fallback is warranted. */
  | "stalled"
  /** Too early to say. Keep waiting. */
  | "waiting";

/**
 * What one sample of the audio element means.
 *
 * Order matters and each rule is here for a reason:
 *
 *   - `ended` first, because a line that finished is finished whatever else the
 *     element says about itself.
 *   - `paused` next, because `cancelSpeech` pauses. Reading a cancelled line as
 *     stalled is what made an interrupted interviewer resume through the
 *     browser voice.
 *   - a CLOSED CONTEXT is stalled IMMEDIATELY and unconditionally, with no
 *     grace period and regardless of `currentTime`. This is the case that shipped
 *     silent: the element was attached to a graph whose context had been closed,
 *     so `currentTime` advanced, `duration` was real, the transcript revealed in
 *     step with it and the orb animated — every observable said the interview was
 *     speaking, and nothing came out of the speakers. A closed context can never
 *     be `"playing"`, because there is no path from that element to an output
 *     device.
 */
export function classifyPlayback(probe: PlaybackProbe): PlaybackVerdict {
  if (probe.ended) return "ended";
  if (probe.paused) return "cancelled";

  // Never audible, no matter what the clock says. See above.
  if (probe.contextState === "closed") return "stalled";

  if (probe.currentTime > 0) return "playing";

  // Still at zero. Whether that is a failure depends on whether the element
  // claims to have anything to play.
  const limit =
    probe.readyState >= HAVE_CURRENT_DATA
      ? PLAYBACK_STALL_MS
      : PLAYBACK_BUFFER_GRACE_MS;

  return probe.elapsedMs > limit ? "stalled" : "waiting";
}

/**
 * How a single `speak()` call ended.
 *
 * Separated from `PlaybackVerdict` because they answer different questions: the
 * verdict is about one sample of one element, this is about the whole attempt,
 * including the parts that never got as far as an element.
 */
export type SpeechOutcome =
  /** Deepgram answered and the audio was audible. */
  | { kind: "spoke" }
  /** Interrupted or superseded. The silence is intentional. */
  | { kind: "cancelled" }
  /** The speech service did not return usable audio. */
  | { kind: "providerFailed"; status: number | null }
  /** The service returned audio the browser would not play. */
  | { kind: "playbackFailed"; reason: PlaybackFailureReason };

export type PlaybackFailureReason =
  /** The element's output was routed into a closed AudioContext. */
  | "closed-context"
  /** The element held data and never advanced. */
  | "stalled"
  /** `play()` itself rejected — autoplay policy, no output device. */
  | "play-rejected";

/**
 * Whether the browser's own voice should read this line.
 *
 * The whole point of the type above: an emergency fallback fires ONLY on a
 * genuine failure. A 200 from Deepgram whose audio played is not a failure, and
 * neither is a line the candidate deliberately cut off.
 */
export function shouldUseBrowserFallback(outcome: SpeechOutcome): boolean {
  return outcome.kind === "providerFailed" || outcome.kind === "playbackFailed";
}

/**
 * Whether a prepared playback element is safe to play through.
 *
 * The element and the AudioContext it was attached to share a lifetime and
 * nothing in the DOM enforces that. `createMediaElementSource` cannot be undone,
 * so an element that was attached to a context which has since been closed is
 * permanently mute and must be discarded rather than reused — reusing it is
 * exactly the bug that made every interviewer line fall back to the browser
 * voice after React re-ran the mount effect.
 */
export function isPlaybackGraphUsable(state: AudioContextState): boolean {
  // "none" is the unattached element: it plays straight to the speakers, which
  // is always usable. "suspended" is recoverable — a gesture resumes it — and
  // the element is still routed through a live graph.
  return state !== "closed";
}
