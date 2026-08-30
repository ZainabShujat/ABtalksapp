/**
 * Question-phrasing checks. Deterministic, offline, no provider.
 *
 *   npx tsx scripts/verify-interview-generation.ts
 *
 * These are the rules that decide whether a candidate hears a model-phrased
 * question or the authored one, so they are the rules most worth pinning down.
 */
import assert from "node:assert/strict";
import {
  FRAMING,
  choosePhrasing,
  questionOverlap,
  rejectPhrasing,
} from "@/features/interview/cohort/question-phrasing";
import { getQuestionBank } from "@/features/interview/cohort/question-bank";
import { routeDecision } from "@/features/interview/agent/policy";
import { createInitialState } from "@/features/interview/state";
import type { InterviewDecision } from "@/features/interview/agent/types";
import type { PlannedQuestion } from "@/features/interview/types";

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

const AUTHORED =
  "You compared Chroma and Pinecone and chose Chroma. What decided it?";
const EVIDENCE = [
  "local persistence with no external service",
  "cost of a hosted vector database",
  "dataset small enough not to need managed scaling",
];

console.log("\nGenerated question validation");

check("a natural rephrasing of the same question is accepted", () => {
  const v = choosePhrasing(
    "You looked at both Chroma and Pinecone. What tipped you toward Chroma?",
    AUTHORED,
    EVIDENCE,
  );
  assert.equal(v.rejection, null);
  assert.equal(v.generated, true);
});

check("a question naming an expected-evidence item is rejected", () => {
  // This hands over the answer: the candidate only has to agree.
  const r = rejectPhrasing(
    "Did you choose Chroma because of local persistence with no external service?",
    AUTHORED,
    EVIDENCE,
  );
  assert.equal(r, "LEAKS_EVIDENCE");
});

check("a compound question is rejected", () => {
  const r = rejectPhrasing(
    "Why did you choose Chroma? And what would make you switch to Pinecone?",
    AUTHORED,
    EVIDENCE,
  );
  assert.equal(r, "MULTIPLE_QUESTIONS");
});

check("an off-target question is rejected", () => {
  const r = rejectPhrasing(
    "How did you handle authentication on the API layer?",
    AUTHORED,
    EVIDENCE,
  );
  assert.equal(r, "OFF_TARGET");
});

check("a statement is rejected", () => {
  assert.equal(
    rejectPhrasing("Your Chroma choice was reasonable for that dataset.", AUTHORED, EVIDENCE),
    "NOT_A_QUESTION",
  );
});

check("an over-long question is rejected", () => {
  const long = `Why did you pick Chroma ${"and consider the alternatives ".repeat(12)}?`;
  assert.equal(rejectPhrasing(long, AUTHORED, EVIDENCE), "TOO_LONG");
});

check("every rejection falls back to the authored text, verbatim", () => {
  for (const bad of [
    "",
    "How did you handle authentication on the API layer?",
    "Why Chroma? And why not Pinecone?",
    "Tell me about Chroma.",
  ]) {
    const v = choosePhrasing(bad, AUTHORED, EVIDENCE);
    assert.equal(v.text, AUTHORED, `"${bad}" must fall back`);
    assert.equal(v.generated, false);
  }
  // A missing generation (provider down, no key) behaves the same way.
  assert.equal(choosePhrasing(null, AUTHORED, EVIDENCE).text, AUTHORED);
});

console.log("\nDifficulty framing");

check("the three bands are distinct instructions", () => {
  const bands = [FRAMING.FOUNDATIONS, FRAMING.WORKING, FRAMING.ADVANCED];
  assert.equal(new Set(bands).size, 3, "bands must not collide");
  // The regression this guards: calibration used to change tone only, so a
  // FOUNDATIONS candidate and an ADVANCED one heard the identical question.
  assert.ok(/personally did/i.test(FRAMING.FOUNDATIONS));
  assert.ok(/failure modes|scale/i.test(FRAMING.ADVANCED));
});

check("framing never mentions evidence, scoring or the rubric", () => {
  for (const [band, text] of Object.entries(FRAMING)) {
    assert.ok(
      !/evidence|rubric|score|criteria/i.test(text),
      `${band} leaks assessment vocabulary into the question`,
    );
  }
});

console.log("\nAgainst the real bank");

check("every authored CORE question passes its own validator", () => {
  // If the authored text could not survive the rules, the rules are wrong.
  for (const blueprint of ["DAY_15", "DAY_31"] as const) {
    for (const q of getQuestionBank(blueprint).questions) {
      const r = rejectPhrasing(q.text, q.text, q.expectedEvidence);
      assert.ok(
        r === null || r === "LEAKS_EVIDENCE",
        `${q.id} rejected as ${r}: ${q.text}`,
      );
    }
  }
});

check("overlap is directional and ignores filler", () => {
  assert.equal(questionOverlap("", "anything"), 1);
  assert.ok(
    questionOverlap(AUTHORED, "What decided Chroma over Pinecone for you?") >= 0.25,
  );
  assert.ok(questionOverlap(AUTHORED, "How is the weather today?") < 0.25);
});

console.log("\nIncorrect answers");

check("a wrong answer earns one re-approach, then moves on", () => {
  const question = {
    id: "q1",
    order: 1,
    competency: "CONCEPTUAL_UNDERSTANDING",
    tier: "CORE",
    text: "What is FAISS storing in your setup?",
    expectedEvidence: ["vector embeddings", "similarity search index"],
    minEvidence: 1,
    maxFollowUps: 1,
    followUpPrompt: "Let's narrow that down. What goes into the index?",
  } as unknown as PlannedQuestion;

  const wrong = {
    action: "NEXT_QUESTION",
    reason: "",
    degraded: false,
    followUpQuestion: "What is FAISS actually storing in that setup?",
    evidence: {
      conceptualFound: false,
      practicalFound: false,
      tradeoffsFound: false,
      flaggedIssues: ["factually_wrong"],
      reasoning: "",
      matchedEvidence: [],
      relevance: "ON_TOPIC",
    },
  } as unknown as InterviewDecision;

  const state = createInitialState();
  const fresh = {
    followUpsAsked: 0,
    redirectsAsked: 0,
    repeatsAsked: 0,
    clarificationsAsked: 0,
  };

  // First time: re-approach rather than move past it.
  const first = routeDecision(question, wrong, fresh, state);
  assert.equal(first.action, "FOLLOW_UP");
  assert.ok(first.probeText && first.probeText.length > 0);
  assert.ok(
    !/wrong|incorrect|no,/i.test(first.probeText!),
    "a re-approach must never tell them they are wrong",
  );

  // Budget spent and still wrong: move on, without comment.
  const spent = { ...fresh, followUpsAsked: 1 };
  assert.equal(routeDecision(question, wrong, spent, state).action, "NEXT_QUESTION");
});

console.log(`\n${passed} checks passed, ${failed} failed.\n`);
if (failed > 0) process.exitCode = 1;
