/**
 * Phase B: adaptive assessment-target selection for the interview platform.
 *
 * Pure — no database, no model, no network. The planner is a pure function of
 * (plan, state, answer), which is what makes "the same answer always produces
 * the same target" checkable rather than asserted.
 *
 * Run: npx tsx scripts/verify-interview-adaptive.ts
 */
import assert from "node:assert/strict";

import { getStartableDomain } from "../src/features/interview/platform/domains";
import { buildPlatformPlan } from "../src/features/interview/platform/planner";
import { formatProfileContext } from "../src/features/interview/platform/profile-context";
import { selectNextPlatformTarget } from "../src/features/interview/platform/target-planner";
import { coverageNeed, competencyCoverage } from "../src/features/interview/platform/coverage";
import { advanceTurn, createInitialState } from "../src/features/interview/state";
import type {
  AnswerEvidence,
  InterviewPlan,
  InterviewState,
} from "../src/features/interview/types";

let checks = 0;
function check(label: string, fn: () => void): void {
  fn();
  checks += 1;
  console.log(`  ok  ${label}`);
}

const domain = getStartableDomain("ai-fluency")!;
const plan = buildPlatformPlan(domain, { candidateFirstName: "Zainab" });
const first = plan.questions[0]!;

/** A state where `asked` have been put and `answered` carry evidence. */
function stateWith(
  asked: string[],
  answered: Record<string, number[] | undefined> = {},
): InterviewState {
  const evidenceByQuestionId: Record<string, AnswerEvidence> = {};
  for (const [id, matched] of Object.entries(answered)) {
    evidenceByQuestionId[id] = {
      conceptualFound: true,
      practicalFound: false,
      tradeoffsFound: false,
      flaggedIssues: [],
      reasoning: "t",
      relevance: "ON_TOPIC",
      ...(matched === undefined ? {} : { matchedEvidence: matched }),
    } as AnswerEvidence;
  }
  const last = asked[asked.length - 1];
  return {
    ...createInitialState(),
    status: "IN_PROGRESS",
    askedQuestionIds: [...asked],
    currentQuestionIndex: Math.max(
      0,
      plan.questions.findIndex((q) => q.id === last),
    ),
    evidenceByQuestionId,
  };
}

/* ------------------------------------------------- the answer steers the path */

console.log("\nthe candidate's answer selects the target");

check("different answers to the same state can select different targets", () => {
  const s = stateWith([first.id], { [first.id]: [0] });

  const chosen = new Set(
    [
      "",
      "I chunked the documents and put them in a vector store for retrieval.",
      "I check anything numeric against the source because it invents figures.",
      "I explained it to a colleague who had never used these tools before.",
    ].map((answer) => selectNextPlatformTarget(plan, s, answer).questionId),
  );

  assert.equal(
    chosen.size > 1,
    true,
    `every answer produced the same target: ${[...chosen].join(", ")}`,
  );
});

check("a relevant curriculum concept pulls the interview toward it", () => {
  const s = stateWith([first.id], { [first.id]: [0] });

  // Find the target whose own vocabulary this answer most matches, and assert
  // the planner actually goes there — rather than hard-coding a question id,
  // which would make the test a restatement of the implementation.
  const verificationAnswer =
    "I always verify the output against the original source because it " +
    "invents figures and citations, so I check anything numeric myself.";

  const picked = selectNextPlatformTarget(plan, s, verificationAnswer);
  const neutral = selectNextPlatformTarget(plan, s, "");

  assert.notEqual(
    picked.questionId,
    neutral.questionId,
    "a strongly on-topic answer did not change the target",
  );
  assert.match(picked.reason, /Follows what the candidate raised/);
  assert.equal(picked.considered[0]!.continuity > 0, true);
});

check("an irrelevant answer keeps curriculum scope and authored order", () => {
  const s = stateWith([first.id], { [first.id]: [0] });
  const picked = selectNextPlatformTarget(
    plan,
    s,
    "My favourite football team won on Saturday and the weather was lovely.",
  );
  // The requirement is curriculum scope, not authored order specifically. With
  // no topical signal the planner falls back to coverage need — which is why
  // this must select EXACTLY what it would have selected had the candidate said
  // nothing at all. Football contributed nothing, which is the point.
  const asIfSilent = selectNextPlatformTarget(plan, s, "");
  assert.equal(picked.questionId, asIfSilent.questionId);
  assert.equal(picked.considered[0]!.continuity, 0, "football scored continuity");
  assert.equal(picked.raised.length, 0, "an off-topic answer raised a concept");
});

/* --------------------------------------------------------------- guardrails */

console.log("\nguardrails");

check("the planner never selects a target outside the pack", () => {
  const ids = new Set(plan.questions.map((q) => q.id));
  const s = stateWith([first.id], { [first.id]: [0] });
  for (const answer of ["", "chunking retrieval vectors", "hallucination", "prompt"]) {
    const picked = selectNextPlatformTarget(plan, s, answer);
    assert.equal(ids.has(picked.questionId!), true, `${picked.questionId} not in pack`);
  }
});

check("a completed target is never selected again", () => {
  let s = stateWith([first.id], { [first.id]: [0] });
  const seen = new Set<string>([first.id]);

  for (let i = 0; i < plan.questions.length + 3; i += 1) {
    const picked = selectNextPlatformTarget(plan, s, "retrieval and chunking");
    if (picked.questionId === null) break;
    assert.equal(
      seen.has(picked.questionId),
      false,
      `re-selected ${picked.questionId}`,
    );
    seen.add(picked.questionId);
    s = stateWith([...seen], Object.fromEntries([...seen].map((id) => [id, [0]])));
  }
});

check("the interview terminates once every target is asked", () => {
  const all = plan.questions.map((q) => q.id);
  const s = stateWith(all, Object.fromEntries(all.map((id) => [id, [0]])));
  const picked = selectNextPlatformTarget(plan, s, "anything at all");
  assert.equal(picked.questionId, null);
  assert.match(picked.reason, /Every target has been assessed/);
});

check("selection is deterministic — same input, same target", () => {
  const s = stateWith([first.id], { [first.id]: [0] });
  const a = selectNextPlatformTarget(plan, s, "chunking and retrieval");
  const b = selectNextPlatformTarget(plan, s, "chunking and retrieval");
  assert.equal(a.questionId, b.questionId);
  assert.deepEqual(a.considered, b.considered);
});

/* ------------------------------------------------------- coverage behaviour */

console.log("\ncoverage");

check("a well-covered area is deprioritised against an untouched one", () => {
  assert.equal(coverageNeed("NOT_ASSESSED") > coverageNeed("SUFFICIENT"), true);
  assert.equal(coverageNeed("STRONG"), 0);
  // PARTIAL must stay attractive: a half-answered area is the most informative
  // thing left to ask about.
  assert.equal(coverageNeed("PARTIAL") > coverageNeed("SUFFICIENT"), true);
});

check("coverage is keyed by the PLATFORM rubric, not the engine union", () => {
  const s = stateWith([first.id], { [first.id]: [0, 1, 2] });
  const cov = competencyCoverage(plan, s);
  for (const key of cov.keys()) {
    assert.equal(
      ["CONCEPTUAL", "PRACTICAL", "PROBLEM_SOLVING", "TECHNICAL_DEPTH", "COMMUNICATION"].includes(key),
      false,
      `engine competency ${key} leaked into coverage`,
    );
  }
  assert.equal(cov.size > 0, true);
});

check("strong evidence on one target lifts that competency's coverage", () => {
  const weak = competencyCoverage(plan, stateWith([first.id], { [first.id]: [] }));
  const strong = competencyCoverage(
    plan,
    stateWith([first.id], { [first.id]: [0, 1, 2] }),
  );
  const id = first.platformCompetencyId!;
  assert.notEqual(weak.get(id)?.level, strong.get(id)?.level);
});

/* ------------------------------------------------- profile: context ≠ evidence */

console.log("\nprofile context");

check("profile can influence selection but creates no evidence", () => {
  const withProfile = buildPlatformPlan(domain, {
    profileContext: formatProfileContext(null),
  });
  // Same instrument either way — the profile never changes WHAT is asked.
  assert.deepEqual(
    withProfile.questions.map((q) => q.id),
    plan.questions.map((q) => q.id),
  );

  // And an empty state has no coverage regardless of profile.
  const cov = competencyCoverage(plan, createInitialState());
  for (const c of cov.values()) assert.equal(c.level, "NOT_ASSESSED");
});

/* ----------------------------------------- the seam: cohort stays sequential */

console.log("\nthe seam");

function evidence(): AnswerEvidence {
  return {
    conceptualFound: true,
    practicalFound: true,
    tradeoffsFound: true,
    flaggedIssues: [],
    reasoning: "t",
    matchedEvidence: [0, 1, 2],
    relevance: "ON_TOPIC",
  };
}

check("advanceTurn WITHOUT a selector is still currentQuestionIndex + 1", () => {
  const s: InterviewState = {
    ...createInitialState(),
    status: "IN_PROGRESS",
    currentQuestionIndex: 0,
  };
  const out = advanceTurn(plan, s, first.id, evidence(), "NEXT_QUESTION");
  assert.equal(out.action, "NEXT_QUESTION");
  assert.equal(out.state.currentQuestionIndex, 1);
  // The cohort's state shape must not grow a field it never had.
  assert.equal(
    out.state.askedQuestionIds,
    undefined,
    "sequential advance started tracking askedQuestionIds",
  );
});

check("advanceTurn WITH a selector uses it and records what was asked", () => {
  const s: InterviewState = {
    ...createInitialState(),
    status: "IN_PROGRESS",
    currentQuestionIndex: 0,
    askedQuestionIds: [first.id],
  };
  const out = advanceTurn(
    plan,
    s,
    first.id,
    evidence(),
    "NEXT_QUESTION",
    first.id,
    selectNextPlatformTarget,
    "retrieval, chunking and verifying the output against the source",
  );
  assert.equal(out.action, "NEXT_QUESTION");
  assert.equal((out.state.askedQuestionIds ?? []).length, 2);
  assert.notEqual(out.state.currentQuestionIndex, 0);
});

check("a selector-driven advance is NOT merely index + 1", () => {
  // Drive a whole interview with a strongly-themed answer and assert the route
  // differs from authored order at least once. Anything else would mean the
  // planner is wired in but inert.
  let s: InterviewState = {
    ...createInitialState(),
    status: "IN_PROGRESS",
    currentQuestionIndex: 0,
    askedQuestionIds: [first.id],
  };
  const route: number[] = [0];

  for (let i = 0; i < plan.questions.length - 1; i += 1) {
    const current = plan.questions[s.currentQuestionIndex]!;
    const out = advanceTurn(
      plan,
      s,
      current.id,
      evidence(),
      "NEXT_QUESTION",
      current.id,
      selectNextPlatformTarget,
      "I verify the output against the original source because it invents figures and citations.",
    );
    if (out.action === "END_INTERVIEW") break;
    s = out.state;
    route.push(s.currentQuestionIndex);
  }

  const sequential = route.map((_, i) => i);
  assert.notDeepEqual(
    route,
    sequential,
    `route was purely sequential: ${route.join(" → ")}`,
  );
  assert.equal(
    new Set(route).size,
    route.length,
    `a target was visited twice: ${route.join(" → ")}`,
  );
});

check("a selector-driven interview still terminates", () => {
  let s: InterviewState = {
    ...createInitialState(),
    status: "IN_PROGRESS",
    currentQuestionIndex: 0,
    askedQuestionIds: [first.id],
  };
  let ended = false;

  for (let i = 0; i < plan.questions.length + 5; i += 1) {
    const current = plan.questions[s.currentQuestionIndex]!;
    const out = advanceTurn(
      plan,
      s,
      current.id,
      evidence(),
      "NEXT_QUESTION",
      current.id,
      selectNextPlatformTarget,
      "retrieval",
    );
    s = out.state;
    if (out.action === "END_INTERVIEW") {
      ended = true;
      break;
    }
  }
  assert.equal(ended, true, "adaptive interview never terminated");
  assert.equal(s.status, "COMPLETED");
});

/* ------------------------------------------------------------- wind-down */

console.log("\nwind-down");

check("a selector can end the interview by returning null", () => {
  // How the wind-down guard works: "out of time" is just "nothing left worth
  // asking", which `advanceTurn` already turns into END_INTERVIEW. The guard
  // needs no new mechanism — but it depends entirely on this contract, so the
  // contract is asserted rather than assumed.
  const s: InterviewState = {
    ...createInitialState(),
    status: "IN_PROGRESS",
    currentQuestionIndex: 0,
    askedQuestionIds: [first.id],
  };
  const outOfTime = () => ({
    questionId: null,
    index: plan.questions.length,
  });

  const out = advanceTurn(
    plan,
    s,
    first.id,
    evidence(),
    "NEXT_QUESTION",
    first.id,
    outOfTime,
    "an answer given while several targets are still unasked",
  );

  assert.equal(
    out.action,
    "END_INTERVIEW",
    "a null target did not end the interview",
  );
  assert.equal(out.state.status, "COMPLETED");
  // It must end even though targets remain unasked — that is the whole point.
  assert.equal(plan.questions.length > 1, true);
});

console.log(`\n${checks} checks passed.\n`);
