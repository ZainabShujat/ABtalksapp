/**
 * The conversational turn contract: barge-in hand-off and speech playback.
 *
 * WHAT THIS SUITE IS FOR, and why it is not the other two. `verify-interview-
 * barge-in.ts` proves the duplex DETECTOR fires on the right frames.
 * `verify-interview-interruption-state.ts` proves the SERVICE does not advance
 * the interview on a non-answer. Between them sat the two failures that made the
 * feature unusable in a real browser, and neither suite could see either one:
 *
 *   1. The floor was handed to an interrupting candidate as
 *      `WAITING_FOR_SPEECH` / `hasSpoken: false` — "nobody has spoken on this
 *      turn". Detection was correct, the server was correct, and the room then
 *      nudged a talking candidate after `NO_ANSWER_MS` and recorded the
 *      question as unanswered after the second. An interruption decayed into a
 *      silence.
 *
 *   2. A successful Deepgram synthesis played into an AudioContext that had been
 *      closed. `play()` resolved, `currentTime` advanced, the reveal animated —
 *      and nothing was audible, so the stall watchdog fired and the browser
 *      voice read every line of the interview. Every log said the speech
 *      pipeline worked.
 *
 * Both are now decided by pure functions, so both are pinned here without a
 * browser, a microphone, or an audio device.
 *
 * Run: npx tsx scripts/verify-interview-conversational-turn.ts
 */
import assert from "node:assert/strict";

import {
  BARGE_IN_ARM_DELAY_MS,
  BARGE_IN_SUSTAIN_MS,
  initialDuplexContext,
  openSpeaking,
  stepDuplex,
} from "../src/features/interview/duplex";
import {
  openInterruptedTurn,
  openTurn,
  stepTurn,
  type TurnContext,
  type TurnEffect,
} from "../src/features/interview/turn-state";
import {
  INTERVIEW_SILENCE_MS,
  NO_ANSWER_MS,
  SPEECH_OFF_RMS,
  SPEECH_ON_RMS,
  SPEECH_SUSTAIN_MS,
} from "../src/features/interview/constants";
import {
  classifyPlayback,
  isPlaybackGraphUsable,
  shouldUseBrowserFallback,
  HAVE_CURRENT_DATA,
  PLAYBACK_BUFFER_GRACE_MS,
  PLAYBACK_STALL_MS,
  type PlaybackProbe,
  type SpeechOutcome,
} from "../src/features/interview/playback";
import {
  advancesInterview,
  INTERRUPTION_KINDS,
} from "../src/features/interview/interruption";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Runs the turn machine over a constant level for a span of time.
 *
 * Every effect is collected rather than only the last, because the assertions
 * that matter are about effects that must NEVER appear. Checking the final state
 * would miss a `nudge` emitted and swallowed halfway through.
 */
function driveTurn(
  start: TurnContext,
  options: {
    rms: number;
    fromMs: number;
    toMs: number;
    stepMs?: number;
    silenceMs?: number;
  },
): { context: TurnContext; effects: TurnEffect[] } {
  const stepMs = options.stepMs ?? 50;
  let context = start;
  const effects: TurnEffect[] = [];
  for (let now = options.fromMs; now <= options.toMs; now += stepMs) {
    const result = stepTurn(context, {
      rms: options.rms,
      now,
      muted: false,
      silenceMs: options.silenceMs,
    });
    context = result.context;
    if (result.effect !== "none") effects.push(result.effect);
  }
  return { context, effects };
}

/** A healthy element mid-playback, as the room would sample it. */
function probe(overrides: Partial<PlaybackProbe> = {}): PlaybackProbe {
  return {
    currentTime: 1.2,
    paused: false,
    ended: false,
    readyState: 4,
    elapsedMs: 500,
    contextState: "running",
    ...overrides,
  };
}

console.log("\nConversational turn contract\n");

/* ==================================================================== A ==== */
console.log("A. barge-in requests cancellation immediately");

check(
  "A1. sustained candidate energy over interviewer audio emits bargeIn",
  () => {
    const t0 = 10_000;
    let ctx = openSpeaking(t0);
    const armed = t0 + BARGE_IN_ARM_DELAY_MS + 10;

    // The candidate talks over a moderately loud interviewer.
    let effect: string = "none";
    for (let now = armed; now <= armed + BARGE_IN_SUSTAIN_MS; now += 40) {
      const step = stepDuplex(ctx, {
        micRms: 0.5,
        ttsOutputLevel: 0.2,
        now,
        muted: false,
      });
      ctx = step.context;
      if (step.effect !== "none") effect = step.effect;
    }
    assert.equal(effect, "bargeIn", "cancellation must be requested");
  },
);

check(
  "A2. cancellation is requested no later than arm delay + sustain",
  () => {
    const t0 = 0;
    let ctx = openSpeaking(t0);
    let firedAt: number | null = null;
    for (let now = 0; now <= 5_000; now += 10) {
      const step = stepDuplex(ctx, {
        micRms: 0.5,
        ttsOutputLevel: 0.2,
        now,
        muted: false,
      });
      ctx = step.context;
      if (step.effect === "bargeIn" && firedAt === null) firedAt = now;
    }
    assert.ok(firedAt !== null, "barge-in must fire at all");
    // The interviewer stops mid-sentence rather than at the end of the line.
    // Ten milliseconds of slack for the sampling grid.
    assert.ok(
      firedAt! <= BARGE_IN_ARM_DELAY_MS + BARGE_IN_SUSTAIN_MS + 10,
      `fired at ${firedAt}ms, budget is ${BARGE_IN_ARM_DELAY_MS + BARGE_IN_SUSTAIN_MS}ms`,
    );
  },
);

check("A3. the interviewer's own echo never requests cancellation", () => {
  const t0 = 0;
  let ctx = openSpeaking(t0);
  let effect: string = "none";
  // Mic level TRACKS the output, which is what echo does and a voice does not.
  for (let now = 0; now <= 8_000; now += 20) {
    const ttsOutputLevel = 0.6;
    const step = stepDuplex(ctx, {
      micRms: ttsOutputLevel * 0.35, // observed residual with AEC on
      ttsOutputLevel,
      now,
      muted: false,
    });
    ctx = step.context;
    if (step.effect !== "none") effect = step.effect;
  }
  assert.equal(effect, "none", "echo must not take the floor");
});

/* ==================================================================== B ==== */
console.log("\nB. cancellation settles the speak() wait, without a fallback");

check("B1. a paused element classifies as cancelled, not stalled", () => {
  // `cancelSpeech` pauses the element. Reading that as a stall is what made an
  // interrupted interviewer resume through the browser voice.
  assert.equal(
    classifyPlayback(probe({ paused: true, currentTime: 0, elapsedMs: 60_000 })),
    "cancelled",
  );
});

check("B2. cancelled playback never engages the browser voice", () => {
  assert.equal(shouldUseBrowserFallback({ kind: "cancelled" }), false);
});

check("B3. every settle verdict is terminal — no wait can hang", () => {
  // The failure this pins: an earlier watchdog cleared its interval on `paused`
  // WITHOUT resolving, so `speak()` never settled, the phase stayed "speaking"
  // and the room stopped taking turns. Each terminal sample must therefore
  // produce a non-"waiting" verdict.
  const terminal: PlaybackProbe[] = [
    probe({ ended: true }),
    probe({ paused: true }),
    probe({ contextState: "closed" }),
    probe({ currentTime: 0, readyState: 4, elapsedMs: PLAYBACK_STALL_MS + 1 }),
    probe({
      currentTime: 0,
      readyState: 0,
      elapsedMs: PLAYBACK_BUFFER_GRACE_MS + 1,
    }),
  ];
  for (const sample of terminal) {
    assert.notEqual(
      classifyPlayback(sample),
      "waiting",
      `terminal sample must settle: ${JSON.stringify(sample)}`,
    );
  }
});

/* ==================================================================== C ==== */
console.log("\nC. an interruption is never an unanswered question");

check("C1. openInterruptedTurn starts with speech already established", () => {
  const ctx = openInterruptedTurn(1_000);
  assert.equal(ctx.state, "CANDIDATE_INTERRUPTING");
  assert.equal(
    ctx.hasSpoken,
    true,
    "barge-in only fires after sustained speech; the turn must say so",
  );
  assert.equal(ctx.nudges, 0);
});

check(
  "C2. silence after an interruption finalizes and NEVER nudges or moves on",
  () => {
    // Held quiet far longer than both no-answer waits combined.
    const { effects } = driveTurn(openInterruptedTurn(0), {
      rms: 0,
      fromMs: 0,
      toMs: NO_ANSWER_MS * 4 + INTERVIEW_SILENCE_MS,
    });
    assert.ok(
      !effects.includes("nudge"),
      `an interrupted turn must never nudge (got ${effects.join(",")})`,
    );
    assert.ok(
      !effects.includes("moveOn"),
      `an interrupted turn must never move on (got ${effects.join(",")})`,
    );
    assert.ok(
      effects.includes("finalize"),
      "the utterance must still be submitted when they stop",
    );
  },
);

check("C3. the OLD hand-off would have failed this — regression pin", () => {
  // `openTurn` is what the room used to call on barge-in. Kept as an explicit
  // demonstration that the bug was real and that the new state is what fixes
  // it, rather than a comment claiming so.
  const { effects } = driveTurn(openTurn(0), {
    rms: 0,
    fromMs: 0,
    toMs: NO_ANSWER_MS * 4,
  });
  assert.ok(
    effects.includes("nudge") && effects.includes("moveOn"),
    "openTurn is the no-answer path; that is why barge-in must not use it",
  );
});

check("C4. a continuing interruption becomes an ordinary speaking turn", () => {
  const step = stepTurn(openInterruptedTurn(0), {
    rms: SPEECH_ON_RMS * 2,
    now: 20,
    muted: false,
  });
  assert.equal(step.context.state, "CANDIDATE_SPEAKING");
  assert.equal(step.context.hasSpoken, true);
});

check(
  "C5. an interrupted turn that keeps talking still ends by silence only",
  () => {
    // Talk, then stop: the utterance must finalize, and still never nudge.
    const talking = driveTurn(openInterruptedTurn(0), {
      rms: SPEECH_ON_RMS * 2,
      fromMs: 0,
      toMs: 3_000,
    });
    assert.ok(!talking.effects.includes("nudge"));
    const quiet = driveTurn(talking.context, {
      rms: 0,
      fromMs: 3_050,
      toMs: 3_050 + INTERVIEW_SILENCE_MS + 500,
    });
    assert.ok(!quiet.effects.includes("nudge"));
    assert.ok(!quiet.effects.includes("moveOn"));
    assert.ok(quiet.effects.includes("finalize"));
  },
);

check("C6. a false barge-in still cannot cost the question", () => {
  // Echo briefly clears the barge-in floor, the room hands the floor over, and
  // nobody actually speaks. The correct outcome is an empty capture that hands
  // the turn straight back — never a recorded non-answer.
  const { effects } = driveTurn(openInterruptedTurn(0), {
    rms: 0,
    fromMs: 0,
    toMs: INTERVIEW_SILENCE_MS + 1_000,
  });
  assert.deepEqual(
    effects.filter((e) => e !== "finalize"),
    [],
    "the only effect may be finalize",
  );
});

/* ============================================================ D through I == */
console.log("\nD-I. only an ANSWER may advance the interview");

check("D-I. advancesInterview admits ANSWER and nothing else", () => {
  // The per-classification state assertions live in
  // `verify-interview-interruption-state.ts`, which drives the real service
  // against in-memory persistence. This is the invariant they all rest on.
  for (const kind of INTERRUPTION_KINDS) {
    assert.equal(
      advancesInterview(kind),
      kind === "ANSWER",
      `${kind} advancing must be ${kind === "ANSWER"}`,
    );
  }
});

/* ==================================================================== J ==== */
console.log("\nJ. a successful Deepgram line does not fall back");

check("J1. currentTime 0 immediately after play() is not a failure", () => {
  assert.equal(
    classifyPlayback(probe({ currentTime: 0, elapsedMs: 0, readyState: 4 })),
    "waiting",
    "the clock has not had time to move",
  );
});

check("J2. a buffering element is given grace, not the browser voice", () => {
  // The rule that shipped tested `currentTime === 0` after 1.2s against ANY
  // element, so a line whose bytes were still arriving was declared a playback
  // failure and re-read by the browser voice on top of the audio that then
  // started.
  assert.equal(
    classifyPlayback(
      probe({
        currentTime: 0,
        readyState: HAVE_CURRENT_DATA - 1,
        elapsedMs: PLAYBACK_STALL_MS + 200,
      }),
    ),
    "waiting",
  );
});

check("J3. once the clock moves, playback is playing whatever else is true", () => {
  assert.equal(
    classifyPlayback(probe({ currentTime: 0.01, elapsedMs: 60_000, readyState: 2 })),
    "playing",
  );
});

check("J4. audible Deepgram audio never engages the browser voice", () => {
  assert.equal(shouldUseBrowserFallback({ kind: "spoke" }), false);
});

/* ==================================================================== K ==== */
console.log("\nK. a closed AudioContext is never successful playback");

check("K1. a closed context classifies as stalled, not playing", () => {
  // The exact shipped state: play() resolved, the clock advanced, the reveal
  // animated, and the element's output was routed into a closed graph so
  // nothing was audible.
  assert.equal(
    classifyPlayback(probe({ contextState: "closed", currentTime: 3.4 })),
    "stalled",
  );
});

check("K2. a closed context is stalled with no grace period", () => {
  assert.equal(
    classifyPlayback(
      probe({ contextState: "closed", currentTime: 0, elapsedMs: 0 }),
    ),
    "stalled",
  );
});

check("K3. a closed context is never a reusable playback graph", () => {
  assert.equal(isPlaybackGraphUsable("closed"), false);
  // Suspended is recoverable by a gesture; unattached plays straight to the
  // speakers. Neither may be discarded, or the room throws away a working
  // element on every gesture.
  assert.equal(isPlaybackGraphUsable("suspended"), true);
  assert.equal(isPlaybackGraphUsable("running"), true);
  assert.equal(isPlaybackGraphUsable("none"), true);
});

/* ============================================== the three-way distinction == */
console.log("\nFallback activation distinguishes provider from playback failure");

check("distinguishes provider failure, playback failure, and cancellation", () => {
  const cases: Array<[SpeechOutcome, boolean]> = [
    [{ kind: "spoke" }, false],
    [{ kind: "cancelled" }, false],
    [{ kind: "providerFailed", status: 500 }, true],
    [{ kind: "providerFailed", status: null }, true],
    [{ kind: "playbackFailed", reason: "closed-context" }, true],
    [{ kind: "playbackFailed", reason: "stalled" }, true],
    [{ kind: "playbackFailed", reason: "play-rejected" }, true],
  ];
  for (const [outcome, expected] of cases) {
    assert.equal(
      shouldUseBrowserFallback(outcome),
      expected,
      `${outcome.kind} fallback should be ${expected}`,
    );
  }
});

check("a Deepgram 200 that played is not reported as a provider failure", () => {
  // The distinction the room could not previously express: these three states
  // all produced the same "no audio" verdict and the same browser fallback.
  const spoke: SpeechOutcome = { kind: "spoke" };
  const providerDown: SpeechOutcome = { kind: "providerFailed", status: 502 };
  const deadGraph: SpeechOutcome = {
    kind: "playbackFailed",
    reason: "closed-context",
  };
  assert.notEqual(spoke.kind, providerDown.kind);
  assert.notEqual(providerDown.kind, deadGraph.kind);
  assert.equal(shouldUseBrowserFallback(spoke), false);
});

/* ================================================ ordinary turn regression == */
console.log("\nOrdinary turn-taking is unchanged");

check("a silent, never-interrupted turn still nudges then moves on", () => {
  const { effects } = driveTurn(openTurn(0), {
    rms: 0,
    fromMs: 0,
    toMs: NO_ANSWER_MS * 3,
  });
  assert.deepEqual(effects.slice(0, 2), ["nudge", "moveOn"]);
});

check("an ordinary answer still finalizes on the silence window", () => {
  const spoke = driveTurn(openTurn(0), {
    rms: SPEECH_ON_RMS * 2,
    fromMs: 0,
    toMs: SPEECH_SUSTAIN_MS + 500,
  });
  assert.equal(spoke.context.state, "CANDIDATE_SPEAKING");
  const quiet = driveTurn(spoke.context, {
    rms: SPEECH_OFF_RMS / 2,
    fromMs: SPEECH_SUSTAIN_MS + 550,
    toMs: SPEECH_SUSTAIN_MS + 550 + INTERVIEW_SILENCE_MS + 200,
  });
  assert.ok(quiet.effects.includes("finalize"));
});

check("the duplex detector is inert when the interviewer is silent", () => {
  const step = stepDuplex(initialDuplexContext(), {
    micRms: 0.9,
    ttsOutputLevel: 0,
    now: 5_000,
    muted: false,
  });
  assert.equal(step.effect, "none");
});

/* ------------------------------------------------------------------ result */

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
