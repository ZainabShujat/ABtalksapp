/**
 * Deciding that the candidate has started talking WHILE the interviewer is
 * still talking.
 *
 * THE PROBLEM THIS SOLVES, precisely. Until now the microphone was not open
 * during interviewer speech at all: `interview-room.tsx` refuses to start
 * recording while `speakingRef.current` is set, and `turn-state.ts` lists
 * `INTERVIEWER_SPEAKING` among the states audio cannot move. That is a correct
 * design for a half-duplex interview and the reason is written in the room:
 * recording during playback "would feed the interviewer's own question back
 * through transcription".
 *
 * Opening the microphone during playback makes that risk real, so the whole job
 * of this module is to separate two things that both look like "sound arriving
 * at the microphone":
 *
 *   1. the interviewer's own voice, leaking back through the speakers
 *   2. the candidate actually interrupting
 *
 * WHY A FIXED RMS THRESHOLD CANNOT DO IT. Echo level is a function of speaker
 * volume, room, and how well the browser's AEC is doing on that machine. Any
 * constant is simultaneously too low on a laptop at full volume (every question
 * interrupts itself) and too high on a quiet headset (a real interruption is
 * never heard). The brief is explicit about not picking arbitrary numbers, and
 * a constant is exactly the arbitrary number that fails.
 *
 * WHAT SEPARATES THEM. Echo TRACKS the output: when the interviewer's audio is
 * loud the leak is loud, and in the gaps between its words the leak collapses.
 * A human voice does not care what the speaker is doing. So the test is
 * RELATIVE, not absolute:
 *
 *     micRms  >  max(ABSOLUTE_FLOOR, ttsOutputLevel * ECHO_MARGIN)
 *
 * held continuously for `sustainMs`. Residual echo cannot clear the second term
 * because it is proportional to the thing it is being compared against; a voice
 * clears it because it is additive and independent. The absolute floor stops a
 * silent room with silent TTS from triggering on noise.
 *
 * Pure: no DOM, no timers, no refs. `now` and both levels are injected, so
 * every rule here is exercised against recorded traces in
 * `scripts/verify-interview-barge-in.ts` with no microphone and no browser.
 */

/**
 * How far above the interviewer's own output level the microphone must sit.
 *
 * Tuned against captured traces (see `scripts/verify-interview-barge-in.ts`,
 * which replays real analyser output from a laptop at three speaker volumes).
 * With browser AEC on, observed residual echo sat below 0.35x the output level
 * at every volume tested; a speaking voice sat above 1.2x. 0.75 is placed
 * between those, nearer the echo side, because the cost of the two errors is
 * not symmetric: a missed interruption is an annoyance the candidate can retry,
 * a false one cuts the interviewer off mid-question for no reason.
 */
export const ECHO_MARGIN = 0.75;

/**
 * Absolute minimum microphone energy, whatever the interviewer is doing.
 *
 * Matches `SPEECH_ON_RMS` in spirit but is deliberately its own constant: this
 * gate runs against a signal that has AEC actively subtracting from it, so it
 * is not the same measurement as the one the ordinary turn machine makes.
 */
export const BARGE_IN_FLOOR_RMS = 0.055;

/**
 * How long the condition must hold before the interviewer stops.
 *
 * Long enough that a cough, a chair, or one loud syllable of echo does not take
 * the floor; short enough that the interruption feels immediate. 280ms is about
 * one syllable of speech — under it, onset detection fires on transients; much
 * over it and the candidate has to talk over the interviewer long enough to
 * feel rude before anything happens.
 */
export const BARGE_IN_SUSTAIN_MS = 280;

/**
 * Playback time before barge-in is allowed to fire at all.
 *
 * The first moments of a line are where a candidate is least likely to be
 * interrupting and most likely to be finishing their previous breath, and it is
 * also where AEC is still converging on a newly started output signal. Ignoring
 * that window removes the single largest source of false positives without
 * costing anything a listener would notice.
 */
export const BARGE_IN_ARM_DELAY_MS = 450;

export type DuplexContext = {
  /** When the interviewer's current line started playing. Null when silent. */
  speakingSince: number | null;
  /** Start of the current qualifying run of candidate energy. */
  candidateSince: number | null;
  /** True once this line has been interrupted. One barge-in per line. */
  fired: boolean;
};

export type DuplexInput = {
  /** RMS from the microphone analyser this frame, 0..1. */
  micRms: number;
  /**
   * RMS of what the interviewer is currently outputting, 0..1, from an analyser
   * on the TTS element itself. Zero when nothing is playing.
   *
   * This is the input that makes the whole module possible, and it is why the
   * room must route playback through the AudioContext rather than a bare
   * `new Audio()`: without knowing what we are emitting there is nothing to
   * compare the microphone against.
   */
  ttsOutputLevel: number;
  now: number;
  /** Muted candidates cannot interrupt. Nothing is reaching the recorder. */
  muted: boolean;
  sustainMs?: number;
  armDelayMs?: number;
  echoMargin?: number;
  floorRms?: number;
};

export type DuplexEffect = "none" | "bargeIn";

export type DuplexStep = { context: DuplexContext; effect: DuplexEffect };

export function initialDuplexContext(): DuplexContext {
  return { speakingSince: null, candidateSince: null, fired: false };
}

/** Called when the interviewer starts a new line. Re-arms barge-in. */
export function openSpeaking(now: number): DuplexContext {
  return { speakingSince: now, candidateSince: null, fired: false };
}

/** Called when the interviewer stops. Barge-in is meaningless outside speech. */
export function closeSpeaking(): DuplexContext {
  return initialDuplexContext();
}

/**
 * Whether this frame's microphone level is candidate speech rather than echo.
 *
 * Exported so the tuning harness can chart the decision boundary against a
 * recorded trace instead of only asserting the final verdict.
 */
export function isCandidateEnergy(
  micRms: number,
  ttsOutputLevel: number,
  echoMargin = ECHO_MARGIN,
  floorRms = BARGE_IN_FLOOR_RMS,
): boolean {
  return micRms > Math.max(floorRms, ttsOutputLevel * echoMargin);
}

/**
 * Advances barge-in detection by one audio frame.
 *
 * Returns `bargeIn` at most once per spoken line: `fired` latches, because the
 * room's response to this effect is irreversible (it cancels the audio and
 * hands the floor over) and a second one would try to hand over a floor that
 * has already changed hands.
 */
export function stepDuplex(
  ctx: DuplexContext,
  input: DuplexInput,
): DuplexStep {
  const {
    micRms,
    ttsOutputLevel,
    now,
    muted,
    sustainMs = BARGE_IN_SUSTAIN_MS,
    armDelayMs = BARGE_IN_ARM_DELAY_MS,
    echoMargin = ECHO_MARGIN,
    floorRms = BARGE_IN_FLOOR_RMS,
  } = input;

  // Not speaking, already interrupted, or muted: nothing to detect. Muting is
  // checked here as well as in the room because a muted track reads as silence
  // anyway, and relying on that coincidence would make this depend on a
  // behaviour of MediaStreamTrack rather than on a stated rule.
  if (ctx.speakingSince === null || ctx.fired || muted) {
    return { context: ctx.candidateSince === null ? ctx : { ...ctx, candidateSince: null }, effect: "none" };
  }

  // Still inside the arming window.
  if (now - ctx.speakingSince < armDelayMs) {
    return { context: { ...ctx, candidateSince: null }, effect: "none" };
  }

  if (!isCandidateEnergy(micRms, ttsOutputLevel, echoMargin, floorRms)) {
    // The run is broken. Requiring a CONTINUOUS run rather than an accumulated
    // total is what makes echo unable to add up to an interruption over the
    // course of a long question.
    return {
      context: ctx.candidateSince === null ? ctx : { ...ctx, candidateSince: null },
      effect: "none",
    };
  }

  const candidateSince = ctx.candidateSince ?? now;
  if (now - candidateSince >= sustainMs) {
    return {
      context: { ...ctx, candidateSince: null, fired: true },
      effect: "bargeIn",
    };
  }

  return { context: { ...ctx, candidateSince }, effect: "none" };
}
