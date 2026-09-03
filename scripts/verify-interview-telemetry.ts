/**
 * Verifies that a normal platform turn emits the spans we claim to measure.
 *
 * WHY THIS EXISTS. The telemetry module declared twelve `SpanName`s and only
 * three were ever emitted, so latency reports were silently missing the two
 * legs that dominate a turn and every cost report read `$0.0000`. Nothing
 * failed — the numbers were simply absent, which is the hardest kind of
 * instrumentation bug to notice. This suite makes the absence loud.
 *
 * It drives the REAL `recordAnswer` with an in-memory repository and a scripted
 * model, so it asserts what the production code path actually emits rather than
 * what a mock was told to emit. No network, no database, no provider spend.
 *
 * Run: npx tsx scripts/verify-interview-telemetry.ts
 */
import assert from "node:assert/strict";
import Module from "node:module";

import { buildPlatformPlan } from "../src/features/interview/platform/planner";
import { getDomain } from "../src/features/interview/platform/domains";
import { createInitialState, startInterview } from "../src/features/interview/state";
import { MAX_ESCALATIONS_PER_QUESTION } from "../src/features/interview/constants";
import type { InterviewPlan, InterviewState } from "../src/features/interview/types";
import type { SpanName } from "../src/features/interview/telemetry";

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

const DOMAIN_SLUG = "ai-fluency";
const domain = getDomain(DOMAIN_SLUG);
assert.ok(domain, `fixture drift: "${DOMAIN_SLUG}" is not registered`);
const plan: InterviewPlan = buildPlatformPlan(domain, {
  candidateFirstName: "Test",
  profileContext: null,
});

/**
 * Escalation budget deliberately spent before the turn starts.
 *
 * The planner runs only when a question is FINISHED. A strong answer on a
 * question that still has rungs left earns an escalation instead, which keeps
 * the same question on the floor and never reaches target selection — so the
 * first version of this suite reported a missing `planner` span for a turn that
 * correctly never planned anything. Exhausting the budget makes advancing the
 * only available move, which is what the span is there to measure.
 */
const store = {
  state: {
    ...startInterview(createInitialState()),
    escalationsAsked: MAX_ESCALATIONS_PER_QUESTION,
  } as InterviewState,
  turnIndex: 0,
};

const realRequire = Module.prototype.require;

/** Token counts the scripted provider reports, so cost can be asserted. */
const FAKE_USAGE = { promptTokens: 2000, completionTokens: 200, cachedPromptTokens: 1000 };

const fakeRepository = {
  async loadActiveAttempt(attemptId: string, userId: string) {
    if (attemptId !== "att_tel" || userId !== "user_tel") return null;
    return {
      id: "att_tel",
      userId: "user_tel",
      domainSlug: DOMAIN_SLUG,
      packId: plan.contextSummary.kind === "PLATFORM" ? plan.contextSummary.packId : "p",
      packVersion: 1,
      attemptNumber: 1,
      plan,
      state: store.state,
      startedAt: new Date(),
      capabilities: [],
    };
  },
  async nextTurnIndex() {
    return store.turnIndex++;
  },
  async saveTurn(_a: string, _u: string, state: InterviewState) {
    store.state = state;
  },
};

/**
 * A provider built on the REAL `createJsonInterviewLLM`.
 *
 * That matters: the evaluator and phrasing spans are emitted by the shared
 * provider, so a hand-written fake `InterviewLLM` would bypass exactly the code
 * under test and the suite would prove nothing.
 */
function buildScriptedLlm() {
  const { createJsonInterviewLLM } =
    realRequire.call(
      module as never,
      "../src/features/interview/agent/llm/json-provider",
    ) as typeof import("../src/features/interview/agent/llm/json-provider");

  return createJsonInterviewLLM({
    name: "openai:gpt-4o",
    async askJson({ system }) {
      const phrasing = system.includes("Your only job now is to say it out loud");
      return {
        ok: true as const,
        usage: FAKE_USAGE,
        data: phrasing
          ? {
              acknowledgement: "Right, you mentioned the memory ceiling.",
              followUpQuestion: "",
              bridge: "",
              move: "observe",
            }
          : {
              action: "NEXT_QUESTION",
              reason: "covered",
              evidence: {
                conceptualFound: true,
                practicalFound: true,
                tradeoffsFound: false,
                flaggedIssues: [],
                reasoning: "covered",
                matchedEvidence: [1],
                relevance: "ON_TOPIC",
              },
              followUpReason: null,
              targetDetail: "",
              followUpQuestion: "",
              acknowledgement: "",
              clarification: "",
              simplified: "",
              bridge: "",
              confidence: 0.9,
            },
      };
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Module.prototype as any).require = function patched(this: unknown, id: string) {
  if (id === "server-only") return {};
  if (id.endsWith("platform/repository") || id.endsWith("repository")) {
    const real = realRequire.call(this as never, id) as Record<string, unknown>;
    return { ...real, ...fakeRepository };
  }
  if (id.endsWith("llm/registry") || id.endsWith("registry")) {
    const real = realRequire.call(this as never, id) as Record<string, unknown>;
    return { ...real, resolveInterviewLLM: () => buildScriptedLlm() };
  }
  return realRequire.call(this as never, id);
};

/* eslint-disable @typescript-eslint/no-var-requires */
const service =
  require("../src/features/interview/platform/service") as typeof import("../src/features/interview/platform/service");
const telemetry =
  require("../src/features/interview/telemetry") as typeof import("../src/features/interview/telemetry");

(Module.prototype as never as { require: unknown }).require = realRequire;

const ATTEMPT = "att_tel";
const USER = "user_tel";

async function main() {
  console.log("\nPer-stage telemetry\n");

  telemetry.clearSpans(ATTEMPT);
  const first = plan.questions[0]!;
  const turn = await service.recordAnswer(USER, ATTEMPT, first.id, {
    text: "I understand it predicts the next token rather than looking things up.",
  });
  assert.ok(turn.ok, "the scripted turn should succeed");

  const spans = telemetry.readSpans(ATTEMPT);
  const names = new Set(spans.map((s) => s.name));

  await check("a normal turn emits the assessment span", () => {
    assert.ok(names.has("evaluator"), `missing evaluator. got: ${[...names]}`);
  });

  await check("a normal turn emits the phrasing span", () => {
    assert.ok(names.has("phrasing"), `missing phrasing. got: ${[...names]}`);
  });

  await check("a normal turn emits the planner span", () => {
    assert.ok(names.has("planner"), `missing planner. got: ${[...names]}`);
  });

  await check("a normal turn emits both database spans", () => {
    assert.ok(names.has("db_load"), `missing db_load. got: ${[...names]}`);
    assert.ok(names.has("db_save"), `missing db_save. got: ${[...names]}`);
  });

  await check("a normal turn emits the whole-turn span", () => {
    assert.ok(names.has("turn_server"), `missing turn_server. got: ${[...names]}`);
  });

  await check("every span carries a non-negative duration", () => {
    for (const s of spans) {
      assert.ok(
        Number.isFinite(s.ms) && s.ms >= 0,
        `span ${s.name} has a bad duration: ${s.ms}`,
      );
    }
  });

  await check("model-call spans carry tokens and a real cost", () => {
    for (const name of ["evaluator", "phrasing"] as SpanName[]) {
      const span = spans.find((s) => s.name === name);
      assert.ok(span, `no ${name} span`);
      assert.equal(span.model, "gpt-4o", `${name} must record the bare model id`);
      assert.equal(span.promptTokens, FAKE_USAGE.promptTokens);
      assert.equal(span.completionTokens, FAKE_USAGE.completionTokens);
      assert.ok(
        (span.costUsd ?? 0) > 0,
        `${name} must cost more than zero: the $0.0000 report was the bug`,
      );
    }
  });

  await check("the cached half of the prompt is billed at the cached rate", () => {
    const span = spans.find((s) => s.name === "evaluator")!;
    const uncached = telemetry.llmCostUsd("gpt-4o", 2000, 200, 0);
    assert.ok(
      (span.costUsd ?? 0) < uncached,
      "prompt caching must reduce the recorded cost",
    );
  });

  await check("the turn total is at least as long as its parts", () => {
    const total = spans.find((s) => s.name === "turn_server")!.ms;
    const evaluator = spans.find((s) => s.name === "evaluator")!.ms;
    assert.ok(
      total >= evaluator,
      `turn_server (${total}ms) cannot be shorter than evaluator (${evaluator}ms)`,
    );
  });

  await check("no span carries candidate text", () => {
    // The one rule that matters for privacy: spans are numbers and identifiers.
    const serialized = JSON.stringify(spans);
    assert.ok(
      !serialized.includes("predicts the next token"),
      "a span leaked the candidate's answer",
    );
    assert.ok(
      !serialized.includes(first.text.slice(0, 30)),
      "a span leaked the question text",
    );
  });

  await check("the summary reports a non-zero cost for the turn", () => {
    const summary = telemetry.summarize(ATTEMPT);
    assert.ok(
      summary.totalCostUsd > 0,
      "summarize() must report real spend, not $0.0000",
    );
    assert.ok(summary.llmCalls >= 2, "both model calls should be counted");
  });

  console.log(`\n${passed} checks passed, ${failed} failed.\n`);
  if (failed > 0) process.exitCode = 1;
}

void main();
