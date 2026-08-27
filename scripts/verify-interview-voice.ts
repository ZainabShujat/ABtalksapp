/**
 * Checks for the voice transport contract (docs/plans/072, Phase 3).
 *
 * The upload gate and the abuse identifier are security boundaries, so they
 * live in a pure module and are tested here without a network, a database, or a
 * microphone. What is NOT covered: the two upstream HTTP calls themselves,
 * which need a real OPENAI_API_KEY — see the report at the end of this run.
 *
 * Run: npx tsx scripts/verify-interview-voice.ts
 */
import assert from "node:assert/strict";

import {
  ALLOWED_AUDIO_TYPES,
  MAX_AUDIO_BYTES,
  MIN_AUDIO_BYTES,
  audioFilenameFor,
  isAllowedAudioType,
  normalizeAudioType,
  rejectAudioUpload,
  safetyIdentifierFor,
} from "../src/features/interview/voice-contract";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

console.log("\nVoice transport contract (plan 072, Phase 3)\n");

section("Abuse identifier");

check("is stable for the same member", () => {
  assert.equal(safetyIdentifierFor("pm_abc"), safetyIdentifierFor("pm_abc"));
});

check("differs between members", () => {
  assert.notEqual(safetyIdentifierFor("pm_abc"), safetyIdentifierFor("pm_xyz"));
});

check("leaks nothing about the member", () => {
  const id = safetyIdentifierFor("pm_abc");
  assert.equal(id.length, 64);
  assert.match(id, /^[0-9a-f]+$/);
  assert.ok(!id.includes("pm_abc"));
});

section("Upload gate");

check("accepts what MediaRecorder actually produces", () => {
  // The exact string Chrome reports. A naive equality check fails this, which
  // is the bug this normalisation exists to prevent.
  assert.equal(rejectAudioUpload(2048, "audio/webm;codecs=opus"), null);
  assert.equal(normalizeAudioType("audio/webm;codecs=opus"), "audio/webm");
});

check("accepts every allowed container", () => {
  for (const type of ALLOWED_AUDIO_TYPES) {
    // Sized from the constant, not a literal. This read 1024 and silently
    // started asserting the SIZE floor instead of the type gate the moment
    // MIN_AUDIO_BYTES was raised to 2048 for muted-track container headers.
    assert.equal(
      rejectAudioUpload(MIN_AUDIO_BYTES, type),
      null,
      `${type} was rejected`,
    );
  }
});

check("rejects an empty recording", () => {
  assert.equal(rejectAudioUpload(0, "audio/webm"), "EMPTY");
});

check("rejects an oversized recording", () => {
  assert.equal(rejectAudioUpload(MAX_AUDIO_BYTES + 1, "audio/webm"), "TOO_LARGE");
  assert.equal(rejectAudioUpload(MAX_AUDIO_BYTES, "audio/webm"), null);
});

check("rejects a non-audio upload", () => {
  // Above the size floor on purpose: below it the gate returns EMPTY and this
  // would pass without ever reaching the type check it exists to verify.
  assert.equal(
    rejectAudioUpload(MIN_AUDIO_BYTES, "application/zip"),
    "UNSUPPORTED_TYPE",
  );
  assert.equal(
    rejectAudioUpload(MIN_AUDIO_BYTES, "image/png"),
    "UNSUPPORTED_TYPE",
  );
  assert.equal(rejectAudioUpload(MIN_AUDIO_BYTES, ""), "UNSUPPORTED_TYPE");
});

check("rejects a type that merely starts with an allowed one", () => {
  assert.equal(isAllowedAudioType("audio/webmsomething"), false);
});

check("size is checked before type, so a huge file is refused cheaply", () => {
  assert.equal(rejectAudioUpload(MAX_AUDIO_BYTES + 1, "application/zip"), "TOO_LARGE");
});

section("Upload filename");

check("carries the container the provider needs", () => {
  assert.equal(audioFilenameFor("audio/webm;codecs=opus"), "answer.webm");
  assert.equal(audioFilenameFor("audio/mpeg"), "answer.mpeg");
  assert.equal(audioFilenameFor("audio/x-wav"), "answer.wav");
});

check("falls back rather than producing a nameless upload", () => {
  assert.equal(audioFilenameFor(""), "answer.webm");
});

console.log(`\n${passed} checks passed, ${failed} failed.`);
console.log(
  "\nNOT covered here: the OpenAI transcription and speech calls themselves,\n" +
    "and the browser MediaRecorder loop. Both need a real OPENAI_API_KEY and a\n" +
    "browser; neither is configured in this workspace.\n",
);
if (failed > 0) process.exitCode = 1;
