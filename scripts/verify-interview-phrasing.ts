/**
 * Verification suite for Two-Stage Conversational Phrasing.
 *
 * Tests:
 * 1. Stage 2 few-shot dataset structure and coverage of reasons
 * 2. Conversational moves enum completeness
 * 3. Structured intent builder (paraphrased missing evidence, context formatting)
 * 4. JSON provider phraseTurn integration with mock AskJson
 * 5. Move rotation tracking (recentMoves avoids repetitive sentence styles)
 * 6. Non-disruptive fallback: phrasing failure yields null without throwing
 *
 * Usage:
 *   npx tsx scripts/verify-interview-phrasing.ts
 */

import {
  FOLLOW_UP_EXAMPLES,
  buildPhraseTurnUserMessage,
  PHRASE_TURN_SYSTEM_PROMPT,
} from "../src/features/interview/agent/llm/phrase-turn-prompt";
import {
  CONVERSATIONAL_MOVES,
  type PhraseTurnInput,
  type TurnPhrasing,
} from "../src/features/interview/agent/llm/provider";
import { createJsonInterviewLLM, type AskJson } from "../src/features/interview/agent/llm/json-provider";

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

console.log("\n=== 1. STAGE 2 PROMPT & FEW-SHOT CURATION TESTS ===");

// Test 1: Few-shot coverage
assert(
  FOLLOW_UP_EXAMPLES.length >= 7,
  `FOLLOW_UP_EXAMPLES contains ${FOLLOW_UP_EXAMPLES.length} curated pairs (>= 7)`,
);

const expectedReasons = [
  "unsupported_claim",
  "worth_deepening",
  "vague",
  "incomplete",
  "surprising",
  "contradicts_earlier",
  "challenge_opportunity",
];
for (const reason of expectedReasons) {
  const found = FOLLOW_UP_EXAMPLES.some((ex) => ex.reason === reason);
  assert(found, `FOLLOW_UP_EXAMPLES covers reason "${reason}"`);
}

// Test 2: Conversational moves completeness
assert(
  CONVERSATIONAL_MOVES.length === 8,
  `CONVERSATIONAL_MOVES has exactly 8 moves (got ${CONVERSATIONAL_MOVES.length})`,
);
for (const move of [
  "acknowledge",
  "observe",
  "challenge",
  "compare",
  "wonder",
  "scenario",
  "narrow",
  "connect",
]) {
  assert(CONVERSATIONAL_MOVES.includes(move as any), `CONVERSATIONAL_MOVES includes "${move}"`);
}

// Test 3: Structured intent prompt builder
const sampleInput: PhraseTurnInput = {
  action: "FOLLOW_UP",
  candidateAnswer: "I switched to hybrid retrieval using BM25 and vector search.",
  currentQuestion: "How did you implement your search pipeline?",
  followUpReason: "worth_deepening",
  targetDetail: "chose hybrid search; explore how the two score lists are combined",
  whatIsKnown: ["Uses BM25 for lexical search", "Uses dense vector embeddings"],
  whatIsMissing: ["Explain the reciprocal rank fusion / score weighting strategy"],
  recentConversation: [
    { role: "interviewer", text: "How did you implement your search pipeline?" },
    { role: "candidate", text: "I switched to hybrid retrieval using BM25 and vector search." },
  ],
  recentMoves: ["acknowledge", "narrow"],
  flaggedIssues: [],
  calibratedLevel: "WORKING",
};

const userMessage = buildPhraseTurnUserMessage(sampleInput);
assert(userMessage.includes("REASON FOR THIS PROBE: worth_deepening"), "Prompt includes structured followUpReason");
assert(userMessage.includes("EXPLORE SPECIFICALLY: chose hybrid search"), "Prompt includes targetDetail");
assert(userMessage.includes("POINTS ALREADY ESTABLISHED:"), "Prompt includes whatIsKnown");
assert(userMessage.includes("WHAT IS MISSING:"), "Prompt includes whatIsMissing");
assert(
  userMessage.includes("RECENT CONVERSATIONAL MOVES TO AVOID REPEATING: acknowledge, narrow"),
  "Prompt instructs model to avoid repeating recent conversational moves",
);

console.log("\n=== 2. JSON PROVIDER PHRASE-TURN INTEGRATION TESTS ===");

// Test 4: Mock AskJson responding to phraseTurn
let lastCalledPrompt = "";
let lastTemperature = -1;

const mockAskJson: AskJson = async (opts) => {
  lastCalledPrompt = opts.system;
  lastTemperature = opts.temperature ?? 0;

  if (opts.system === PHRASE_TURN_SYSTEM_PROMPT) {
    return {
      ok: true,
      data: {
        acknowledgement:
          "Hybrid search gives you both keyword and semantic coverage.",
        followUpQuestion:
          "When you are merging the BM25 hits and the vector results, how are you weighting or normalizing the scores?",
        bridge: null,
        move: "wonder",
      },
    };
  }
  // Default analyzeAnswer return
  return {
    ok: true,
    data: {
      action: "FOLLOW_UP",
      reason: "Candidate has good foundation",
      evidence: {
        conceptualFound: true,
        practicalFound: true,
        tradeoffsFound: false,
        flaggedIssues: [],
        reasoning: "Solid explanation",
        matchedEvidence: ["Hybrid search architecture"],
        relevance: "ON_TOPIC",
      },
      followUpReason: "worth_deepening",
      targetDetail: "fusion weights",
    },
  };
};

const llm = createJsonInterviewLLM({
  name: "mock-conversational-llm",
  askJson: mockAskJson,
});

assert(typeof llm.phraseTurn === "function", "createJsonInterviewLLM exposes phraseTurn method");

/**
 * Wrapped in `main()` rather than written at the top level.
 *
 * tsx compiles these scripts through esbuild's CJS output, which rejects
 * top-level await outright, so this suite did not fail, it did not run at all.
 * Every other verify script in this directory has the same shape for the same
 * reason.
 */
async function main() {
  const phrasedResult = await llm.phraseTurn!(sampleInput);
  assert(phrasedResult !== null, "phraseTurn returns non-null TurnPhrasing object");
  assert(
    phrasedResult?.followUpQuestion?.includes("weighting or normalizing"),
    "phraseTurn produces specific targeted follow-up question",
  );
  assert(
    phrasedResult?.move === "wonder",
    "phraseTurn reports chosen conversational move for history tracking",
  );
  assert(
    lastTemperature === 0.8,
    `phraseTurn executes at temperature: 0.8 for natural speech (measured: ${lastTemperature})`,
  );

  // Test 5: Fallback safety (provider failure returns null without throwing)
  const failingAskJson: AskJson = async () => {
    return { ok: false, message: "Simulated upstream model timeout / 500" };
  };
  const failingLLM = createJsonInterviewLLM({
    name: "failing-llm",
    askJson: failingAskJson,
  });
  const safeFallback = await failingLLM.phraseTurn!(sampleInput);
  assert(
    safeFallback === null,
    "phraseTurn swallows errors and returns null fallback (never crashes turn)",
  );

  console.log(`
ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
}

void main();
