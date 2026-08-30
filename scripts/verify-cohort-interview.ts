/**
 * Deterministic checks for the AI Cohort milestone interview.
 *
 * Covers only the pure modules — blueprint scope, question bank, planner,
 * eligibility set logic, turn routing, scoring, and the action boundary
 * schemas. Anything `server-only` (repository, service, eligibility reads) is
 * exercised by `scripts/smoke-cohort-interview.ts` against the developer Neon
 * database instead.
 *
 * This suite needs no database, no network and no API key, so it can gate every
 * commit.
 *
 * Run: npx tsx scripts/verify-cohort-interview.ts
 */
import assert from "node:assert/strict";

import {
  BLUEPRINT_SCOPE,
  INTERVIEW_BLUEPRINTS,
  blueprintSlug,
  isInterviewBlueprint,
  maxScopeDay,
  parseBlueprintParam,
} from "../src/features/interview/cohort/blueprint";
import {
  getQuestionBank,
  questionCountFor,
  QUESTION_BANK_VERSION,
} from "../src/features/interview/cohort/question-bank";
import {
  planCohortInterview,
  scopeDaysFor,
} from "../src/features/interview/cohort/planner";
import {
  isBlueprintUnlocked,
  missingDaysFor,
} from "../src/features/interview/cohort/eligibility-rules";
import { advanceTurn, createInitialState, followUpBudgetFor } from "../src/features/interview/state";
import { aggregateScores } from "../src/features/interview/scoring";
import { RUBRIC } from "../src/features/interview/rubric";
import {
  interviewIdSchema,
  startInterviewSchema,
  submitInterviewAnswerSchema,
} from "../src/lib/validations/interview";
import type { AnswerEvidence } from "../src/features/interview/types";

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(`${name}\n       ${(e as Error).message.split("\n")[0]}`);
    console.log(`  FAIL ${name}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

const noEvidence: AnswerEvidence = {
  conceptualFound: false,
  practicalFound: false,
  tradeoffsFound: false,
  flaggedIssues: [],
  reasoning: "",
};

/* ============================================ scope: the critical invariant */

section("Blueprint scope");

check("DAY_15 covers exactly days 1-15", () => {
  assert.deepEqual(BLUEPRINT_SCOPE.DAY_15, [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  ]);
  assert.equal(maxScopeDay("DAY_15"), 15);
});

check("DAY_31 covers exactly days 1-31", () => {
  assert.equal(BLUEPRINT_SCOPE.DAY_31.length, 31);
  assert.equal(BLUEPRINT_SCOPE.DAY_31[0], 1);
  assert.equal(BLUEPRINT_SCOPE.DAY_31[30], 31);
  assert.equal(maxScopeDay("DAY_31"), 31);
});

check("DAY_15 CANNOT access any question sourced from days 16-31", () => {
  const bank = getQuestionBank("DAY_15");
  for (const q of bank.questions) {
    for (const day of q.sourceDays) {
      assert.ok(
        day <= 15,
        `${q.id} references day ${day}, outside the DAY_15 window`,
      );
    }
  }
});

check("DAY_15 PLAN cannot contain a day 16-31 question", () => {
  const plan = planCohortInterview("DAY_15");
  for (const q of plan.questions) {
    for (const day of q.sourceRef.sourceDays ?? []) {
      assert.ok(day <= 15, `planned ${q.id} leaks day ${day}`);
    }
  }
});

check("no DAY_31 question id appears in the DAY_15 bank", () => {
  const day15 = new Set(getQuestionBank("DAY_15").questions.map((q) => q.id));
  for (const q of getQuestionBank("DAY_31").questions) {
    assert.ok(!day15.has(q.id), `${q.id} appears in both banks`);
  }
});

check("DAY_31 can access days 1-31, and actually reaches both ends", () => {
  const days = getQuestionBank("DAY_31").questions.flatMap((q) => q.sourceDays);
  for (const day of days) {
    assert.ok(day >= 1 && day <= 31, `day ${day} outside DAY_31 window`);
  }
  assert.ok(Math.min(...days) <= 10, "DAY_31 never reaches early curriculum");
  assert.ok(Math.max(...days) === 31, "DAY_31 never reaches the capstone");
});

check("DAY_31 includes the Day 31 capstone reasoning question", () => {
  const capstone = getQuestionBank("DAY_31").questions.find((q) =>
    q.sourceDays.includes(31),
  );
  assert.ok(capstone, "no question grounded in Day 31");
  assert.equal(capstone!.competency, "PROBLEM_SOLVING");
  assert.equal(
    capstone!.id,
    getQuestionBank("DAY_31").questions.at(-1)!.id,
    "the capstone question should close the exit interview",
  );
});

/* ================================================================ the bank */

section("Question bank integrity");

check("both banks are versioned and non-empty", () => {
  for (const bp of INTERVIEW_BLUEPRINTS) {
    const bank = getQuestionBank(bp);
    assert.equal(bank.version, QUESTION_BANK_VERSION);
    assert.ok(bank.questions.length > 0);
  }
});

check("DAY_15 asks 10 questions, DAY_31 asks 11", () => {
  assert.equal(questionCountFor("DAY_15"), 10);
  assert.equal(questionCountFor("DAY_31"), 11);
});

check("DAY_15 competency mix is 3/3/2/2", () => {
  const counts = new Map<string, number>();
  for (const q of getQuestionBank("DAY_15").questions) {
    counts.set(q.competency, (counts.get(q.competency) ?? 0) + 1);
  }
  assert.equal(counts.get("CONCEPTUAL"), 3);
  assert.equal(counts.get("PRACTICAL"), 3);
  assert.equal(counts.get("PROBLEM_SOLVING"), 2);
  assert.equal(counts.get("TECHNICAL_DEPTH"), 2);
  // COMMUNICATION is observed across every answer, never asked directly.
  assert.equal(counts.get("COMMUNICATION"), undefined);
});

check("DAY_31 competency mix is 3 practical / 4 problem-solving / 2 / 2", () => {
  const counts = new Map<string, number>();
  for (const q of getQuestionBank("DAY_31").questions) {
    counts.set(q.competency, (counts.get(q.competency) ?? 0) + 1);
  }
  assert.equal(counts.get("PRACTICAL"), 3);
  assert.equal(counts.get("PROBLEM_SOLVING"), 4);
  assert.equal(counts.get("CONCEPTUAL"), 2);
  assert.equal(counts.get("TECHNICAL_DEPTH"), 2);
});

check("DAY_31 is strictly deeper than DAY_15", () => {
  const d31 = getQuestionBank("DAY_31").questions;
  const d15 = getQuestionBank("DAY_15").questions;

  for (const q of d31) {
    assert.ok(q.minEvidence >= 3, `${q.id} minEvidence ${q.minEvidence} < 3`);
    assert.equal(q.difficulty, "hard", `${q.id} is not hard`);
  }
  const d15Hard = d15.filter((q) => q.difficulty === "hard").length;
  assert.ok(d15Hard < d15.length, "DAY_15 should not be uniformly hard");
});

check("no two adjacent questions share a competency", () => {
  for (const bp of INTERVIEW_BLUEPRINTS) {
    const qs = getQuestionBank(bp).questions;
    for (let i = 1; i < qs.length; i++) {
      assert.notEqual(
        qs[i].competency,
        qs[i - 1].competency,
        `${bp}: ${qs[i - 1].id} and ${qs[i].id} share a competency`,
      );
    }
  }
});

check("every question's minEvidence is satisfiable", () => {
  for (const bp of INTERVIEW_BLUEPRINTS) {
    for (const q of getQuestionBank(bp).questions) {
      assert.ok(q.minEvidence >= 1);
      assert.ok(
        q.minEvidence <= q.expectedEvidence.length,
        `${q.id} needs ${q.minEvidence} of ${q.expectedEvidence.length}`,
      );
    }
  }
});

check("any question allowing follow-ups carries a fallback prompt", () => {
  for (const bp of INTERVIEW_BLUEPRINTS) {
    for (const q of getQuestionBank(bp).questions) {
      if (q.maxFollowUps > 0) {
        assert.ok(q.followUpPrompt, `${q.id} can probe but has no prompt`);
      }
    }
  }
});

check("DAY_15 has exactly one zero-follow-up question, and it opens", () => {
  const qs = getQuestionBank("DAY_15").questions;
  const zero = qs.filter((q) => q.maxFollowUps === 0);
  assert.equal(zero.length, 1);
  assert.equal(zero[0].id, qs[0].id);
  assert.equal(zero[0].difficulty, "easy");
});

/* ============================================================== the planner */

section("Planner determinism");

check("the plan is identical across builds", () => {
  for (const bp of INTERVIEW_BLUEPRINTS) {
    assert.deepEqual(planCohortInterview(bp), planCohortInterview(bp));
  }
});

check("questions are ordered 1..n with no gaps", () => {
  for (const bp of INTERVIEW_BLUEPRINTS) {
    const plan = planCohortInterview(bp);
    plan.questions.forEach((q, i) => assert.equal(q.order, i + 1));
  }
});

check("no cohort question is ever LLM-phrased", () => {
  for (const bp of INTERVIEW_BLUEPRINTS) {
    for (const q of planCohortInterview(bp).questions) {
      assert.equal(q.llmPhrased, false, `${q.id} was marked LLM-phrased`);
      assert.equal(q.sourceRef.source, "COHORT_CURRICULUM");
    }
  }
});

check("planned text matches the bank verbatim", () => {
  for (const bp of INTERVIEW_BLUEPRINTS) {
    const bank = getQuestionBank(bp).questions;
    planCohortInterview(bp).questions.forEach((q, i) => {
      assert.equal(q.text, bank[i].text, `${q.id} text drifted from the bank`);
    });
  }
});

check("the plan carries a COHORT context summary, never a general one", () => {
  const plan = planCohortInterview("DAY_31");
  assert.equal(plan.contextSummary.kind, "COHORT");
  if (plan.contextSummary.kind === "COHORT") {
    assert.equal(plan.contextSummary.blueprint, "DAY_31");
    assert.equal(plan.contextSummary.questionCount, 11);
    assert.deepEqual(plan.contextSummary.scopeDays, scopeDaysFor("DAY_31"));
  }
});

check("the rubric snapshot travels with the plan", () => {
  const plan = planCohortInterview("DAY_15");
  assert.equal(plan.rubricSnapshot.competencies.length, RUBRIC.length);
});

/* ========================================================== eligibility */

section("Eligibility rules");

const daysUpTo = (n: number) =>
  new Set(Array.from({ length: n }, (_, i) => i + 1));

check("incomplete Day 15 blocks the DAY_15 interview", () => {
  assert.equal(isBlueprintUnlocked("DAY_15", daysUpTo(14)), false);
  assert.deepEqual(missingDaysFor("DAY_15", daysUpTo(14)), [15]);
});

check("all 15 days passed unlocks DAY_15", () => {
  assert.equal(isBlueprintUnlocked("DAY_15", daysUpTo(15)), true);
  assert.deepEqual(missingDaysFor("DAY_15", daysUpTo(15)), []);
});

check("incomplete Day 31 blocks the DAY_31 interview", () => {
  assert.equal(isBlueprintUnlocked("DAY_31", daysUpTo(30)), false);
  assert.deepEqual(missingDaysFor("DAY_31", daysUpTo(30)), [31]);
});

check("all 31 days passed unlocks DAY_31", () => {
  assert.equal(isBlueprintUnlocked("DAY_31", daysUpTo(31)), true);
});

check("a COUNT of 15 passed days does not unlock DAY_15", () => {
  // The exact hazard `cleanPassCount` would introduce: fifteen passed days,
  // but not days 1..15. Day 3 is missing and day 20 is present.
  const scattered = new Set([1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20]);
  assert.equal(scattered.size, 15);
  assert.equal(isBlueprintUnlocked("DAY_15", scattered), false);
  assert.deepEqual(missingDaysFor("DAY_15", scattered), [3]);
});

check("a high progressDay does not unlock a blueprint", () => {
  // An admin lock bypass could leave a passed day 20 with nothing before it.
  const bypassed = new Set([20]);
  assert.equal(isBlueprintUnlocked("DAY_15", bypassed), false);
  assert.equal(missingDaysFor("DAY_15", bypassed).length, 15);
});

check("skipped days never count toward an unlock", () => {
  // A skipped day is simply absent from the passed set.
  const withSkip = daysUpTo(15);
  withSkip.delete(9);
  assert.equal(isBlueprintUnlocked("DAY_15", withSkip), false);
  assert.deepEqual(missingDaysFor("DAY_15", withSkip), [9]);
});

check("DAY_15 and DAY_31 unlock independently", () => {
  const fifteen = daysUpTo(15);
  assert.equal(isBlueprintUnlocked("DAY_15", fifteen), true);
  assert.equal(isBlueprintUnlocked("DAY_31", fifteen), false);
});

/* ===================================================== turn routing budgets */

section("Turn routing");

check("a zero-follow-up question is never probed", () => {
  const plan = planCohortInterview("DAY_15");
  const opener = plan.questions[0];
  assert.equal(followUpBudgetFor(opener), 0);

  const result = advanceTurn(
    plan,
    { ...createInitialState(), status: "IN_PROGRESS" },
    opener.id,
    noEvidence,
    "FOLLOW_UP",
  );
  assert.equal(result.action, "NEXT_QUESTION");
});

check("a two-follow-up question honours its larger budget", () => {
  const plan = planCohortInterview("DAY_15");
  const twoBudget = plan.questions.find((q) => q.maxFollowUps === 2);
  assert.ok(twoBudget, "expected a 2-follow-up question in DAY_15");
  assert.equal(followUpBudgetFor(twoBudget!), 2);

  const state = {
    ...createInitialState(),
    status: "IN_PROGRESS" as const,
    currentQuestionIndex: twoBudget!.order - 1,
    followUpsAsked: 1,
  };
  const result = advanceTurn(plan, state, twoBudget!.id, noEvidence, "FOLLOW_UP");
  assert.equal(result.action, "FOLLOW_UP");
  assert.equal(result.state.followUpsAsked, 2);
});

check("the per-question budget is a ceiling, not a suggestion", () => {
  const plan = planCohortInterview("DAY_15");
  const oneBudget = plan.questions.find((q) => q.maxFollowUps === 1)!;
  const state = {
    ...createInitialState(),
    status: "IN_PROGRESS" as const,
    currentQuestionIndex: oneBudget.order - 1,
    followUpsAsked: 1,
  };
  const result = advanceTurn(plan, state, oneBudget.id, noEvidence, "FOLLOW_UP");
  assert.equal(result.action, "NEXT_QUESTION");
});

check("a stuck candidate is moved on, never probed", () => {
  const plan = planCohortInterview("DAY_31");
  const q = plan.questions[1];
  const stuck: AnswerEvidence = {
    ...noEvidence,
    flaggedIssues: ["stuck_or_evasive"],
  };
  const result = advanceTurn(
    plan,
    { ...createInitialState(), status: "IN_PROGRESS", currentQuestionIndex: 1 },
    q.id,
    stuck,
    "FOLLOW_UP",
  );
  assert.equal(result.action, "NEXT_QUESTION");
});

check("the interview ends after the last question", () => {
  const plan = planCohortInterview("DAY_31");
  const last = plan.questions.at(-1)!;
  const result = advanceTurn(
    plan,
    {
      ...createInitialState(),
      status: "IN_PROGRESS",
      currentQuestionIndex: plan.questions.length - 1,
    },
    last.id,
    noEvidence,
    "NEXT_QUESTION",
  );
  assert.equal(result.action, "END_INTERVIEW");
  assert.equal(result.state.status, "COMPLETED");
});

/* ========================================================== score integrity */

section("Scoring");

check("identical evidence always yields an identical score", () => {
  const judgments = RUBRIC.map((r) => ({
    competency: r.competency,
    tier: "EXPLAINED" as const,
    justification: "",
  }));
  const a = aggregateScores(judgments, "s");
  const b = aggregateScores(judgments, "s");
  assert.deepEqual(a, b);
});

check("scores stay inside 0..100", () => {
  const best = RUBRIC.map((r) => ({
    competency: r.competency,
    tier: "DEMONSTRATED" as const,
    justification: "",
  }));
  const worst = RUBRIC.map((r) => ({
    competency: r.competency,
    tier: "NONE" as const,
    justification: "",
  }));
  assert.equal(aggregateScores(best, "").overallScore, 100);
  assert.equal(aggregateScores(worst, "").overallScore, 0);
});

/* ================================================ the client trust boundary */

section("Client trust boundary");

check("an unknown blueprint is rejected", () => {
  assert.equal(startInterviewSchema.safeParse({ blueprint: "DAY_99" }).success, false);
  assert.equal(startInterviewSchema.safeParse({ blueprint: "" }).success, false);
  assert.equal(startInterviewSchema.safeParse({}).success, false);
  assert.equal(startInterviewSchema.safeParse({ blueprint: 15 }).success, false);
});

check("a valid blueprint parses to the enum", () => {
  const parsed = startInterviewSchema.parse({ blueprint: "DAY_15" });
  assert.equal(parsed.blueprint, "DAY_15");
});

check("a client CANNOT inject scores or evidence on an answer", () => {
  const parsed = submitInterviewAnswerSchema.parse({
    interviewId: "int_1",
    questionId: "d15-q03",
    answerText: "a real answer",
    // Everything below is hostile input and must not survive parsing.
    overallScore: 100,
    conceptualScore: 100,
    evidence: { conceptualFound: true, practicalFound: true },
    state: { currentQuestionIndex: 99, status: "COMPLETED" },
    blueprint: "DAY_31",
    plan: { questions: [] },
  });

  const keys = Object.keys(parsed).sort();
  assert.deepEqual(keys, ["answerText", "interviewId", "questionId"]);
  for (const forbidden of [
    "overallScore",
    "conceptualScore",
    "evidence",
    "state",
    "blueprint",
    "plan",
  ]) {
    assert.ok(!(forbidden in parsed), `${forbidden} survived the boundary`);
  }
});

check("a client CANNOT inject state or scores on finish", () => {
  const parsed = interviewIdSchema.parse({
    interviewId: "int_1",
    overallScore: 100,
    durationSec: 999999,
    scores: { overallScore: 100 },
  });
  assert.deepEqual(Object.keys(parsed), ["interviewId"]);
});

check("oversized ids and answers are rejected", () => {
  assert.equal(
    interviewIdSchema.safeParse({ interviewId: "x".repeat(65) }).success,
    false,
  );
  assert.equal(
    submitInterviewAnswerSchema.safeParse({
      interviewId: "i",
      questionId: "q",
      answerText: "x".repeat(8001),
    }).success,
    false,
  );
});

/* ------------------------------------------------------- route param safety */

section("Route parameter parsing");

check("valid blueprint params parse, in both spellings", () => {
  assert.equal(parseBlueprintParam("DAY_15"), "DAY_15");
  assert.equal(parseBlueprintParam("day-15"), "DAY_15");
  assert.equal(parseBlueprintParam("day_31"), "DAY_31");
  assert.equal(parseBlueprintParam(" DAY_31 "), "DAY_31");
});

check("hostile blueprint params return null", () => {
  for (const bad of [
    "DAY_16",
    "DAY_0",
    "../DAY_31",
    "DAY_15; DROP TABLE",
    "__proto__",
    "",
  ]) {
    assert.equal(parseBlueprintParam(bad), null, `${bad} should not parse`);
  }
});

check("slug round-trips", () => {
  for (const bp of INTERVIEW_BLUEPRINTS) {
    assert.equal(parseBlueprintParam(blueprintSlug(bp)), bp);
    assert.ok(isInterviewBlueprint(bp));
  }
});

/* --------------------------------------------------------------------- end */

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("");
