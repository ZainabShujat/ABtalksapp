import {
  INTERVIEW_SILENCE_MS,
  SPEECH_SUSTAIN_MS,
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
  /**
   * When the level first rose above the ON threshold in the current burst.
   *
   * Loudness alone cannot tell a voice from a door closing, a cough or a desk
   * knock — they all cross the threshold. Duration can: speech stays up for
   * hundreds of milliseconds, a transient does not. Holding the burst here and
   * only calling it speech once it has SUSTAINED is what stops a single bang
   * from opening the turn and starting the silence clock.
   */
  speechSince: number | null;
  /** True once the candidate has crossed the speech threshold at least once. */
  hasSpoken: boolean;
  /** When the current run of quiet began, in ms on the same clock as `now`. */
  quietSince: number | null;
};

export function initialSilenceState(): SilenceState {
  return { hasSpoken: false, quietSince: null, speechSince: null };
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
  sustainMs: number = SPEECH_SUSTAIN_MS,
): SilenceStep {
  // Before the first real speech, quiet means "not started yet", never "done".
  // Background noise sits below the ON threshold, so it cannot open the turn.
  if (!state.hasSpoken) {
    // Onset uses BOTH thresholds, and that distinction is the whole of it.
    //
    // Speech is modulated: between syllables the level dips well below the ON
    // threshold many times a second. Requiring it to stay CONTINUOUSLY above ON
    // for the sustain window meant the burst timer reset on almost every frame
    // and a real voice never registered at all — the room simply never heard
    // the candidate. A transient is distinguished from speech by whether the
    // sound DIES, not by whether every frame is loud.
    //
    // So: ON starts the burst, and only dropping below OFF ends it. The dips
    // in between are what talking sounds like.
    if (state.speechSince === null) {
      if (rms < thresholds.on) return { state, shouldStop: false };
      return {
        state: { ...state, speechSince: now },
        shouldStop: false,
      };
    }

    if (rms < thresholds.off) {
      // The sound died before it lasted long enough to be a voice: a knock, a
      // click, a chair.
      return { state: { ...state, speechSince: null }, shouldStop: false };
    }

    if (now - state.speechSince < sustainMs) {
      // Still going, not yet long enough to commit.
      return { state, shouldStop: false };
    }

    return {
      state: { hasSpoken: true, quietSince: null, speechSince: null },
      shouldStop: false,
    };
  }

  if (rms >= thresholds.off) {
    // Already talking: nothing to decide, keep going.
    if (state.quietSince === null) {
      return {
        state: { hasSpoken: true, quietSince: null, speechSince: null },
        shouldStop: false,
      };
    }

    // They had gone quiet and something just crossed the threshold. A cough, a
    // chair or a keystroke must NOT wipe the silence window and buy another
    // full 4.5 seconds, so the quiet clock keeps running until the sound has
    // lasted long enough to be someone actually resuming.
    const resumeSince = state.speechSince ?? now;
    if (now - resumeSince < sustainMs) {
      return {
        state: { ...state, speechSince: resumeSince },
        shouldStop: false,
      };
    }

    // Sustained: they are genuinely talking again. Now the window resets.
    return {
      state: { hasSpoken: true, quietSince: null, speechSince: null },
      shouldStop: false,
    };
  }

  const quietSince = state.quietSince ?? now;
  // The blip ended before it became speech; forget it.
  if (state.speechSince !== null) {
    return {
      state: { ...state, quietSince, speechSince: null },
      shouldStop: now - quietSince >= silenceMs,
    };
  }
  if (now - quietSince >= silenceMs) {
    return {
      state: { hasSpoken: true, quietSince: null, speechSince: null },
      shouldStop: true,
    };
  }
  return {
    state: { hasSpoken: true, quietSince, speechSince: null },
    shouldStop: false,
  };
}
