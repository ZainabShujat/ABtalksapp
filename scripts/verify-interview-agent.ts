/**
 * Behavioural checks for the LangGraph interview agent.
 *
 * Every test drives the REAL compiled graph over the REAL Day 15 question bank.
 * Only the model is substituted — either a fixed-decision provider (to test the
 * routing policy in isolation) or the mock provider (to test classification and
 * policy together). Nothing here touches the network or the database.
 *
 * Run: npx tsx scripts/verify-interview-agent.ts
 */
import assert from "node:assert/strict";

import { planCohortInterview } from "../src/features/interview/cohort/planner";
import {
  MAX_REDIRECTS_PER_QUESTION,
  MAX_REPEATS_PER_QUESTION,
} from "../src/features/interview/constants";
import { createInitialState, startInterview } from "../src/features/interview/state";
import type {
  AnswerEvidence,
  InterviewPlan,
  InterviewState,
} from "../src/features/interview/types";
import {
  createJsonInterviewLLM,
  createMockInterviewLLM,
  REDIRECT_LINE,
  closingLineFor,
  repeatLineFor,
  runInterviewTurn,
} from "../src/features/interview/agent";
import type {
  InterviewDecision,
  InterviewLLM,
} from "../src/features/interview/agent";

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

/* ------------------------------------------------------------- fixtures */

const plan: InterviewPlan = planCohortInterview("DAY_15");

/** Index 0 of the DAY_15 bank is the opener, deliberately maxFollowUps: 0. */
const OPENER = plan.questions[0]!;
/** Index 1 carries a budget of one follow-up. */
const PROBEABLE = plan.questions[1]!;

assert.equal(OPENER.maxFollowUps, 0, "fixture drift: opener should allow no probes");
assert.equal(PROBEABLE.maxFollowUps, 1, "fixture drift: q2 should allow one probe");

function stateAt(index: number): InterviewState {
  return {
    ...startInterview(createInitialState()),
    currentQuestionIndex: index,
  };
}

/**
 * A state whose escalation budget is already spent, so a STRONG answer moves to
 * the next question instead of going deeper.
 *
 * Needed by every test written before the depth ladder existed: those tests
 * assert the hand-off between questions, which a cleared bar now delays by one
 * escalation. Adaptive behaviour itself is covered in verify-interview-adaptive.ts.
 */
function depthSpent(index: number): InterviewState {
  return { ...stateAt(index), escalationsAsked: 2 };
}

function evidence(over: Partial<AnswerEvidence> = {}): AnswerEvidence {
  return {
    conceptualFound: false,
    practicalFound: false,
    tradeoffsFound: false,
    flaggedIssues: [],
    reasoning: "test",
    ...over,
  };
}

/** A provider that always proposes the same thing. Isolates the policy. */
function fixedLLM(decision: Partial<InterviewDecision>): InterviewLLM {
  return {
    name: "fixed",
    async analyzeAnswer() {
      return {
        action: "NEXT_QUESTION",
        reason: "fixed",
        evidence: evidence(),
        followUpQuestion: null,
        confidence: 1,
        degraded: false,
        ...decision,
      } as InterviewDecision;
    },
  };
}

async function turn(
  llm: InterviewLLM,
  state: InterviewState,
  questionId: string,
  answerText: string,
) {
  const result = await runInterviewTurn(llm, {
    interviewId: "iv_test",
    blueprint: "DAY_15",
    plan,
    state,
    questionId,
    answerText,
  });
  assert.ok(result.ok, `turn failed: ${result.ok ? "" : result.message}`);
  return result.data;
}

/* ---------------------------------------------------------------- tests */

async function main() {
  console.log("\nLangGraph interview agent\n");

  await check("1. strong answer advances when nothing deeper is left to ask", async () => {
    // Depth is exhausted, so a cleared bar has nowhere to go but forward. The
    // escalation case is covered in verify-interview-adaptive.ts.
    const llm = fixedLLM({
      action: "NEXT_QUESTION",
      evidence: evidence({ conceptualFound: true, practicalFound: true }),
    });
    const out = await turn(
      llm,
      depthSpent(0),
      OPENER.id,
      "I ran it locally with Ollama first because there is no API cost and the coverage data never leaves my machine. I pulled llama3 and had to check my RAM before choosing the model size.",
    );

    assert.equal(out.action, "NEXT_QUESTION");

    // UPDATED FOR THE CONVERSATION PLANNER. This used to assert
    // `plan.questions[1].id` — the next entry in the array. That assertion
    // encoded the behaviour the planner replaces: the answer above is about
    // running a model locally with Ollama, and the interview now follows that
    // rather than walking to whatever was authored next. The contract asserted
    // here is the new one, and it is stricter in the ways that matter: a real,
    // unasked, in-scope target, actually put to the candidate.
    const chosen = plan.questions.find((q) => q.id === out.questionId);
    assert.ok(chosen, "the chosen target is a real question in the plan");
    assert.notEqual(chosen.id, OPENER.id, "never re-asks the question just answered");
    assert.ok(out.prompt?.endsWith(chosen.spokenText ?? chosen.text));
    assert.ok(
      (out.prompt?.length ?? 0) > (chosen.spokenText ?? chosen.text).length,
      "an acknowledgement precedes the question",
    );
    assert.equal(
      out.state.currentQuestionIndex,
      plan.questions.findIndex((q) => q.id === chosen.id),
      "the index points at the selected target, not at a cursor",
    );
    assert.ok(
      (out.state.askedQuestionIds ?? []).includes(chosen.id),
      "the selected target is recorded as asked",
    );
    assert.equal(out.state.followUpsAsked, 0);
    assert.ok(out.state.evidenceByQuestionId[OPENER.id]?.conceptualFound);
    assert.equal(out.finished, false);
  });

  await check("2. incomplete answer earns one follow-up", async () => {
    const llm = fixedLLM({
      action: "FOLLOW_UP",
      followUpQuestion: "Which part of that did you build yourself?",
      evidence: evidence({ conceptualFound: true }),
    });
    const out = await turn(llm, stateAt(1), PROBEABLE.id, "It stores the conversation so the bot remembers.");

    assert.equal(out.action, "FOLLOW_UP");
    assert.equal(out.prompt, "Which part of that did you build yourself?");
    // The question stays on the floor and the index does not move.
    assert.equal(out.questionId, PROBEABLE.id);
    assert.equal(out.state.currentQuestionIndex, 1);
    assert.equal(out.state.followUpsAsked, 1);
  });

  await check("3. off-topic question is redirected, not answered", async () => {
    // Real mock provider: it must CLASSIFY this as off-topic on its own.
    const out = await turn(
      createMockInterviewLLM(),
      stateAt(1),
      PROBEABLE.id,
      "Who is the PM of India?",
    );

    // The FIRST off-topic turn restates the question rather than accusing the
    // candidate of dodging it. The trivia is still never answered.
    assert.equal(out.action, "REPEAT");
    assert.ok(out.prompt?.includes(PROBEABLE.text), "must restate the open question");
    assert.ok(!/modi|prime minister of india is/i.test(out.prompt ?? ""), "must not answer the trivia");
    // No evidence recorded, no budget spent, question unchanged.
    assert.equal(out.state.evidenceByQuestionId[PROBEABLE.id], undefined);
    assert.equal(out.state.followUpsAsked, 0);
    assert.equal(out.state.currentQuestionIndex, 1);
  });

  await check("4. a persistent off-topic candidate keeps getting redirected", async () => {
    const llm = createMockInterviewLLM();
    let state = stateAt(1);

    // First off-topic turn: restated, not redirected.
    const opening = await turn(llm, state, PROBEABLE.id, "Who is the PM of India?");
    assert.equal(opening.action, "REPEAT");
    state = opening.state;

    for (let i = 1; i <= MAX_REDIRECTS_PER_QUESTION; i++) {
      const out = await turn(llm, state, PROBEABLE.id, "Who is the PM of India?");
      assert.equal(out.action, "REDIRECT", `redirect ${i} should still redirect`);
      assert.equal(out.state.redirectsAsked, i);
      assert.equal(out.state.currentQuestionIndex, 1);
      state = out.state;
    }

    // Only after the cap does the interview move on — it never gives in and answers.
    const capped = await turn(llm, state, PROBEABLE.id, "Who is the PM of India?");
    assert.equal(capped.action, "NEXT_QUESTION");
    assert.equal(capped.state.currentQuestionIndex, 2);
  });

  await check("5a. follow-up on a zero-budget question is downgraded", async () => {
    const llm = fixedLLM({
      action: "FOLLOW_UP",
      followUpQuestion: "Say more about that.",
      evidence: evidence({ conceptualFound: true }),
    });
    const out = await turn(llm, stateAt(0), OPENER.id, "Because it is free and private.");

    assert.equal(out.action, "NEXT_QUESTION", "maxFollowUps: 0 means never probe");
    assert.equal(out.state.currentQuestionIndex, 1);
  });

  await check("5b. follow-up limit reached moves to the next question", async () => {
    const llm = fixedLLM({
      action: "FOLLOW_UP",
      followUpQuestion: "Which part did you build?",
      evidence: evidence({ conceptualFound: true }),
    });

    const first = await turn(llm, stateAt(1), PROBEABLE.id, "It stores the conversation.");
    assert.equal(first.action, "FOLLOW_UP");
    assert.equal(first.state.followUpsAsked, 1);

    // Same proposal, budget now exhausted.
    const second = await turn(llm, first.state, PROBEABLE.id, "It just keeps the history.");
    assert.equal(second.action, "NEXT_QUESTION");
    assert.equal(second.state.currentQuestionIndex, 2);
    assert.equal(second.state.followUpsAsked, 0, "budget resets on the new question");
  });

  await check("5c. an LLM inventing unlimited follow-ups cannot extend the interview", async () => {
    const llm = fixedLLM({
      action: "FOLLOW_UP",
      followUpQuestion: "And?",
      evidence: evidence({ conceptualFound: true }),
    });
    let state = stateAt(1);
    let followUps = 0;

    for (let i = 0; i < 6; i++) {
      const q = plan.questions[state.currentQuestionIndex];
      if (!q) break;
      const out = await turn(llm, state, q.id, "Some partial answer about memory.");
      if (out.action === "FOLLOW_UP") followUps++;
      state = out.state;
    }

    assert.ok(followUps <= 6, "sanity");
    assert.ok(
      state.currentQuestionIndex > 1,
      "the interview must still make forward progress",
    );
  });

  await check("6. malformed model output validates, retries, then falls back safely", async () => {
    let calls = 0;
    const llm = createJsonInterviewLLM({
      name: "broken",
      async askJson() {
        calls++;
        // Valid JSON, wrong shape — the exact failure a schema exists to catch.
        return { ok: true, data: { verdict: "he seems fine", nextThing: "ask more" } };
      },
    });

    const out = await turn(llm, stateAt(1), PROBEABLE.id, "We used a buffer to keep the last few messages.");

    assert.equal(calls, 2, "one initial attempt plus one strict-JSON retry");
    assert.equal(out.degraded, true, "the turn is flagged as degraded");
    assert.ok(
      ["NEXT_QUESTION", "FOLLOW_UP"].includes(out.action),
      "fallback must still produce a legal action",
    );
    assert.ok(out.prompt && out.prompt.length > 0, "the interview keeps talking");
    assert.notEqual(out.state.status, "INVALID");
  });

  await check("6b. a provider that throws does not crash the turn", async () => {
    const llm = createJsonInterviewLLM({
      name: "throwing",
      askJson() {
        throw new Error("connection reset");
      },
    });
    const out = await turn(llm, stateAt(1), PROBEABLE.id, "We stored the last few messages in a buffer.");
    assert.equal(out.degraded, true);
    assert.ok(out.prompt && out.prompt.length > 0);
  });

  await check("7. state stays correct across answer → follow-up → answer → next", async () => {
    const probing = fixedLLM({
      action: "FOLLOW_UP",
      followUpQuestion: "Which part of that did you implement yourself?",
      evidence: evidence({ conceptualFound: true }),
    });
    const satisfied = fixedLLM({
      action: "NEXT_QUESTION",
      evidence: evidence({ practicalFound: true }),
    });

    const t1 = await turn(probing, stateAt(1), PROBEABLE.id, "Memory keeps the conversation going.");
    assert.equal(t1.action, "FOLLOW_UP");
    assert.equal(t1.state.followUpsAsked, 1);
    assert.equal(t1.state.currentQuestionIndex, 1);

    const t2 = await turn(satisfied, t1.state, PROBEABLE.id, "I wrote the buffer myself in memory.py and trimmed it to the last six turns.");
    assert.equal(t2.action, "NEXT_QUESTION");
    assert.equal(t2.state.currentQuestionIndex, 2);
    assert.equal(t2.state.followUpsAsked, 0);

    // Evidence from both turns of the question survives, merged not overwritten.
    const merged = t2.state.evidenceByQuestionId[PROBEABLE.id];
    assert.ok(merged, "evidence recorded for the probed question");
    assert.equal(merged.conceptualFound, true, "credit from turn 1 survives");
    assert.equal(merged.practicalFound, true, "credit from turn 2 added");

    // The transcript is a faithful record of all four lines plus the new question.
    const texts = t2.state.transcript.map((l) => `${l.role}:${l.text}`);
    assert.equal(texts.filter((t) => t.startsWith("candidate:")).length, 2);
    assert.ok(
      texts.some((t) => t.includes("Which part of that did you implement yourself?")),
      "the follow-up is in the transcript",
    );
    assert.ok(
      texts.some((t) => t.includes(plan.questions[2]!.text)),
      "the next question is in the transcript",
    );
  });

  await check("8. a repeat request replays the question without spending budget", async () => {
    const llm = createMockInterviewLLM();
    const out = await turn(llm, stateAt(1), PROBEABLE.id, "Sorry, could you repeat the question?");

    assert.equal(out.action, "REPEAT");
    // Repeat wording varies per interview, so this checks the invariant: the
    // repeat line for THIS interview opens the turn, and the banked question
    // follows it verbatim.
    assert.ok(out.prompt?.startsWith(repeatLineFor("iv_test")));
    assert.ok(out.prompt?.includes(PROBEABLE.text));
    assert.equal(out.state.followUpsAsked, 0);
    assert.equal(out.state.repeatsAsked, 1);
    assert.equal(out.state.evidenceByQuestionId[PROBEABLE.id], undefined);

    // Repeats are capped so they cannot become a way to stall indefinitely.
    let state = out.state;
    for (let i = 1; i < MAX_REPEATS_PER_QUESTION; i++) {
      state = (await turn(llm, state, PROBEABLE.id, "Could you repeat that?")).state;
    }
    const capped = await turn(llm, state, PROBEABLE.id, "Could you repeat that?");
    assert.equal(capped.action, "NEXT_QUESTION");
  });

  await check("9. an answer for the wrong question is refused", async () => {
    const result = await runInterviewTurn(fixedLLM({}), {
      interviewId: "iv_test",
      blueprint: "DAY_15",
      plan,
      state: stateAt(1),
      questionId: OPENER.id, // stale client: the server has moved on
      answerText: "Some answer.",
    });
    assert.equal(result.ok, false);
  });

  await check("10. the final answer completes the interview", async () => {
    const llm = fixedLLM({
      action: "NEXT_QUESTION",
      evidence: evidence({ conceptualFound: true, practicalFound: true }),
    });
    const last = plan.questions.length - 1;
    const out = await turn(
      llm,
      depthSpent(last),
      plan.questions[last]!.id,
      "A full closing answer with specifics from my own build.",
    );

    assert.equal(out.finished, true);
    assert.equal(out.action, "COMPLETE");
    assert.equal(out.state.status, "COMPLETED");
    assert.equal(out.questionId, null);
    // Closing wording varies per interview; the invariant is that the closing
    // line for THIS interview is what gets spoken.
    assert.equal(out.prompt, closingLineFor("iv_test"));
  });

  await check("11. a stuck candidate is never probed", async () => {
    const llm = fixedLLM({
      action: "FOLLOW_UP",
      followUpQuestion: "Try anyway?",
      evidence: evidence({ flaggedIssues: ["stuck_or_evasive"] }),
    });
    const out = await turn(llm, stateAt(1), PROBEABLE.id, "I don't know.");
    assert.equal(out.action, "NEXT_QUESTION");
    assert.equal(out.state.followUpsAsked, 0);
  });

  await check("12. LangGraph reports the nodes it actually executed", async () => {
    const strong = await turn(
      fixedLLM({
        action: "NEXT_QUESTION",
        evidence: evidence({ conceptualFound: true, practicalFound: true }),
      }),
      stateAt(0),
      OPENER.id,
      "I ran it locally with Ollama; no API cost and the data stayed on my machine.",
    );
    // The opener carries deep probes, so a cleared bar routes through the
    // escalate branch — the trace is direct evidence that the ladder ran.
    assert.deepEqual(strong.trace, [
      "receiveAnswer",
      "analyzeAnswer",
      "routeResponse",
      "escalate",
      "updateState",
    ]);

    const off = await turn(
      createMockInterviewLLM(),
      stateAt(1),
      PROBEABLE.id,
      "Who is the PM of India?",
    );
    // A first off-topic turn takes the REPEAT branch (restate), not the
    // redirect one. Both are no-evidence branches, so the graph shape it is
    // checking — route, then a prompt-only node, then updateState — is the same.
    assert.deepEqual(off.trace, [
      "receiveAnswer",
      "analyzeAnswer",
      "routeResponse",
      "repeat",
      "updateState",
    ]);
  });

  await check("13. the interviewer acknowledges before the next question", async () => {
    const llm = fixedLLM({
      action: "NEXT_QUESTION",
      acknowledgement: "That makes sense, you kept it local for cost and privacy.",
      evidence: evidence({ conceptualFound: true, practicalFound: true }),
    });
    const out = await turn(llm, depthSpent(0), OPENER.id, "I ran it locally to avoid API cost.");

    assert.ok(
      out.prompt?.startsWith("That makes sense, you kept it local for cost and privacy."),
      "the model's acknowledgement is spoken first",
    );
    assert.ok(out.prompt?.endsWith(plan.questions[1]!.text), "then the next question");

    // One interviewer turn, not two, so a voice layer speaks it in one breath.
    const last = out.state.transcript[out.state.transcript.length - 1]!;
    assert.equal(last.role, "interviewer");
    assert.equal(last.text, out.prompt);
  });

  await check("13b. an acknowledgement may never smuggle in a question", async () => {
    const llm = fixedLLM({
      action: "NEXT_QUESTION",
      acknowledgement: "Interesting - and how did you measure that?",
      evidence: evidence({ conceptualFound: true }),
    });
    const out = await turn(llm, depthSpent(0), OPENER.id, "I ran it locally to avoid API cost.");

    assert.ok(
      !out.prompt?.includes("how did you measure that"),
      "a question in the acknowledgement is rejected",
    );
    assert.ok(out.prompt?.endsWith(plan.questions[1]!.text));
  });

  await check("13c. an over-long acknowledgement is replaced, not spoken", async () => {
    const llm = fixedLLM({
      action: "NEXT_QUESTION",
      acknowledgement: "x".repeat(400),
      evidence: evidence({ practicalFound: true }),
    });
    const out = await turn(llm, depthSpent(0), OPENER.id, "I ran it locally to avoid API cost.");
    assert.ok(!out.prompt?.includes("x".repeat(50)));
    assert.ok(out.prompt?.endsWith(plan.questions[1]!.text));
  });

  console.log(`\n${passed} checks passed.\n`);
}

main().catch((error) => {
  console.error("\nFAILED\n", error);
  process.exit(1);
});
