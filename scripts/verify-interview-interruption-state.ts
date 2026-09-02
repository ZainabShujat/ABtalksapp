/**
 * State-mutation checks for interruption handling and the replay/staleness guard.
 *
 * WHAT MAKES THIS DIFFERENT FROM `verify-interview-barge-in.ts`. That suite
 * tests the pure rules — the duplex detector, the regex pre-classifier, the
 * `advancesInterview` table. It proves the RULES are right. It does not prove
 * the SERVICE applies them, and the thing that actually costs a candidate a
 * question is the service advancing state it should not have advanced.
 *
 * So this suite drives the REAL `platform/service.ts:recordInterruption` and
 * asserts what it did to the persisted `InterviewState`: the question index,
 * the evidence map, and the replay high-water mark. A test that only checked
 * the returned envelope would pass against a service that advanced the
 * interview and then reported the old question back.
 *
 * WHAT IS SUBSTITUTED, AND WHY THAT IS LEGITIMATE. Only the persistence layer
 * and the model. `repository.ts` is swapped for an in-memory store so the suite
 * needs no database — and this project's `.env` points at production, so a test
 * that wrote to the real repository would be writing to production. The
 * classifier is a fixed provider so a given utterance yields a given kind
 * deterministically. Everything being tested — the guard, the routing, the
 * state transitions, `advanceTurn` — is the real code.
 *
 * Run: npx tsx --conditions=react-server scripts/verify-interview-interruption-state.ts
 */
import assert from "node:assert/strict";
import Module from "node:module";

import { buildPlatformPlan } from "../src/features/interview/platform/planner";
import { getDomain } from "../src/features/interview/platform/domains";
import { createInitialState, startInterview } from "../src/features/interview/state";
import { MAX_ESCALATIONS_PER_QUESTION } from "../src/features/interview/constants";
import type { InterviewPlan, InterviewState } from "../src/features/interview/types";
import type { InterruptionKind } from "../src/features/interview/interruption";

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

/* ------------------------------------------------------------ the fixture */

/**
 * A real plan from a real published domain.
 *
 * Deliberately not a hand-written stub: the whole point of asserting on
 * `currentQuestionIndex` is that the plan behind it is the one production uses,
 * with real question ids, real budgets and a real rubric snapshot.
 */
const DOMAIN_SLUG = "ai-fluency";
const domain = getDomain(DOMAIN_SLUG);
assert.ok(domain, `fixture drift: domain "${DOMAIN_SLUG}" is not registered`);
const plan: InterviewPlan = buildPlatformPlan(domain, {
  candidateFirstName: "Test",
  profileContext: null,
});
assert.ok(
  plan.questions.length >= 2,
  "fixture drift: need at least two questions to prove an advance",
);

function freshState(): InterviewState {
  return startInterview(createInitialState());
}

/* -------------------------------------------------- in-memory persistence */

/**
 * The store the service writes to for the duration of this suite.
 *
 * `saveTurn` records every write so a test can assert not only the final state
 * but HOW MANY times the interview was written to — which is what distinguishes
 * "the replay was refused" from "the replay was applied and happened to be
 * idempotent".
 */
type Store = {
  state: InterviewState;
  saves: InterviewState[];
  turnIndex: number;
};

const store: Store = { state: freshState(), saves: [], turnIndex: 0 };

function resetStore(state: InterviewState = freshState()) {
  store.state = state;
  store.saves = [];
  store.turnIndex = 0;
}

/**
 * Replaces the repository and the model registry BEFORE the service is loaded.
 *
 * `Module.prototype.require` is patched rather than the module objects being
 * mutated after the fact, because the service captures its imports at load
 * time: mutating them afterwards would leave the already-bound references
 * pointing at the real database.
 */
const realRequire = Module.prototype.require;

let nextClassification: {
  kind: InterruptionKind;
  reason: string;
  subject: string;
  reply: string;
  confidence: number;
} = {
  kind: "REPEAT",
  reason: "test",
  subject: "",
  reply: "",
  confidence: 1,
};

const fakeRepository = {
  async loadActiveAttempt(attemptId: string, userId: string) {
    if (attemptId !== "att_test" || userId !== "user_test") return null;
    return {
      id: "att_test",
      userId: "user_test",
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
  async saveTurn(
    _attemptId: string,
    _userId: string,
    state: InterviewState,
  ) {
    store.state = state;
    store.saves.push(state);
  },
};

const fakeRegistry = {
  resolveInterviewLLM() {
    return {
      name: "test:fixed",
      async analyzeAnswer() {
        return {
          action: "NEXT_QUESTION" as const,
          reason: "test",
          evidence: {
            conceptualFound: true,
            practicalFound: true,
            tradeoffsFound: false,
            flaggedIssues: [],
            reasoning: "test",
            matchedEvidence: [0],
            relevance: "ON_TOPIC" as const,
          },
          degraded: false,
        };
      },
      async classifyInterruption() {
        return nextClassification;
      },
    };
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Module.prototype as any).require = function patched(this: unknown, id: string) {
  // `server-only` throws outside a React Server Component. Under
  // `--conditions=react-server` it resolves harmlessly, but that condition also
  // hands back the server React build, which has no `createContext` and so
  // explodes when Next's navigation module loads. Neutralising the guard here
  // is what lets the suite run as a plain Node script.
  if (id === "server-only") return {};
  if (id.endsWith("platform/repository") || id.endsWith("repository")) {
    const real = realRequire.call(this as never, id) as Record<string, unknown>;
    return { ...real, ...fakeRepository };
  }
  if (id.endsWith("llm/registry") || id.endsWith("registry")) {
    const real = realRequire.call(this as never, id) as Record<string, unknown>;
    return { ...real, ...fakeRegistry };
  }
  return realRequire.call(this as never, id);
};

// Loaded AFTER the patch, so it binds the fakes.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const service = require("../src/features/interview/platform/service") as typeof import("../src/features/interview/platform/service");

(Module.prototype as never as { require: unknown }).require = realRequire;

/* -------------------------------------------------------------- the tests */

const USER = "user_test";
const ATTEMPT = "att_test";

async function main() {
  console.log("\nInterruption state mutation and replay protection\n");

  /* 1. a valid, current generation is accepted and mutates state */
  await check(
    "1. a fresh generation is accepted and records the interruption",
    async () => {
      resetStore();
      nextClassification = {
        kind: "REPEAT",
        reason: "asked to hear it again",
        subject: "",
        reply: "",
        confidence: 1,
      };

      const before = store.state;
      const res = await service.recordInterruption(
        USER,
        ATTEMPT,
        "sorry, can you say that again?",
        "How did you decide what went into",
        30,
        7,
      );

      assert.equal(res.ok, true, "a fresh interruption should be accepted");
      assert.equal(store.saves.length, 1, "exactly one write should have happened");
      assert.equal(
        store.state.lastInterruptionGeneration,
        7,
        "the accepted generation must be stamped onto the persisted state",
      );
      assert.ok(
        store.state.transcript.length > before.transcript.length,
        "the utterance and the reply must reach the transcript",
      );
    },
  );

  /* 2. a stale generation changes nothing at all */
  await check(
    "2. a stale generation is refused and mutates NOTHING",
    async () => {
      resetStore({ ...freshState(), lastInterruptionGeneration: 12 });
      const before = store.state;

      const res = await service.recordInterruption(
        USER,
        ATTEMPT,
        "sorry, say that again?",
        "",
        0,
        5, // older than 12
      );

      assert.equal(res.ok, true, "refusal is a no-op turn, not an error");
      assert.equal(store.saves.length, 0, "a stale submission must not write at all");
      assert.equal(
        store.state.transcript.length,
        before.transcript.length,
        "a stale submission must not touch the transcript",
      );
      assert.equal(
        store.state.lastInterruptionGeneration,
        12,
        "the high-water mark must not move backwards",
      );
      assert.equal(
        store.state.currentQuestionIndex,
        before.currentQuestionIndex,
        "a stale submission must not advance the interview",
      );
    },
  );

  /* 3. replay of the SAME generation cannot apply twice */
  await check(
    "3. replaying the same generation is refused the second time",
    async () => {
      resetStore();
      nextClassification = {
        kind: "CLARIFY",
        reason: "asked what a term meant",
        subject: "retrieval quality",
        reply: "I mean whether the right passage came back.",
        confidence: 1,
      };

      const first = await service.recordInterruption(
        USER, ATTEMPT, "what do you mean by retrieval quality?", "", 0, 3,
      );
      assert.equal(first.ok, true);
      assert.equal(store.saves.length, 1, "first delivery writes once");
      const afterFirst = store.state;

      const replay = await service.recordInterruption(
        USER, ATTEMPT, "what do you mean by retrieval quality?", "", 0, 3,
      );

      assert.equal(replay.ok, true, "a replay is refused as a no-op, not an error");
      assert.equal(
        store.saves.length,
        1,
        "the replay must not produce a second write",
      );
      assert.equal(
        store.state.transcript.length,
        afterFirst.transcript.length,
        "the replay must not append the utterance a second time",
      );
    },
  );

  /* 4. every non-ANSWER kind leaves the question and evidence untouched */
  for (const kind of [
    "REPEAT",
    "CLARIFY",
    "CORRECT",
    "ADD_INFORMATION",
    "OTHER",
  ] as InterruptionKind[]) {
    await check(
      `4. ${kind} does not advance currentQuestionIndex and records no evidence`,
      async () => {
        resetStore();
        nextClassification = {
          kind,
          reason: "test",
          subject: "",
          reply: "Understood.",
          confidence: 1,
        };
        const beforeIndex = store.state.currentQuestionIndex;
        const beforeEvidence = Object.keys(store.state.evidenceByQuestionId).length;

        const res = await service.recordInterruption(
          USER, ATTEMPT, "some interrupting utterance", "", 0, 1,
        );

        assert.equal(res.ok, true);
        assert.equal(
          store.state.currentQuestionIndex,
          beforeIndex,
          `${kind} must leave the question on the floor`,
        );
        assert.equal(
          Object.keys(store.state.evidenceByQuestionId).length,
          beforeEvidence,
          `${kind} must record no evidence`,
        );
      },
    );
  }

  /* 5. ANSWER advances exactly once, and its replay does not advance again */
  await check(
    "5. ANSWER advances the interview exactly once",
    async () => {
      // Escalations deliberately exhausted.
      //
      // The first attempt at this test used a fresh state and a strong answer,
      // and it failed - correctly. A strong answer that clears the bar earns a
      // HARDER RUNG on the same question (`applied: ESCALATE`), which is the
      // depth ladder working as designed and is not an advance. Asserting
      // "ANSWER advances" against that fixture would have been asserting that
      // the ladder is broken.
      //
      // So the fixture removes the alternative: with the escalation budget
      // spent, a cleared question has nowhere to go but forward, and the
      // assertion below is about the interruption path rather than about which
      // move the policy happened to prefer.
      resetStore({
        ...freshState(),
        escalationsAsked: MAX_ESCALATIONS_PER_QUESTION,
      });
      nextClassification = {
        kind: "ANSWER",
        reason: "started answering early",
        subject: "",
        reply: "",
        confidence: 1,
      };
      const beforeIndex = store.state.currentQuestionIndex;
      const beforeEvidence = Object.keys(store.state.evidenceByQuestionId).length;

      const first = await service.recordInterruption(
        USER,
        ATTEMPT,
        "I used Chroma because the index fit in memory and setup was one command.",
        "",
        0,
        4,
      );
      assert.equal(first.ok, true, "an early answer should be accepted");
      const afterIndex = store.state.currentQuestionIndex;

      // NOT `beforeIndex + 1`.
      //
      // The first version of this assertion said exactly that and failed with
      // 3 !== 1 - again correctly. The mock platform selects its next target
      // ADAPTIVELY (`selectNextPlatformTarget`), so the index is a pointer into
      // the plan and legitimately jumps; only the cohort walks it sequentially.
      // "Advanced by one" was an assumption about the planner, not a property
      // of the interruption path.
      //
      // What must be true is that the interview moved on from the question that
      // was answered, and banked exactly one question's worth of evidence for
      // it. That holds whichever target the planner picks.
      assert.notEqual(
        afterIndex,
        beforeIndex,
        "an ANSWER interruption must move the interview off the answered question",
      );
      assert.equal(
        Object.keys(store.state.evidenceByQuestionId).length,
        beforeEvidence + 1,
        "an ANSWER interruption must bank evidence for exactly one question",
      );
      assert.equal(
        store.state.lastInterruptionGeneration,
        4,
        "an advancing interruption must stamp its generation in the same write",
      );

      const replay = await service.recordInterruption(
        USER,
        ATTEMPT,
        "I used Chroma because the index fit in memory and setup was one command.",
        "",
        0,
        4,
      );
      assert.equal(replay.ok, true, "the replay is refused as a no-op");
      assert.equal(
        store.state.currentQuestionIndex,
        afterIndex,
        "replaying an ANSWER must NOT advance the interview a second time",
      );
      assert.equal(
        Object.keys(store.state.evidenceByQuestionId).length,
        beforeEvidence + 1,
        "replaying an ANSWER must NOT bank a second question's evidence",
      );
    },
  );

  console.log(
    `\n${passed} checks passed, ${failed} failed.\n`,
  );
  if (failed > 0) process.exitCode = 1;
}

void main();
