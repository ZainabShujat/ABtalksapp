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
 * The two thresholds in force for one recording.
 *
 * Passed in rather than read from the constants directly so the room can raise
 * them against the noise floor it actually measured. A headset in a quiet room
 * and a laptop microphone beside a fan cannot share one fixed number: too high
 * and speech never registers (the answer never ends), too low and the room
 * itself counts as talking (the answer never ends either).
 */
export type SilenceThresholds = {
  /** Level that counts as "they have started". */
  on: number;
  /** Level that counts as "they are still going". */
  off: number;
};

export const defaultThresholds: SilenceThresholds = {
  on: SPEECH_ON_RMS,
  off: SPEECH_OFF_RMS,
};

/**
 * Advances the turn-taking state by one audio frame.
 *
 * `rms` is the microphone's root-mean-square amplitude, 0..1. `now` is a
 * monotonic millisecond clock — `performance.now()` in the browser, an injected
 * value in tests.
 */
export function stepSilence(
  state: SilenceState,
  rms: number,
  now: number,
  silenceMs: number = INTERVIEW_SILENCE_MS,
  thresholds: SilenceThresholds = defaultThresholds,
): SilenceStep {
  // Before the first real speech, quiet means "not started yet", never "done".
  // Background noise sits below the ON threshold, so it cannot open the turn.
  if (!state.hasSpoken) {
    if (rms >= thresholds.on) {
      return { state: { hasSpoken: true, quietSince: null }, shouldStop: false };
    }
    return { state, shouldStop: false };
  }

  // Anything at or above the LOWER threshold counts as still talking, so a
  // quiet syllable between two loud ones does not restart the clock.
  if (rms >= thresholds.off) {
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
