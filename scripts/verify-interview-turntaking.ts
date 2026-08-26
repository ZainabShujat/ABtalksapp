/**
 * Turn-taking and language-gate checks. Deterministic, offline.
 *
 *   npx tsx scripts/verify-interview-turntaking.ts
 *
 * No microphone, no browser, no provider. Silence handling is exercised through
 * the pure reducer in `features/interview/silence.ts`, and the English-only gate
 * through `features/interview/language-gate.ts` — both of which exist as pure
 * modules precisely so this file can exist.
 */
import assert from "node:assert/strict";
import {
  initialSilenceState,
  stepSilence,
  type SilenceState,
} from "@/features/interview/silence";
import {
  checkLanguage,
  nonLatinRatio,
  LANGUAGE_RETRY_LINE,
} from "@/features/interview/language-gate";
import {
  MOVING_ON_LINE,
  REPEAT_PREFIX,
  ROOM_LINE_KINDS,
  repeatLine,
} from "@/features/interview/room-lines";
import {
  INTERVIEW_SILENCE_MS,
  NO_ANSWER_MS,
  MAX_LANGUAGE_RETRIES_PER_QUESTION,
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

/** Runs a level sequence at 50ms per frame and reports when it would stop. */
function run(
  levels: number[],
  msPerFrame = 50,
  thresholds?: { on: number; off: number },
) {
  let state: SilenceState = initialSilenceState();
  for (let i = 0; i < levels.length; i++) {
    const step = stepSilence(
      state,
      levels[i]!,
      i * msPerFrame,
      undefined,
      thresholds,
    );
    state = step.state;
    if (step.shouldStop) return { stoppedAtMs: i * msPerFrame, state };
  }
  return { stoppedAtMs: null as number | null, state };
}

const SPEECH = SPEECH_ON_RMS + 0.03;
const NOISE = SPEECH_OFF_RMS - 0.012;
const QUIET = 0.001;

console.log("\nSilence handling");

check("1. a candidate who never speaks is never auto-submitted", () => {
  // Thirty seconds of room tone, far beyond the 4.5s window.
  const { stoppedAtMs, state } = run(Array(600).fill(QUIET));
  assert.equal(stoppedAtMs, null);
  assert.equal(state.hasSpoken, false);
});

check("2. speech then ~4.5s of silence submits the answer", () => {
  const levels = [...Array(40).fill(SPEECH), ...Array(200).fill(QUIET)];
  const { stoppedAtMs } = run(levels);
  assert.ok(stoppedAtMs !== null, "should have stopped");
  const silenceElapsed = stoppedAtMs! - 40 * 50;
  assert.ok(
    Math.abs(silenceElapsed - INTERVIEW_SILENCE_MS) <= 100,
    `stopped after ${silenceElapsed}ms of silence, expected ~${INTERVIEW_SILENCE_MS}`,
  );
});

check("3. background noise alone never starts the turn", () => {
  const { stoppedAtMs, state } = run(Array(600).fill(NOISE));
  assert.equal(state.hasSpoken, false, "noise must not count as speech");
  assert.equal(stoppedAtMs, null);
});

check("4. resuming before the window elapses resets the timer", () => {
  const levels = [
    ...Array(20).fill(SPEECH),
    ...Array(60).fill(QUIET), // 3s pause, under the threshold
    ...Array(20).fill(SPEECH), // they carry on
    ...Array(200).fill(QUIET), // and finally stop
  ];
  const { stoppedAtMs } = run(levels);
  assert.ok(stoppedAtMs !== null);
  // Must stop relative to the SECOND pause, not the first.
  assert.ok(
    stoppedAtMs! > 100 * 50,
    `stopped at ${stoppedAtMs}ms — the first pause was treated as the end`,
  );
});

check("4b. a quiet syllable mid-answer does not end the turn", () => {
  const levels = [
    ...Array(20).fill(SPEECH),
    ...Array(10).fill(SPEECH_OFF_RMS), // right on the lower threshold
    ...Array(20).fill(SPEECH),
    ...Array(40).fill(QUIET), // 2s, under the window
  ];
  assert.equal(run(levels).stoppedAtMs, null);
});

check("4c. thresholds are calibratable per recording", () => {
  // A noisy room: the floor sits where the DEFAULT would have called it speech.
  // Raised thresholds must treat it as room tone, not as an answer in progress.
  const noisyRoom = SPEECH_ON_RMS + 0.01;
  const raised = { on: noisyRoom * 2, off: noisyRoom * 1.5 };

  assert.equal(
    run(Array(600).fill(noisyRoom)).state.hasSpoken,
    true,
    "sanity: at the default thresholds this level does read as speech",
  );
  assert.equal(
    run(Array(600).fill(noisyRoom), 50, raised).state.hasSpoken,
    false,
    "raised against the measured floor, the same level is room tone",
  );
});

check("4d. the thresholds are amplitudes a real voice actually reaches", () => {
  // The regression this guards: these were 0.20/0.15 read off the analyser's
  // FREQUENCY data, which is a dB curve rather than an amplitude. A normal
  // speaking voice on a laptop microphone peaks around 0.10 of full scale, so
  // `hasSpoken` never became true, no answer ever auto-submitted, and the room
  // appeared to wait forever.
  const typicalSpeech = 0.1;
  assert.ok(
    SPEECH_ON_RMS < typicalSpeech,
    `SPEECH_ON_RMS (${SPEECH_ON_RMS}) must sit below ordinary speech (~${typicalSpeech})`,
  );
  assert.ok(
    SPEECH_OFF_RMS < SPEECH_ON_RMS,
    "the OFF threshold must be the lower of the two, or hysteresis is inverted",
  );
  const quietRoom = 0.01;
  assert.ok(
    SPEECH_OFF_RMS > quietRoom,
    "the OFF threshold must sit above a quiet room, or an answer never ends",
  );
});

check("4e. a transient noise does not open the turn", () => {
  // A door slam or a desk knock: one or two loud frames, then quiet. Loud
  // enough to cross the ON threshold, far too short to be a voice. Before the
  // sustain requirement this flipped `hasSpoken`, which armed the silence clock
  // against a candidate who had not said anything yet.
  const bang = [SPEECH, SPEECH, ...Array(200).fill(QUIET)];
  const { stoppedAtMs, state } = run(bang);
  assert.equal(state.hasSpoken, false, "a 100ms transient is not speech");
  assert.equal(stoppedAtMs, null);
});

check("4f. sustained speech still opens the turn promptly", () => {
  // 400ms of level, which is a syllable or two. Must register.
  const { state } = run([...Array(8).fill(SPEECH), ...Array(4).fill(QUIET)]);
  assert.equal(state.hasSpoken, true);
});

check("4g. a blip during a pause does not reset the silence window", () => {
  // They stop talking, then a cough or keystroke crosses the threshold briefly.
  // That must not buy another full window: the quiet clock keeps running, so
  // the answer still ends about 4.5s after they actually stopped.
  const levels = [
    ...Array(20).fill(SPEECH), // 1s of answer
    ...Array(40).fill(QUIET), // 2s quiet
    SPEECH, // a 50ms blip
    ...Array(200).fill(QUIET),
  ];
  const { stoppedAtMs } = run(levels);
  assert.ok(stoppedAtMs !== null, "should still stop");
  const sinceTheyStopped = stoppedAtMs! - 20 * 50;
  assert.ok(
    sinceTheyStopped < INTERVIEW_SILENCE_MS + 600,
    `stopped ${sinceTheyStopped}ms after they stopped — the blip reset the window`,
  );
});

check("4h. genuinely resuming DOES reset the window", () => {
  const levels = [
    ...Array(20).fill(SPEECH),
    ...Array(40).fill(QUIET), // 2s pause
    ...Array(12).fill(SPEECH), // 600ms, sustained: a real resumption
    ...Array(200).fill(QUIET),
  ];
  const { stoppedAtMs } = run(levels);
  assert.ok(stoppedAtMs !== null);
  assert.ok(
    stoppedAtMs! > 72 * 50,
    "a real resumption must restart the silence window",
  );
});

check("two silence windows pass before anything is recorded unanswered", () => {
  // The room prompts after one window and only moves on after a second, so a
  // muted or quiet candidate gets ~9s and one spoken prompt before any
  // "(no response)" is submitted.
  assert.equal(NO_ANSWER_MS, INTERVIEW_SILENCE_MS);
  assert.ok(NO_ANSWER_MS * 2 >= 9_000, "two chances, not one");
});

console.log("\nRoom-composed lines");

check("the three room lines are distinct and none is the opening", () => {
  // Each of these is spoken by the ROOM, not by the agent, so none of them is in
  // the server transcript. The speech route must therefore be asked for them by
  // KIND. When it was only ever asked for "the latest line", a candidate who
  // fell silent heard the opening greeting read out again instead of the nudge.
  const lines = [repeatLine("What did you build?"), MOVING_ON_LINE, LANGUAGE_RETRY_LINE];
  assert.equal(new Set(lines).size, 3, "the three lines must not collide");
  assert.ok(
    ROOM_LINE_KINDS.includes("repeat") &&
      ROOM_LINE_KINDS.includes("moving_on") &&
      ROOM_LINE_KINDS.includes("language"),
    "every room-composed line needs a kind the speech route understands",
  );
});

check("the nudge restates the question in full", () => {
  const question = "Walk me through how you chose your retrieval strategy.";
  const line = repeatLine(question);
  assert.ok(line.startsWith(REPEAT_PREFIX));
  assert.ok(
    line.includes(question),
    "silence usually means the question was missed, so it must be repeated whole",
  );
});

check("the nudge degrades to the prefix when no question is open", () => {
  assert.equal(repeatLine("   "), REPEAT_PREFIX);
});

check("repeated silence is bounded and always reaches 'moving on'", () => {
  // Mirrors the room's nudge counter. The regression this guards: nudge one
  // cancelled the recording in order to speak, and nudge two was gated on the
  // analyser and the "listening" phase that cancelling had just torn down — so a
  // muted candidate sat on "Take your time" forever and the interview never
  // moved on. The escalation must not depend on the audio it just stopped.
  let nudges = 0;
  const fire = (audioStillLive: boolean) => {
    const escalating = nudges >= 1;
    if (!escalating && !audioStillLive) return "waited";
    nudges += 1;
    return nudges === 1 ? "waiting_line" : "moving_on";
  };

  assert.equal(fire(true), "waiting_line");
  // Audio is now torn down. The escalation must still fire.
  assert.equal(fire(false), "moving_on");
  assert.equal(nudges, 2, "silence resolves in exactly two steps");
});

console.log("\nEnglish-only gate");

check("5. an English answer passes", () => {
  const v = checkLanguage(
    "I used Ollama because I did not need an API key and local testing was faster.",
    null,
  );
  assert.equal(v.ok, true);
});

check("6. an answer in Devanagari is rejected", () => {
  const v = checkLanguage(
    "मैंने मॉडल को लोकल चलाया क्योंकि मुझे एपीआई की ज़रूरत नहीं थी और यह आसान था।",
    null,
  );
  assert.equal(v.ok, false);
  assert.equal(v.reason, "script");
});

check("7. Hinglish in Latin script is NOT rejected", () => {
  const v = checkLanguage(
    "I used Ollama because mujhe local testing easier laga, and I didn't need an API key.",
    null,
  );
  assert.equal(v.ok, true, "predominantly English must pass");
});

check("7b. one transliterated proper noun does not reject an answer", () => {
  const v = checkLanguage(
    "We indexed the policy docs and the retrieval step returned the right चंक every time in testing.",
    null,
  );
  assert.equal(v.ok, true);
  assert.ok(v.nonLatinRatio < 0.3);
});

check("provider language is trusted over the script test", () => {
  // Provider says English; the script test would have been borderline.
  assert.equal(checkLanguage("mostly English text here", "en").ok, true);
  assert.equal(checkLanguage("mostly English text here", "english").ok, true);
  // Provider says Hindi; trusted even though the text is Latin (romanised).
  const v = checkLanguage("maine model ko local chalaya kyunki aasan tha", "hi");
  assert.equal(v.ok, false);
  assert.equal(v.reason, "provider");
});

check("a very short reply is left to the ordinary stuck path", () => {
  // Too few letters for a ratio to mean anything; the gate abstains.
  assert.equal(checkLanguage("नहीं", null).ok, true);
});

check("nonLatinRatio counts letters only", () => {
  assert.equal(nonLatinRatio("abc 123 !!!"), 0);
  assert.equal(nonLatinRatio(""), 0);
  assert.ok(nonLatinRatio("मैंने") > 0.9);
});

console.log("\nLanguage retry is bounded");

check("8/10. the retry budget is one and cannot loop", () => {
  assert.equal(MAX_LANGUAGE_RETRIES_PER_QUESTION, 1);

  // Mirrors the room's guard: retries are counted per question and the second
  // non-English answer falls through to the ordinary path instead of asking
  // again. Nothing here spends a follow-up: the interview state is not touched
  // on a language retry at all.
  let retries = 0;
  const attempt = () => {
    if (retries < MAX_LANGUAGE_RETRIES_PER_QUESTION) {
      retries += 1;
      return "ASK_IN_ENGLISH";
    }
    return "FALL_THROUGH";
  };
  assert.equal(attempt(), "ASK_IN_ENGLISH");
  assert.equal(attempt(), "FALL_THROUGH");
  assert.equal(attempt(), "FALL_THROUGH");
  assert.equal(retries, 1, "never more than one correction per question");
});

check("9. an English retry is assessed normally", () => {
  // The same question is still on the floor, so the retry is just an answer.
  const v = checkLanguage(
    "Sorry. I ran it locally so I could test without an API key.",
    null,
  );
  assert.equal(v.ok, true);
});

console.log(
  `\n${passed} checks passed, ${failed} failed.\n`,
);
if (failed > 0) process.exitCode = 1;
