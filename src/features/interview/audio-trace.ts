/**
 * Measuring what the microphone is actually producing.
 *
 * WHY THIS EXISTS RATHER THAN A THRESHOLD TWEAK. Every previous round of
 * "it cannot hear me" was answered by moving `SPEECH_ON_RMS`, and the constants
 * file records what that cost: 0.20 against frequency data (speech never
 * registered), then 0.007/0.004 (OFF fell below the room's own noise floor, so
 * the turn never ended and the answer never submitted — shipped twice). Both
 * regressions came from changing a number without a measurement of the signal
 * it was being compared against.
 *
 * So this module produces the measurement instead of a guess. It summarises a
 * rolling window of frames into the five quantities that actually decide
 * detection:
 *
 *   - the NOISE FLOOR, as a low percentile of quiet frames. Not the minimum,
 *     which is one lucky sample, and not the mean, which speech drags upward.
 *   - SPEECH LEVEL, as a high percentile of loud frames.
 *   - the TTS OUTPUT LEVEL reached while the interviewer was speaking, which is
 *     what `duplex.ts` compares the microphone against.
 *   - the ECHO HEADROOM actually observed: how far the microphone sat above or
 *     below the barge-in threshold during playback. Negative means barge-in
 *     could not have fired; a large positive means it fires on echo.
 *   - the longest SUSTAINED RUN above the ON threshold, which is what
 *     `SPEECH_SUSTAIN_MS` is tested against.
 *
 * A threshold change is defensible with these numbers in front of it and is
 * guesswork without them. Nothing here feeds a decision — it is read by the
 * diagnostics strip and by `window.__interviewAudioTrace` during a real browser
 * session, and it must stay that way: a detector that adapts to its own trace is
 * a feedback loop, which is the failure the noise-floor calibration already had.
 *
 * Pure and allocation-light: a fixed ring buffer, no timers, no DOM.
 */

/** Frames kept. At ~60fps this is about eight seconds, which spans a turn. */
export const TRACE_CAPACITY = 512;

export type TraceFrame = {
  /** Microphone RMS, 0..1 amplitude. */
  rms: number;
  /** Interviewer output RMS this frame, 0 when silent or unmeasurable. */
  ttsLevel: number;
  /** Whether the interviewer was speaking. Separates the two populations. */
  speaking: boolean;
  now: number;
};

export type AudioTraceSummary = {
  frames: number;
  /**
   * Low percentile of frames captured while the interviewer was silent.
   *
   * The honest noise floor: what the room produces with nobody talking.
   */
  noiseFloor: number;
  /** Median of quiet-side frames, for a sense of the spread. */
  quietMedian: number;
  /** High percentile of interviewer-silent frames — the candidate's voice. */
  speechLevel: number;
  /** Loudest microphone frame seen while the interviewer was silent. */
  speechPeak: number;
  /** High percentile of the interviewer's own output level. */
  ttsLevel: number;
  /**
   * Microphone level observed WHILE the interviewer was speaking, high
   * percentile. This is echo plus any candidate speech.
   */
  micDuringSpeech: number;
  /**
   * Worst-case headroom against the barge-in rule during playback:
   * `micDuringSpeech - max(floorRms, ttsLevel * echoMargin)`.
   *
   * Negative is healthy — echo alone cannot take the floor. Positive means
   * something crossed the barge-in threshold without a candidate speaking.
   */
  echoHeadroom: number;
  /** Longest continuous run above `onThreshold`, in milliseconds. */
  longestRunMs: number;
};

/**
 * A fixed-size ring of frames.
 *
 * A class rather than a closure because the analyser loop pushes to it sixty
 * times a second and must not allocate on the hot path.
 */
export class AudioTrace {
  private readonly frames: TraceFrame[] = [];
  private cursor = 0;

  constructor(private readonly capacity: number = TRACE_CAPACITY) {}

  push(frame: TraceFrame): void {
    if (this.frames.length < this.capacity) {
      this.frames.push(frame);
      return;
    }
    this.frames[this.cursor] = frame;
    this.cursor = (this.cursor + 1) % this.capacity;
  }

  clear(): void {
    this.frames.length = 0;
    this.cursor = 0;
  }

  snapshot(): TraceFrame[] {
    return this.frames.slice();
  }

  summarize(options: {
    onThreshold: number;
    echoMargin: number;
    floorRms: number;
  }): AudioTraceSummary {
    return summarizeTrace(this.frames, options);
  }
}

/** Percentile over an already-sorted ascending array. Empty gives 0. */
function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * p)),
  );
  return sorted[index]!;
}

/**
 * Summarises a window of frames.
 *
 * The two populations are kept apart by `speaking` rather than by level, which
 * matters: splitting on amplitude would classify a loud echo as speech and prove
 * whatever the thresholds already believed.
 */
export function summarizeTrace(
  frames: readonly TraceFrame[],
  options: { onThreshold: number; echoMargin: number; floorRms: number },
): AudioTraceSummary {
  const quiet: number[] = [];
  const duringSpeech: number[] = [];
  const ttsLevels: number[] = [];

  for (const frame of frames) {
    if (frame.speaking) {
      duringSpeech.push(frame.rms);
      ttsLevels.push(frame.ttsLevel);
    } else {
      quiet.push(frame.rms);
    }
  }

  quiet.sort((a, b) => a - b);
  duringSpeech.sort((a, b) => a - b);
  ttsLevels.sort((a, b) => a - b);

  const noiseFloor = percentileSorted(quiet, 0.1);
  const speechLevel = percentileSorted(quiet, 0.9);
  const ttsLevel = percentileSorted(ttsLevels, 0.9);
  const micDuringSpeech = percentileSorted(duringSpeech, 0.9);

  const bargeInThreshold = Math.max(
    options.floorRms,
    ttsLevel * options.echoMargin,
  );

  return {
    frames: frames.length,
    noiseFloor,
    quietMedian: percentileSorted(quiet, 0.5),
    speechLevel,
    speechPeak: quiet.length > 0 ? quiet[quiet.length - 1]! : 0,
    ttsLevel,
    micDuringSpeech,
    echoHeadroom:
      duringSpeech.length === 0 ? 0 : micDuringSpeech - bargeInThreshold,
    longestRunMs: longestRunAbove(frames, options.onThreshold),
  };
}

/**
 * Longest continuous stretch above `threshold`, in milliseconds.
 *
 * Compared against `SPEECH_SUSTAIN_MS` and `BARGE_IN_SUSTAIN_MS`: a microphone
 * whose speech never holds above ON for the sustain window will never open a
 * turn however well-placed the amplitude threshold is, and that is a different
 * fault with a different fix. Frames are already in time order within a window;
 * a ring wrap shows up as a negative delta and simply breaks the run, which is
 * the conservative reading.
 */
export function longestRunAbove(
  frames: readonly TraceFrame[],
  threshold: number,
): number {
  let longest = 0;
  let runStart: number | null = null;
  let previous: number | null = null;

  for (const frame of frames) {
    const wrapped = previous !== null && frame.now < previous;
    previous = frame.now;

    if (frame.rms >= threshold && !wrapped) {
      runStart ??= frame.now;
      longest = Math.max(longest, frame.now - runStart);
    } else {
      runStart = frame.rms >= threshold ? frame.now : null;
    }
  }

  return longest;
}
