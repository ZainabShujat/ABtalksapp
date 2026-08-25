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
import { checkLanguage, nonLatinRatio } from "@/features/interview/language-gate";
import {
  INTERVIEW_SILENCE_MS,
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
function run(levels: number[], msPerFrame = 50) {
  let state: SilenceState = initialSilenceState();
  for (let i = 0; i < levels.length; i++) {
    const step = stepSilence(state, levels[i]!, i * msPerFrame);
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
