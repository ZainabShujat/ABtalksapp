import {
  INTERVIEW_SILENCE_MS,
  SPEECH_OFF_RMS,
  SPEECH_ON_RMS,
} from "@/features/interview/constants";

/**
 * The turn-taking rule, as a pure function of the audio level and the clock.
 *
 * Extracted from the room's animation loop so it can be tested without a
 * browser, a microphone or a WebGL context. The loop keeps ownership of the
 * AnalyserNode; this owns only the decision, which is the part with rules in it.
 *
 * Two properties matter and both are easy to get wrong:
 *
 *   1. The timer starts only AFTER real speech. Someone thinking for eight
 *      seconds before their first word must not have an empty recording
 *      submitted on their behalf.
 *   2. Speech and silence use DIFFERENT thresholds. With one threshold a voice
 *      sitting near the line flickers many times a second, the timer resets on
 *      every flicker, and an answer never ends by itself.
 */

export type SilenceState = {
  /** True once the candidate has crossed the speech threshold at least once. */
  hasSpoken: boolean;
  /** When the current run of quiet began, in ms on the same clock as `now`. */
  quietSince: number | null;
};

export function initialSilenceState(): SilenceState {
  return { hasSpoken: false, quietSince: null };
}

export type SilenceStep = {
  state: SilenceState;
  /** True on the frame the answer should be submitted. */
  shouldStop: boolean;
};

/**
 * Advances the turn-taking state by one audio frame.
 *
 * `rms` is the analyser's root-mean-square level, 0..1. `now` is a monotonic
 * millisecond clock — `performance.now()` in the browser, an injected value in
 * tests.
 */
export function stepSilence(
  state: SilenceState,
  rms: number,
  now: number,
  silenceMs: number = INTERVIEW_SILENCE_MS,
): SilenceStep {
  // Before the first real speech, quiet means "not started yet", never "done".
  // Background noise sits below SPEECH_ON, so it cannot open the turn either.
  if (!state.hasSpoken) {
    if (rms >= SPEECH_ON_RMS) {
      return { state: { hasSpoken: true, quietSince: null }, shouldStop: false };
    }
    return { state, shouldStop: false };
  }

  // Anything at or above the LOWER threshold counts as still talking, so a
  // quiet syllable between two loud ones does not restart the clock.
  if (rms >= SPEECH_OFF_RMS) {
    return { state: { hasSpoken: true, quietSince: null }, shouldStop: false };
  }

  const quietSince = state.quietSince ?? now;
  if (now - quietSince >= silenceMs) {
    return {
      state: { hasSpoken: true, quietSince: null },
      shouldStop: true,
    };
  }
  return { state: { hasSpoken: true, quietSince }, shouldStop: false };
}
