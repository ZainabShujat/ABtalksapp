/**
 * Regression suite for the three conversational defects found in the live probe.
 *
 * Each of these was observed in a real interview, not theorised:
 *
 *   1. CLARIFY produced no clarification. "What do you mean by grounding?" hit a
 *      regex fast path that returned an empty reply, so the interviewer restated
 *      the question and said nothing else.
 *   2. ESCALATE lost its acknowledgement. Stage 1 was moved to the lean
 *      assessment prompt (which writes no prose) and ESCALATE skipped stage 2,
 *      so a strong answer was met with a harder question and no sign it had been
 *      heard.
 *   3. REDIRECT restated the CORE question after an escalation, sending the
 *      candidate back to something answered two turns earlier.
 *
 * These tests assert the corrected behaviour at the level each defect lives at:
 * the pure classifier rules, the graph node that drafts the redirect, and the
 * stage-2 gate. Only the model is substituted; every rule under test is real.
 *
 * Run: npx tsx --conditions=react-server scripts/verify-interview-conversational-fixes.ts
 */
import assert from "node:assert/strict";

import {
  preClassifyInterruption,
  looksLikeClarificationRequest,
  resolveInterruptionReply,
  joinSpoken,
  CLARIFY_UNAVAILABLE_LINE,
} from "../src/features/interview/interruption";
import { planCohortInterview } from "../src/features/interview/cohort/planner";
import { createInitialState, startInterview } from "../src/features/interview/state";
import {
  applyRedirect,
  applyRepeat,
  createPhraseTurn,
} from "../src/features/interview/agent/nodes";
import type { InterviewAgentState } from "../src/features/interview/agent/types";
import type {
  InterviewLLM,
  PhraseTurnInput,
  TurnPhrasing,
} from "../src/features/interview/agent/llm/provider";
import type { InterviewPlan, InterviewState } from "../src/features/interview/types";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ok    ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      console.log(`  FAIL  ${name}`);
      console.log(`        ${error instanceof Error ? error.message : String(error)}`);
    });
}

const plan: InterviewPlan = planCohortInterview("DAY_15");

/** A question that actually carries escalation rungs, so depth is meaningful. */
const escalatable = plan.questions.find(
  (q) => (q.deepProbes?.length ?? 0) > 0,
);
assert.ok(escalatable, "fixture drift: DAY_15 has no question with deep probes");

function stateOn(questionId: string, depthLevel: number): InterviewState {
  const index = plan.questions.findIndex((q) => q.id === questionId);
  return {
    ...startInterview(createInitialState()),
    currentQuestionIndex: index,
    depthLevel,
  };
}

function agentState(
  interviewState: InterviewState,
  overrides: Partial<InterviewAgentState> = {},
): InterviewAgentState {
  const q = plan.questions[interviewState.currentQuestionIndex]!;
  return {
    interviewId: "iv_fix",
    blueprint: "DAY_15",
    plan,
    interviewState,
    currentQuestionId: q.id,
    currentQuestionIndex: interviewState.currentQuestionIndex,
    // Deliberately the CORE text: that is what the buggy redirect used, so a
    // test that seeded the rung here could not detect the regression.
    currentQuestion: q.spokenText ?? q.text,
    candidateAnswer: "something off topic",
    transcript: interviewState.transcript,
    evidence: interviewState.evidenceByQuestionId,
    followUpCount: 0,
    maxFollowUps: 1,
    redirectCount: 0,
    repeatCount: 0,
    depthLevel: interviewState.depthLevel ?? 1,
    escalationsAsked: interviewState.escalationsAsked ?? 0,
    decision: null,
    lastDecision: null,
    nextPrompt: null,
    finished: false,
    status: "IN_PROGRESS",
    error: null,
    ...overrides,
  };
}

async function main() {
  console.log("\nConversational defect regressions\n");

  /* ------------------------------------------------------------ 1. CLARIFY */

  await check(
    "1a. natural clarification phrasings are never fast-pathed",
    () => {
      const phrases = [
        "What do you mean by retrieval quality?",
        "Sorry, what do you mean by grounding exactly?",
        "Can you clarify what you're asking?",
        "Could you rephrase that?",
        "I don't follow the question",
        "In what sense do you mean?",
      ];
      for (const p of phrases) {
        assert.equal(
          preClassifyInterruption(p),
          null,
          `"${p}" must reach the classifier, not a regex`,
        );
      }
    },
  );

  await check(
    "1b. REPEAT keeps its fast path (it needs no understanding)",
    () => {
      for (const p of [
        "Sorry, can you say that again?",
        "What was the question?",
        "I didn't catch that",
        "Pardon?",
      ]) {
        const r = preClassifyInterruption(p);
        assert.ok(r, `"${p}" should still be fast-pathed`);
        assert.equal(r.kind, "REPEAT");
      }
    },
  );

  await check(
    "1c. a clarification shape is recognised for the ANSWER guard",
    () => {
      assert.equal(
        looksLikeClarificationRequest("What do you mean by retrieval quality?"),
        true,
      );
      // An utterance carrying real content is an answer, not a request.
      assert.equal(
        looksLikeClarificationRequest(
          "What do you mean, I used Chroma because it was faster",
        ),
        false,
      );
    },
  );

  await check(
    "1d. a usable reply is spoken BEFORE the question, and never asks anything",
    () => {
      const reply = resolveInterruptionReply(
        "I mean whether the passage that came back was the right one.",
      );
      assert.ok(reply, "a plain declarative reply must be usable");
      const spoken = joinSpoken(reply, "How did you check that?");
      assert.ok(
        spoken.startsWith("I mean whether"),
        "the clarification is spoken first",
      );
      assert.ok(
        spoken.endsWith("How did you check that?"),
        "the question is re-put verbatim after it",
      );

      // A reply that asks its own question is refused: it would be an
      // unbudgeted extra question in front of the real one.
      assert.equal(
        resolveInterruptionReply("Do you mean the retrieval or the chunking?"),
        null,
      );
      // Empty and over-long replies are refused.
      assert.equal(resolveInterruptionReply(""), null);
      assert.equal(resolveInterruptionReply("x".repeat(500)), null);
    },
  );

  await check(
    "1e. when the classifier fails, the interviewer says so rather than miming",
    () => {
      assert.ok(
        !/let me clarify what i mean/i.test(CLARIFY_UNAVAILABLE_LINE),
        "the fallback must not promise an explanation it does not give",
      );
      assert.ok(
        CLARIFY_UNAVAILABLE_LINE.length > 0,
        "the fallback must still say something",
      );
    },
  );

  /* ---------------------------------------------------------- 2. ESCALATE */

  const phrasingCalls: PhraseTurnInput[] = [];
  const fakePhrasing: TurnPhrasing = {
    acknowledgement: "Right, you held the whole index in memory.",
    followUpQuestion: "a question stage 2 must not be allowed to inject here",
    bridge: "a bridge",
    move: "observe",
  };
  const llm: InterviewLLM = {
    name: "test:phrasing",
    async analyzeAnswer() {
      throw new Error("not used");
    },
    async phraseTurn(input) {
      phrasingCalls.push(input);
      return fakePhrasing;
    },
  };

  await check(
    "2a. ESCALATE now reaches stage 2 so it can acknowledge the answer",
    async () => {
      phrasingCalls.length = 0;
      const state = agentState(stateOn(escalatable.id, 1), {
        conversational: true,
        lastDecision: "ESCALATE",
        nextPrompt: "THE BANKED RUNG TEXT",
        decision: {
          action: "NEXT_QUESTION",
          reason: "strong",
          evidence: {
            conceptualFound: true,
            practicalFound: true,
            tradeoffsFound: true,
            flaggedIssues: [],
            reasoning: "strong",
            matchedEvidence: [0],
            relevance: "ON_TOPIC",
          },
          degraded: false,
        },
      });

      const update = await createPhraseTurn(llm)(state);
      assert.equal(phrasingCalls.length, 1, "stage 2 must run for ESCALATE");
      assert.equal(phrasingCalls[0]!.action, "ESCALATE");
      assert.equal(
        update.decision?.acknowledgement,
        fakePhrasing.acknowledgement,
        "the acknowledgement must reach the decision",
      );
    },
  );

  await check(
    "2b. ESCALATE keeps the BANKED rung — stage 2 cannot replace the question",
    async () => {
      phrasingCalls.length = 0;
      const state = agentState(stateOn(escalatable.id, 1), {
        conversational: true,
        lastDecision: "ESCALATE",
        nextPrompt: "THE BANKED RUNG TEXT",
        decision: {
          action: "NEXT_QUESTION",
          reason: "strong",
          evidence: {
            conceptualFound: true,
            practicalFound: true,
            tradeoffsFound: true,
            flaggedIssues: [],
            reasoning: "strong",
            matchedEvidence: [0],
            relevance: "ON_TOPIC",
          },
          degraded: false,
        },
      });

      const update = await createPhraseTurn(llm)(state);
      assert.equal(
        update.nextPrompt,
        "THE BANKED RUNG TEXT",
        "an escalation everyone receives differently would not be comparable",
      );
    },
  );

  await check(
    "2c. the cohort is untouched: no `conversational`, no stage-2 call",
    async () => {
      phrasingCalls.length = 0;
      const state = agentState(stateOn(escalatable.id, 1), {
        lastDecision: "ESCALATE",
        nextPrompt: "THE BANKED RUNG TEXT",
        decision: {
          action: "NEXT_QUESTION",
          reason: "strong",
          evidence: {
            conceptualFound: true,
            practicalFound: true,
            tradeoffsFound: false,
            flaggedIssues: [],
            reasoning: "strong",
            matchedEvidence: [],
            relevance: "ON_TOPIC",
          },
          degraded: false,
        },
      });
      const update = await createPhraseTurn(llm)(state);
      assert.equal(phrasingCalls.length, 0, "cohort must not call stage 2");
      assert.deepEqual(update, {}, "cohort turn must be untouched");
    },
  );

  /* ---------------------------------------------------------- 3. REDIRECT */

  await check(
    "3a. redirect at depth 1 restates the core question",
    () => {
      const state = agentState(stateOn(escalatable.id, 1));
      const update = applyRedirect(state);
      const core = escalatable.spokenText ?? escalatable.text;
      assert.ok(
        update.nextPrompt?.includes(core),
        "at depth 1 the core question IS the question on the floor",
      );
    },
  );

  await check(
    "3b. redirect at depth 2 restates the RUNG, not the core question",
    () => {
      const rung = escalatable.deepProbes![0]!;
      const rungText =
        typeof rung === "string" ? rung : (rung.text ?? String(rung));
      const state = agentState(stateOn(escalatable.id, 2));
      const update = applyRedirect(state);
      const prompt = update.nextPrompt ?? "";

      assert.ok(
        prompt.includes(rungText),
        `redirect must reference the escalated rung.\n  got: ${prompt.slice(0, 200)}`,
      );
      // The regression itself: falling back to the core question.
      const core = escalatable.spokenText ?? escalatable.text;
      assert.ok(
        !prompt.includes(core),
        "redirect must NOT fall back to the core question after an escalation",
      );
    },
  );

  /* ------------------------------------------------------------ 4. REPEAT */

  await check(
    "4a. repeat at depth 1 restates the core question",
    () => {
      const state = agentState(stateOn(escalatable.id, 1));
      const update = applyRepeat(state);
      const core = escalatable.spokenText ?? escalatable.text;
      assert.ok(
        update.nextPrompt?.includes(core),
        "at depth 1 the core question IS the question on the floor",
      );
    },
  );

  await check(
    "4b. repeat at depth 2 restates the RUNG, not the core question",
    () => {
      const rung = escalatable.deepProbes![0]!;
      const rungText =
        typeof rung === "string" ? rung : (rung.text ?? String(rung));
      const state = agentState(stateOn(escalatable.id, 2));
      const prompt = applyRepeat(state).nextPrompt ?? "";

      assert.ok(
        prompt.includes(rungText),
        "repeat must say the escalated rung again, got: " + prompt.slice(0, 200),
      );
      // The regression itself: falling back to the core question.
      const core = escalatable.spokenText ?? escalatable.text;
      assert.ok(
        !prompt.includes(core),
        "repeat must NOT fall back to the core question after an escalation",
      );
    },
  );

  await check(
    "4c. repeat keeps its authored prefix and re-puts the question last",
    () => {
      const rung = escalatable.deepProbes![0]!;
      const rungText =
        typeof rung === "string" ? rung : (rung.text ?? String(rung));
      const prompt =
        applyRepeat(agentState(stateOn(escalatable.id, 2))).nextPrompt ?? "";
      assert.ok(
        prompt.length > rungText.length,
        "a repeat is an acknowledging line plus the question, not the bare question",
      );
      assert.ok(
        prompt.trimEnd().endsWith(rungText.trim()),
        "the question is re-put last",
      );
    },
  );

  console.log(`\n${passed} checks passed, ${failed} failed.\n`);
  if (failed > 0) process.exitCode = 1;
}

void main();
