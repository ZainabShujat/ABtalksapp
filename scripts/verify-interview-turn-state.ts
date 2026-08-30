/**
 * Turn-ownership invariants. Deterministic, offline, no microphone.
 *
 *   npx tsx scripts/verify-interview-turn-state.ts
 *
 * These pin down the bug this state machine replaced: a `setTimeout` nudge and
 * the audio loop each believed they owned the turn, and a candidate who started
 * speaking in the gap between the nudge firing and `MediaRecorder.onstop`
 * running had a real answer discarded. Every check below is one of the
 * invariants that made that possible.
 */
import assert from "node:assert/strict";
import {
  MUTED_WARNING_MS,
  openTurn,
  stepTurn,
  type TurnContext,
  type TurnEffect,
} from "@/features/interview/turn-state";
import {
  INTERVIEW_SILENCE_MS,
  NO_ANSWER_MS,
  SPEECH_OFF_RMS,
  SPEECH_ON_RMS,
} from "@/features/interview/constants";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`       ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}

const SPEECH = SPEECH_ON_RMS + 0.03;
const QUIET = 0.001;
const FRAME = 50;

type Frame = { rms: number; muted?: boolean };

/** Plays frames at 50ms and records every effect the machine emitted. */
function play(frames: Frame[], from?: TurnContext) {
  let ctx = from ?? openTurn(0);
  const effects: { at: number; effect: TurnEffect }[] = [];
  frames.forEach((f, i) => {
    const now = (i + 1) * FRAME;
    const step = stepTurn(ctx, { rms: f.rms, now, muted: f.muted ?? false });
    ctx = step.context;
    if (step.effect !== "none") effects.push({ at: now, effect: step.effect });
  });
  return { ctx, effects };
}

const speak = (n: number): Frame[] => Array(n).fill({ rms: SPEECH });
const quiet = (n: number): Frame[] => Array(n).fill({ rms: QUIET });
const mutedQuiet = (n: number): Frame[] =>
  Array(n).fill({ rms: QUIET, muted: true });

console.log("\nNo-answer path");

check("1. no speech reaches the no-answer prompt", () => {
  const { ctx, effects } = play(quiet(Math.ceil(NO_ANSWER_MS / FRAME) + 2));
  assert.equal(effects[0]?.effect, "nudge");
  assert.equal(ctx.hasSpoken, false);
  assert.equal(ctx.state, "WAITING_FOR_SPEECH", "the mic stays open after a nudge");
});

check("2. still no speech after the prompt moves on", () => {
  const frames = quiet(Math.ceil((NO_ANSWER_MS * 2) / FRAME) + 4);
  const { effects } = play(frames);
  assert.deepEqual(
    effects.map((e) => e.effect),
    ["nudge", "moveOn"],
    "exactly one prompt, then move on",
  );
});

check("3. once they speak, the no-answer path is closed forever", () => {
  // Speak briefly, then stay quiet far longer than the no-answer wait.
  const { ctx, effects } = play([
    ...speak(10),
    ...quiet(Math.ceil((NO_ANSWER_MS * 3) / FRAME)),
  ]);
  assert.equal(ctx.hasSpoken, true);
  assert.ok(
    !effects.some((e) => e.effect === "nudge" || e.effect === "moveOn"),
    `a spoken turn must never nudge or move on, got ${JSON.stringify(effects)}`,
  );
  assert.ok(effects.some((e) => e.effect === "finalize"));
});

check("10. a real answer can never become a non-answer", () => {
  // The exact race: speech begins one frame before the no-answer deadline.
  const almost = Math.ceil(NO_ANSWER_MS / FRAME) - 1;
  const { ctx, effects } = play([
    ...quiet(almost),
    ...speak(10),
    ...quiet(Math.ceil(INTERVIEW_SILENCE_MS / FRAME) + 2),
  ]);
  assert.equal(ctx.hasSpoken, true);
  assert.ok(
    !effects.some((e) => e.effect === "moveOn"),
    "speech beat the deadline, so the turn must finalize, not move on",
  );
  assert.equal(effects.at(-1)?.effect, "finalize");
});

console.log("\nSpeaking and pausing");

check("4/5. speech, a 2s pause, resumption, then 4.5s finalizes", () => {
  const { ctx, effects } = play([
    ...speak(10),
    ...quiet(40), // 2s: under the window
    ...speak(10), // they carry on — same answer
    ...quiet(Math.ceil(INTERVIEW_SILENCE_MS / FRAME) + 2),
  ]);
  assert.equal(
    effects.filter((e) => e.effect === "finalize").length,
    1,
    "the short pause must not have finalized",
  );
  assert.equal(ctx.state, "ANSWER_FINALIZING");
});

check("5. the silence window is the shared 4.5s constant", () => {
  const spoken = 10;
  const { effects } = play([
    ...speak(spoken),
    ...quiet(Math.ceil(INTERVIEW_SILENCE_MS / FRAME) + 4),
  ]);
  const at = effects.find((e) => e.effect === "finalize")?.at;
  assert.ok(at !== undefined, "should finalize");
  const afterTheyStopped = at! - spoken * FRAME;
  assert.ok(
    Math.abs(afterTheyStopped - INTERVIEW_SILENCE_MS) <= FRAME * 2,
    `finalized ${afterTheyStopped}ms after they stopped, expected ~${INTERVIEW_SILENCE_MS}`,
  );
});

check("11. a transient spike does not open a turn", () => {
  // One loud frame: a desk knock. Too short to be a voice.
  const { ctx } = play([{ rms: SPEECH }, ...quiet(20)]);
  assert.equal(ctx.hasSpoken, false);
  assert.equal(ctx.state, "WAITING_FOR_SPEECH");
});

check("12. a transient during a pause does not reset the silence clock", () => {
  const spoken = 10;
  const { effects } = play([
    ...speak(spoken),
    ...quiet(40),
    { rms: SPEECH }, // a single-frame cough
    ...quiet(Math.ceil(INTERVIEW_SILENCE_MS / FRAME) + 4),
  ]);
  const at = effects.find((e) => e.effect === "finalize")?.at;
  assert.ok(at !== undefined);
  const afterTheyStopped = at! - spoken * FRAME;
  assert.ok(
    afterTheyStopped < INTERVIEW_SILENCE_MS + 400,
    `the cough bought another window: finalized ${afterTheyStopped}ms after they stopped`,
  );
});

console.log("\nMute safety");

check("6/7. muting preserves the turn and never finalizes", () => {
  const { ctx, effects } = play([
    ...speak(10),
    ...mutedQuiet(Math.ceil((MUTED_WARNING_MS + 4_000) / FRAME)),
  ]);
  assert.ok(
    !effects.some((e) => e.effect === "finalize" || e.effect === "moveOn"),
    "muting must not submit or abandon the answer",
  );
  assert.equal(ctx.hasSpoken, true, "the answer is still theirs");
  assert.ok(effects.some((e) => e.effect === "mutedWarning"));
});

check("the long-mute warning is given exactly once", () => {
  const { effects } = play([
    ...speak(10),
    ...mutedQuiet(Math.ceil((MUTED_WARNING_MS * 3) / FRAME)),
  ]);
  assert.equal(effects.filter((e) => e.effect === "mutedWarning").length, 1);
});

check("6. unmuting resumes the same turn, muted time not counted", () => {
  const spoken = 10;
  const mutedFrames = Math.ceil(12_000 / FRAME);
  const { ctx, effects } = play([
    ...speak(spoken),
    ...mutedQuiet(mutedFrames),
    ...quiet(Math.ceil(INTERVIEW_SILENCE_MS / FRAME) + 4),
  ]);
  assert.equal(ctx.hasSpoken, true);
  const at = effects.find((e) => e.effect === "finalize")?.at;
  assert.ok(at !== undefined, "should finalize after unmuting");
  // Finalisation must be ~4.5s after the UNMUTE, not after they stopped talking.
  const afterUnmute = at! - (spoken + mutedFrames) * FRAME;
  assert.ok(
    Math.abs(afterUnmute - INTERVIEW_SILENCE_MS) <= FRAME * 3,
    `finalized ${afterUnmute}ms after unmute — muted time leaked into the window`,
  );
});

check("muting while waiting does not advance the no-answer clock", () => {
  const { effects } = play(mutedQuiet(Math.ceil((NO_ANSWER_MS * 3) / FRAME)));
  assert.ok(
    !effects.some((e) => e.effect === "nudge" || e.effect === "moveOn"),
    "a muted candidate is not an absent one",
  );
});

console.log("\nFinalisation is once, and only from one path");

check("9/13. finalize is emitted exactly once and the turn then closes", () => {
  const { ctx, effects } = play([
    ...speak(10),
    ...quiet(Math.ceil((INTERVIEW_SILENCE_MS * 4) / FRAME)),
  ]);
  assert.equal(
    effects.filter((e) => e.effect === "finalize").length,
    1,
    "a second finalize would upload the same audio twice",
  );
  assert.equal(ctx.state, "ANSWER_FINALIZING");
});

check("8. no effect can fire once the turn is finalizing", () => {
  let ctx = openTurn(0);
  ({ context: ctx } = stepTurn(ctx, { rms: SPEECH, now: 500, muted: false }));
  ctx = { ...ctx, state: "ANSWER_FINALIZING" };
  for (let i = 1; i < 400; i++) {
    const step = stepTurn(ctx, { rms: i % 2 ? SPEECH : QUIET, now: 500 + i * FRAME, muted: false });
    assert.equal(step.effect, "none", "a finalizing turn must be inert");
    ctx = step.context;
  }
  assert.equal(ctx.state, "ANSWER_FINALIZING");
});

check("PROCESSING and INTERVIEWER_SPEAKING are inert to audio", () => {
  for (const state of ["PROCESSING", "INTERVIEWER_SPEAKING", "idle"] as const) {
    const ctx: TurnContext = { ...openTurn(0), state };
    const step = stepTurn(ctx, { rms: SPEECH, now: 99_999, muted: false });
    assert.equal(step.effect, "none");
    assert.equal(step.context.state, state);
  }
});

check("hysteresis: the OFF threshold keeps a quiet syllable alive", () => {
  const { ctx } = play([
    ...speak(10),
    ...Array(20).fill({ rms: SPEECH_OFF_RMS }), // 1s at the lower bound
  ]);
  assert.equal(ctx.state, "CANDIDATE_SPEAKING", "at/above OFF is still talking");
});

console.log(`\n${passed} checks passed, ${failed} failed.\n`);
if (failed > 0) process.exitCode = 1;
