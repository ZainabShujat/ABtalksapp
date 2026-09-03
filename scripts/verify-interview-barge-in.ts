/**
 * Verification suite for interview barge-in and interruption handling.
 *
 * Tests:
 * 1. Duplex context initialization and open/close cycles
 * 2. Arming delay window guard (ignoring breath/onset before AEC convergence)
 * 3. Echo rejection (mic level proportional to TTS output below margin)
 * 4. Genuine candidate voice detection above echo margin and absolute floor
 * 5. Sustain window duration enforcement (>= 280ms continuous)
 * 6. Latching guarantee (at most one barge-in per spoken line)
 * 7. Mute protection (muted tracks cannot trigger barge-in)
 * 8. Transient interruption rejection (broken energy runs reset sustain timer)
 * 9. Deterministic fast-path regex for REPEAT requests
 * 10. Deterministic fast-path regex for CLARIFY requests
 * 11. Content-carrying utterances bypass fast-path to LLM
 * 12. advancesInterview invariant: ONLY "ANSWER" advances the interview
 * 13. Interruption Zod schema validation
 *
 * Usage:
 *   npx tsx scripts/verify-interview-barge-in.ts
 */

import {
  initialDuplexContext,
  openSpeaking,
  closeSpeaking,
  stepDuplex,
  isCandidateEnergy,
  ECHO_MARGIN,
  BARGE_IN_FLOOR_RMS,
  BARGE_IN_SUSTAIN_MS,
  BARGE_IN_ARM_DELAY_MS,
} from "../src/features/interview/duplex";
import {
  preClassifyInterruption,
  advancesInterview,
  looksLikeClarificationRequest,
  interruptionClassificationSchema,
  INTERRUPTION_KINDS,
} from "../src/features/interview/interruption";

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, description: string) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${description}`);
    throw new Error(`Assertion failed: ${description}`);
  }
  passedTests++;
  console.log(`✅ PASS: ${description}`);
}

console.log("\n=== 1. DUPLEX ENGINE & ECHO GUARD TESTS ===");

// Test 1: Initial context
const initCtx = initialDuplexContext();
assert(
  initCtx.speakingSince === null && initCtx.candidateSince === null && !initCtx.fired,
  "initialDuplexContext creates idle context with no active timers",
);

// Test 2: Open and close speaking
const t0 = 1000;
const openCtx = openSpeaking(t0);
assert(
  openCtx.speakingSince === t0 && !openCtx.fired,
  "openSpeaking arms the interviewer speaking clock",
);
const closedCtx = closeSpeaking();
assert(
  closedCtx.speakingSince === null && !closedCtx.fired,
  "closeSpeaking clears context back to initial state",
);

// Test 3: Arm delay window
let ctx = openSpeaking(t0);
// 200ms into speech (within 450ms arm delay)
const step1 = stepDuplex(ctx, {
  micRms: 0.8,
  ttsOutputLevel: 0.2,
  now: t0 + 200,
  muted: false,
});
assert(
  step1.effect === "none" && step1.context.candidateSince === null,
  "Speech within BARGE_IN_ARM_DELAY_MS is ignored while AEC converges",
);

// Test 4: Echo rejection
// Interviewer is loud (0.8), mic hears 0.4 (below 0.8 * 0.75 = 0.6)
assert(
  !isCandidateEnergy(0.4, 0.8, ECHO_MARGIN, BARGE_IN_FLOOR_RMS),
  "isCandidateEnergy rejects mic level tracking speaker echo below margin",
);

// Test 5: Candidate voice detection
// Interviewer output 0.3, mic level 0.6 (exceeds max(0.055, 0.3 * 0.75 = 0.225))
assert(
  isCandidateEnergy(0.6, 0.3, ECHO_MARGIN, BARGE_IN_FLOOR_RMS),
  "isCandidateEnergy recognizes candidate voice exceeding echo margin",
);

// Test 6: Sustain window enforcement
ctx = openSpeaking(t0);
const postArm = t0 + BARGE_IN_ARM_DELAY_MS + 10;

// Frame 1: Candidate starts talking
let step = stepDuplex(ctx, {
  micRms: 0.5,
  ttsOutputLevel: 0.2,
  now: postArm,
  muted: false,
});
assert(step.effect === "none" && step.context.candidateSince === postArm, "Candidate onset starts sustain timer");

// Frame 2: Candidate speaks for 150ms (< 280ms)
step = stepDuplex(step.context, {
  micRms: 0.5,
  ttsOutputLevel: 0.2,
  now: postArm + 150,
  muted: false,
});
assert(step.effect === "none" && !step.context.fired, "Sustain timer holds without firing before 280ms");

// Frame 3: Candidate reaches 280ms
step = stepDuplex(step.context, {
  micRms: 0.5,
  ttsOutputLevel: 0.2,
  now: postArm + BARGE_IN_SUSTAIN_MS,
  muted: false,
});
assert(
  step.effect === "bargeIn" && step.context.fired === true,
  "Sustain threshold reached: stepDuplex emits 'bargeIn' effect and latches fired=true",
);

// Test 7: Latching guarantee
const nextStep = stepDuplex(step.context, {
  micRms: 0.9,
  ttsOutputLevel: 0.1,
  now: postArm + BARGE_IN_SUSTAIN_MS + 50,
  muted: false,
});
assert(
  nextStep.effect === "none",
  "Latched context emits 'none' for subsequent frames (at most 1 barge-in per spoken line)",
);

// Test 8: Mute protection
ctx = openSpeaking(t0);
const mutedStep = stepDuplex(ctx, {
  micRms: 0.9,
  ttsOutputLevel: 0.0,
  now: postArm + BARGE_IN_SUSTAIN_MS + 100,
  muted: true,
});
assert(mutedStep.effect === "none", "Muted microphone never fires bargeIn");

// Test 9: Transient interruption reset
ctx = openSpeaking(t0);
step = stepDuplex(ctx, {
  micRms: 0.5,
  ttsOutputLevel: 0.2,
  now: postArm,
  muted: false,
});
// Sound drops for 1 frame (e.g. cough ends, pause)
step = stepDuplex(step.context, {
  micRms: 0.02,
  ttsOutputLevel: 0.2,
  now: postArm + 100,
  muted: false,
});
assert(
  step.context.candidateSince === null && step.effect === "none",
  "Interrupted energy resets candidateSince timer so non-speech transients do not accumulate",
);

console.log("\n=== 2. INTERRUPTION CLASSIFICATION & FAST PATH TESTS ===");

// Test 10: Fast-path REPEAT patterns
const repeatPhrases = [
  "Can you repeat that?",
  "Sorry, could you say that again please",
  "What was the question?",
  "I didn't catch that",
  "Pardon?",
];
for (const phrase of repeatPhrases) {
  const result = preClassifyInterruption(phrase);
  assert(
    result !== null && result.kind === "REPEAT",
    `preClassifyInterruption fast-paths unambiguous REPEAT: "${phrase}"`,
  );
}

// Test 11: CLARIFY must NOT be fast-pathed — it must reach the model.
//
// This assertion is INVERTED from what it used to say, deliberately. The fast
// path returned CLARIFY with an empty `reply`, so the caller had nothing to
// speak and simply restated the question: the commonest clarification request
// in the interview reliably produced no clarification. Deferring to the model
// is the fix, and this test now pins the deferral so it cannot be "optimised"
// back into a fast path.
const clarifyPhrases = [
  "What do you mean by that?",
  "Can you clarify the question?",
  "I don't understand the question",
  "In what sense?",
];
for (const phrase of clarifyPhrases) {
  assert(
    preClassifyInterruption(phrase) === null,
    `clarification defers to the classifier rather than fast-pathing: "${phrase}"`,
  );
  assert(
    looksLikeClarificationRequest(phrase),
    `clarification shape is still recognised for the ANSWER guard: "${phrase}"`,
  );
}

// Test 12: Content-carrying utterances bypass fast-path
const contentPhrases = [
  "Sorry what - I mean, I used Chroma because it was faster",
  "Can you say that again? Actually what I built was a RAG pipeline",
  "Wait, the reason I chose FAISS is memory overhead",
];
for (const phrase of contentPhrases) {
  const result = preClassifyInterruption(phrase);
  assert(
    result === null,
    `Utterance with technical content defers to LLM classifier: "${phrase}"`,
  );
}

// Test 13: advancesInterview invariant
for (const kind of INTERRUPTION_KINDS) {
  if (kind === "ANSWER") {
    assert(advancesInterview(kind) === true, "advancesInterview('ANSWER') === true");
  } else {
    assert(
      advancesInterview(kind) === false,
      `advancesInterview('${kind}') === false (enforces invariant: question stays open)`,
    );
  }
}

// Test 14: Schema validation
const validClassification = interruptionClassificationSchema.parse({
  kind: "CLARIFY",
  reason: "Candidate asked about vector dimensions",
  subject: "vector dimensions",
  reply: "I mean the embedding length produced by the model.",
  confidence: 0.95,
});
assert(
  validClassification.kind === "CLARIFY" && validClassification.reply.length > 0,
  "interruptionClassificationSchema validates complete classification",
);

console.log(`\n🎉 ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
