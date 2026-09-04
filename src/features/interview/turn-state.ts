import {
  INTERVIEW_SILENCE_MS,
  NO_ANSWER_MS,
  SPEECH_OFF_RMS,
  SPEECH_ON_RMS,
  SPEECH_SUSTAIN_MS,
} from "@/features/interview/constants";

/**
 * Who owns the candidate's turn, as one synchronous state machine.
 *
 * THE BUG THIS REPLACES. Turn ownership used to be split between a
 * `setTimeout` no-answer nudge and the audio loop, and the two could not see
 * each other. `MediaRecorder.stop()` is asynchronous, so a candidate could
 * begin speaking in the window between the nudge firing and `onstop` running:
 * the nudge had already set `discardRecordingRef`, the analyser had already set
 * `hasSpoken`, and a real answer was thrown away with "nudge took the floor".
 * No ordering of those two timers fixes it, because the race is between a timer
 * and an event, not between two timers.
 *
 * The fix is structural rather than defensive: there is now exactly one clock,
 * and it is the audio loop. Onset, pause, silence duration, no-answer waiting
 * and finalisation eligibility are all decided in the same synchronous frame
 * from the same sample, so "they started speaking" and "nobody has spoken" can
 * never both be true.
 *
 * Pure: no refs, no DOM, no timers. `now` is injected, so every rule below is
 * exercised in `verify-interview-turn-state.ts` without a microphone.
 */

export type TurnState =
  /** Microphone closed: an error, the interview ending, or before it starts. */
  | "idle"
  /** Microphone open, nothing said yet. The only state a nudge can fire from. */
  | "WAITING_FOR_SPEECH"
  /** Speech confirmed. From here the no-answer path is permanently closed. */
  | "CANDIDATE_SPEAKING"
  /**
   * The candidate took the floor by CUTTING THE INTERVIEWER OFF.
   *
   * Behaviourally the same as `CANDIDATE_SPEAKING` — the candidate is talking,
   * and quiet ends their utterance — but it is a distinct state because the
   * invariant it carries is distinct and was being violated.
   *
   * THE BUG THIS STATE EXISTS TO MAKE IMPOSSIBLE. A barge-in used to hand the
   * floor over by calling `openTurn`, which yields `WAITING_FOR_SPEECH` with
   * `hasSpoken: false` — "nobody has said anything on this turn". That is the
   * exact opposite of what just happened: barge-in only fires after the
   * candidate has sustained real speech over the top of the interviewer. The
   * turn then sat in the no-answer path, so `NO_ANSWER_MS` later the interviewer
   * asked a candidate who was mid-sentence whether they were still there, and
   * the time after that it recorded the question as unanswered and moved on.
   *
   * An interruption is not silence. Entering here with `hasSpoken` already true
   * closes the `nudge` / `moveOn` branch structurally rather than by a guard
   * that a later edit could forget: those effects are reachable only from
   * `WAITING_FOR_SPEECH`, and nothing transitions back into it within a turn.
   */
  | "CANDIDATE_INTERRUPTING"
  /** They stopped, but may resume. The silence window is running. */
  | "CANDIDATE_PAUSED"
  /** The window elapsed. The recorder is stopping and the answer is committed. */
  | "ANSWER_FINALIZING"
  /** Uploading to transcription and waiting on the agent. */
  | "PROCESSING"
  /** The interviewer is talking. The candidate's microphone is closed. */
  | "INTERVIEWER_SPEAKING";

export type TurnContext = {
  state: TurnState;
  /** When the microphone opened for this turn. Anchor for the no-answer wait. */
  openedAt: number | null;
  /** When the current run of quiet began. Anchor for the silence window. */
  quietSince: number | null;
  /** Start of a candidate run of sound, for the sustain requirement. */
  soundSince: number | null;
  /**
   * Whether real speech has been heard on this turn.
   *
   * Authoritative and one-way: nothing sets it back to false inside a turn. It
   * is the single fact that separates "they have not answered" from "they have
   * answered and paused", and every no-answer path is gated on it.
   */
  hasSpoken: boolean;
  /** When the microphone was muted, or null. Freezes every clock while set. */
  mutedSince: number | null;
  /** No-answer prompts already given on this turn. */
  nudges: number;
  /** True once the long-mute warning has been given, so it is said once. */
  mutedWarned: boolean;
};

/** What the room should DO as a result of this frame. At most one per frame. */
export type TurnEffect =
  | "none"
  /** Say the waiting line. The recording is untouched and keeps running. */
  | "nudge"
  /** Give up on this question and submit a non-answer. */
  | "moveOn"
  /** Stop the recorder and submit what was captured. Fires exactly once. */
  | "finalize"
  /** Warn that the microphone has been muted a long time. Nothing is submitted. */
  | "mutedWarning";

export type TurnStep = { context: TurnContext; effect: TurnEffect };

export type TurnThresholds = { on: number; off: number };

export const defaultTurnThresholds: TurnThresholds = {
  on: SPEECH_ON_RMS,
  off: SPEECH_OFF_RMS,
};

/** How long muted before the room says something. Never submits. */
export const MUTED_WARNING_MS = 10_000;

export function openTurn(now: number): TurnContext {
  return {
    state: "WAITING_FOR_SPEECH",
    openedAt: now,
    quietSince: null,
    soundSince: null,
    hasSpoken: false,
    mutedSince: null,
    nudges: 0,
    mutedWarned: false,
  };
}

/**
 * Opens a turn the candidate took by interrupting.
 *
 * `hasSpoken: true` is the whole point and is a statement of fact rather than an
 * optimisation: `duplex.ts` emits `bargeIn` only after the microphone has held
 * candidate-side energy continuously for `BARGE_IN_SUSTAIN_MS`, so by the time
 * this is called the candidate is demonstrably talking. Opening the turn as
 * though they had not is what let an interruption decay into an unanswered
 * question.
 *
 * `quietSince` starts null so the silence window is armed by the candidate
 * actually stopping, not by the moment the floor changed hands.
 */
export function openInterruptedTurn(now: number): TurnContext {
  return {
    state: "CANDIDATE_INTERRUPTING",
    openedAt: now,
    quietSince: null,
    soundSince: null,
    hasSpoken: true,
    mutedSince: null,
    nudges: 0,
    mutedWarned: false,
  };
}

export function initialTurnContext(): TurnContext {
  return {
    state: "idle",
    openedAt: null,
    quietSince: null,
    soundSince: null,
    hasSpoken: false,
    mutedSince: null,
    nudges: 0,
    mutedWarned: false,
  };
}

export type TurnInput = {
  rms: number;
  now: number;
  muted: boolean;
  thresholds?: TurnThresholds;
  silenceMs?: number;
  noAnswerMs?: number;
  sustainMs?: number;
};

/**
 * Advances the turn by one audio frame.
 *
 * Only `WAITING_FOR_SPEECH`, `CANDIDATE_SPEAKING` and `CANDIDATE_PAUSED` react
 * to audio. Once a turn reaches `ANSWER_FINALIZING` it is closed to this
 * function entirely, which is what makes double submission impossible without
 * a separate guard.
 */
export function stepTurn(ctx: TurnContext, input: TurnInput): TurnStep {
  const {
    rms,
    now,
    muted,
    thresholds = defaultTurnThresholds,
    silenceMs = INTERVIEW_SILENCE_MS,
    noAnswerMs = NO_ANSWER_MS,
    sustainMs = SPEECH_SUSTAIN_MS,
  } = input;

  // States the audio has no say over. Listed explicitly rather than defaulted,
  // so adding a state forces a decision about whether audio may move it.
  if (
    ctx.state === "idle" ||
    ctx.state === "ANSWER_FINALIZING" ||
    ctx.state === "PROCESSING" ||
    ctx.state === "INTERVIEWER_SPEAKING"
  ) {
    return { context: ctx, effect: "none" };
  }

  // ------------------------------------------------------------------ muted
  // Muting pauses the turn; it never ends it. Nothing is submitted, no captured
  // audio is dropped, and the clocks are frozen: on unmute every anchor is
  // pushed forward by exactly the muted interval, so time spent muted counts
  // toward neither the silence window nor the no-answer wait.
  if (muted) {
    const mutedSince = ctx.mutedSince ?? now;
    const held = now - mutedSince;
    // Warn once, at the threshold, rather than on every frame after it.
    const crossed =
      ctx.mutedSince !== null &&
      held >= MUTED_WARNING_MS &&
      !ctx.mutedWarned;
    return {
      context: {
        ...ctx,
        mutedSince,
        soundSince: null,
        mutedWarned: ctx.mutedWarned || crossed,
      },
      effect: crossed ? "mutedWarning" : "none",
    };
  }

  // Coming back from mute: re-base the clocks by the muted interval.
  const base: TurnContext =
    ctx.mutedSince === null
      ? ctx
      : {
          ...ctx,
          mutedSince: null,
          mutedWarned: false,
          openedAt: ctx.openedAt === null ? null : ctx.openedAt + (now - ctx.mutedSince),
          quietSince: ctx.quietSince === null ? null : ctx.quietSince + (now - ctx.mutedSince),
          soundSince: null,
        };

  return stepUnmuted(base, {
    rms,
    now,
    thresholds,
    silenceMs,
    noAnswerMs,
    sustainMs,
  });
}

function stepUnmuted(
  ctx: TurnContext,
  input: {
    rms: number;
    now: number;
    thresholds: TurnThresholds;
    silenceMs: number;
    noAnswerMs: number;
    sustainMs: number;
  },
): TurnStep {
  const { rms, now, thresholds, silenceMs, noAnswerMs, sustainMs } = input;

  if (ctx.state === "WAITING_FOR_SPEECH") {
    // Onset needs SUSTAIN. A door slam crosses the ON threshold for one frame;
    // a voice stays there. Without this a transient armed the silence clock
    // against someone who had not said anything.
    if (rms >= thresholds.on) {
      const soundSince = ctx.soundSince ?? now;
      if (now - soundSince >= sustainMs) {
        return {
          context: {
            ...ctx,
            state: "CANDIDATE_SPEAKING",
            hasSpoken: true,
            soundSince: null,
            quietSince: null,
          },
          effect: "none",
        };
      }
      return { context: { ...ctx, soundSince }, effect: "none" };
    }

    // The sound died before it became speech.
    const cleared = ctx.soundSince === null ? ctx : { ...ctx, soundSince: null };

    const openedAt = cleared.openedAt ?? now;
    if (now - openedAt >= noAnswerMs) {
      // First time: prompt and keep waiting on the SAME recording. Second time:
      // give up on the question. `hasSpoken` is false here by construction —
      // this branch is unreachable from any other state.
      const nudges = cleared.nudges + 1;
      return {
        context: { ...cleared, nudges, openedAt: now },
        effect: nudges === 1 ? "nudge" : "moveOn",
      };
    }
    return { context: { ...cleared, openedAt }, effect: "none" };
  }

  if (ctx.state === "CANDIDATE_INTERRUPTING") {
    if (rms >= thresholds.off) {
      // Still talking. It becomes an ordinary speaking turn: interrupting is how
      // the floor changed hands, not a different way of holding it.
      return {
        context: {
          ...ctx,
          state: "CANDIDATE_SPEAKING",
          quietSince: null,
          soundSince: null,
        },
        effect: "none",
      };
    }
    // They stopped. The silence window decides when the utterance is complete,
    // exactly as for any other answer — and `hasSpoken` is already true, so this
    // can only ever reach `finalize`, never `nudge` or `moveOn`.
    return { context: { ...ctx, state: "CANDIDATE_PAUSED", quietSince: now }, effect: "none" };
  }

  if (ctx.state === "CANDIDATE_SPEAKING") {
    if (rms >= thresholds.off) {
      return { context: { ...ctx, quietSince: null, soundSince: null }, effect: "none" };
    }
    return { context: { ...ctx, state: "CANDIDATE_PAUSED", quietSince: now }, effect: "none" };
  }

  // CANDIDATE_PAUSED
  if (rms >= thresholds.off) {
    // Sustain again: a cough during a pause must not buy another full window.
    const soundSince = ctx.soundSince ?? now;
    if (now - soundSince >= sustainMs) {
      return {
        context: { ...ctx, state: "CANDIDATE_SPEAKING", quietSince: null, soundSince: null },
        effect: "none",
      };
    }
    // Still deciding. The quiet clock deliberately keeps running underneath.
    const quietSince = ctx.quietSince ?? now;
    if (now - quietSince >= silenceMs) {
      return {
        context: { ...ctx, state: "ANSWER_FINALIZING", soundSince: null },
        effect: "finalize",
      };
    }
    return { context: { ...ctx, soundSince }, effect: "none" };
  }

  const quietSince = ctx.quietSince ?? now;
  if (now - quietSince >= silenceMs) {
    return {
      context: { ...ctx, state: "ANSWER_FINALIZING", soundSince: null, quietSince: null },
      effect: "finalize",
    };
  }
  return { context: { ...ctx, quietSince, soundSince: null }, effect: "none" };
}
