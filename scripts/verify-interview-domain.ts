/**
 * Deterministic checks for the General Interviewer Agent domain core.
 *
 * Covers only the pure modules — rubric, question rules, state routing,
 * evidence arithmetic, scoring, eligibility. The LLM call sites and the Prisma
 * context builders are excluded by design: they are `server-only` and are not
 * unit-testable without a running Next/DB environment.
 *
 * Run: npx tsx scripts/verify-interview-domain.ts
 */
import assert from "node:assert/strict";

import { computeEligibility, type PriorAttempt } from "../src/features/interview/eligibility";
import {
  deriveCompetencyTier,
  deriveFallbackJudgments,
  mergeEvidence,
} from "../src/features/interview/evidence";
import { planQuestions } from "../src/features/interview/question-rules";
import { buildRubricSnapshot, RUBRIC, TOTAL_RUBRIC_WEIGHT } from "../src/features/interview/rubric";
import { aggregateScores } from "../src/features/interview/scoring";
import { advanceTurn, createInitialState } from "../src/features/interview/state";
import {
  INTERVIEW_QUESTION_COUNT,
  INTERVIEW_MIN_COMPLETED_DAYS,
  MAX_FOLLOW_UPS_PER_QUESTION,
  STUCK_ANSWERS_BEFORE_EARLY_END,
} from "../src/features/interview/constants";
import type {
  AnswerEvidence,
  CandidateContext,
  CompletedChallengeTask,
  InterviewPlan,
  InterviewState,
} from "../src/features/interview/types";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

/* ------------------------------------------------------------- fixtures */

function makeTask(n: number, withProof = false): CompletedChallengeTask {
  return {
    submissionId: `sub${n}`,
    enrollmentId: "enr1",
    challengeId: "ch1",
    domain: "AI",
    challengeTitle: "60-Day AI",
    dayNumber: n,
    dailyTaskId: `dt${n}`,
    title: `Task ${n}`,
    problemStatement: `Problem ${n}`,
    learningObjectives: ["obj"],
    tags: ["tag"],
    difficulty: "medium",
    hasGithubProof: withProof,
    hasLinkedinProof: false,
    submittedAt: new Date(),
  };
}

function makeContext(taskCount: number): CandidateContext {
  return {
    userId: "u1",
    fullName: "Test Student",
    domain: "AI",
    role: null,
    organization: null,
    yearsExperience: null,
    college: null,
    challenge: {
      enrollments: [],
      tasks: Array.from({ length: taskCount }, (_, i) => makeTask(i + 1)),
      totalCompletedDays: taskCount,
      completedSubmissionIds: Array.from(
        { length: taskCount },
        (_, i) => `sub${i + 1}`,
      ),
    },
    resume: {
      hasStructuredResume: false,
      headline: null,
      summary: null,
      targetRole: null,
      skills: [],
      experience: [],
      projects: [],
      resumeUrl: null,
    },
  };
}

function makePlan(context: CandidateContext): InterviewPlan {
  const questions = planQuestions(context);
  return {
    questions,
    rubricSnapshot: buildRubricSnapshot(),
    contextSummary: {
      kind: "GENERAL",
      totalCompletedDays: context.challenge.totalCompletedDays,
      challengeSourcedQuestions: questions.length,
      resumeSourcedQuestions: 0,
      genericQuestions: 0,
      hasStructuredResume: false,
    },
  };
}

function evidence(over: Partial<AnswerEvidence> = {}): AnswerEvidence {
  return {
    conceptualFound: false,
    practicalFound: false,
    tradeoffsFound: false,
    flaggedIssues: [],
    reasoning: "",
    ...over,
  };
}

function stateWith(
  evidenceByQuestionId: Record<string, AnswerEvidence>,
): InterviewState {
  return { ...createInitialState(), evidenceByQuestionId };
}

/* ----------------------------------------------------------------- rubric */

console.log("\nrubric");

check("weights sum to 100", () => {
  assert.equal(TOTAL_RUBRIC_WEIGHT, 100);
});

check("five competencies defined", () => {
  assert.equal(RUBRIC.length, 5);
});

/* --------------------------------------------------------- question rules */

console.log("\nquestion-rules");

check("plans exactly INTERVIEW_QUESTION_COUNT questions", () => {
  assert.equal(planQuestions(makeContext(30)).length, INTERVIEW_QUESTION_COUNT);
});

check("never reuses the same challenge task twice", () => {
  const questions = planQuestions(makeContext(30));
  const ids = questions
    .map((q) => q.sourceRef.submissionId)
    .filter((id): id is string => Boolean(id));
  assert.equal(new Set(ids).size, ids.length);
});

check("only grounds questions in completed submissions", () => {
  const context = makeContext(3);
  const allowed = new Set(context.challenge.completedSubmissionIds);
  for (const q of planQuestions(context)) {
    if (q.sourceRef.submissionId) {
      assert.ok(allowed.has(q.sourceRef.submissionId));
    }
  }
});

check("degrades to non-challenge sources when tasks run out", () => {
  const questions = planQuestions(makeContext(2));
  const challengeSourced = questions.filter(
    (q) => q.sourceRef.source === "CHALLENGE_TASK",
  );
  assert.equal(challengeSourced.length, 2);
  assert.equal(questions.length, INTERVIEW_QUESTION_COUNT);
});

check("does not ask the same competency three times in a row", () => {
  const competencies = planQuestions(makeContext(30)).map((q) => q.competency);
  for (let i = 2; i < competencies.length; i++) {
    const sameRun =
      competencies[i] === competencies[i - 1] &&
      competencies[i] === competencies[i - 2];
    assert.ok(!sameRun, `three consecutive ${competencies[i]} at index ${i}`);
  }
});

/* ------------------------------------------------------------------ state */

console.log("\nstate routing");

check("follow-up is granted within budget", () => {
  const plan = makePlan(makeContext(30));
  const state = { ...createInitialState(), status: "IN_PROGRESS" as const };
  const result = advanceTurn(plan, state, "q1", evidence({ conceptualFound: true }), "FOLLOW_UP");
  assert.equal(result.action, "FOLLOW_UP");
  assert.equal(result.state.followUpsAsked, 1);
  assert.equal(result.state.currentQuestionIndex, 0);
});

check("follow-up past budget is downgraded to next question", () => {
  const plan = makePlan(makeContext(30));
  const state = {
    ...createInitialState(),
    status: "IN_PROGRESS" as const,
    followUpsAsked: MAX_FOLLOW_UPS_PER_QUESTION,
  };
  const result = advanceTurn(plan, state, "q1", evidence({ conceptualFound: true }), "FOLLOW_UP");
  assert.equal(result.action, "NEXT_QUESTION");
  assert.equal(result.state.currentQuestionIndex, 1);
  assert.equal(result.state.followUpsAsked, 0);
});

check("stuck answer never earns a follow-up", () => {
  const plan = makePlan(makeContext(30));
  const state = { ...createInitialState(), status: "IN_PROGRESS" as const };
  const result = advanceTurn(plan, state, "q1", evidence({ flaggedIssues: ["stuck_or_evasive"] }), "FOLLOW_UP");
  assert.equal(result.action, "NEXT_QUESTION");
});

check("interview ends after consecutive stuck answers", () => {
  const plan = makePlan(makeContext(30));
  let state: InterviewState = { ...createInitialState(), status: "IN_PROGRESS" };
  let action = "";
  for (let i = 0; i < STUCK_ANSWERS_BEFORE_EARLY_END; i++) {
    const result = advanceTurn(
      plan,
      state,
      `q${i + 1}`,
      evidence({ flaggedIssues: ["stuck_or_evasive"] }),
      "NEXT_QUESTION",
    );
    state = result.state;
    action = result.action;
  }
  assert.equal(action, "END_INTERVIEW");
  assert.equal(state.status, "COMPLETED");
});

check("a good answer resets the stuck counter", () => {
  const plan = makePlan(makeContext(30));
  const stuck = advanceTurn(
    plan,
    { ...createInitialState(), status: "IN_PROGRESS" },
    "q1",
    evidence({ flaggedIssues: ["stuck_or_evasive"] }),
    "NEXT_QUESTION",
  );
  assert.equal(stuck.state.consecutiveStuckAnswers, 1);
  const recovered = advanceTurn(
    plan,
    stuck.state,
    "q2",
    evidence({ conceptualFound: true }),
    "NEXT_QUESTION",
  );
  assert.equal(recovered.state.consecutiveStuckAnswers, 0);
});

check("interview ends when the plan is exhausted", () => {
  const plan = makePlan(makeContext(30));
  const state: InterviewState = {
    ...createInitialState(),
    status: "IN_PROGRESS",
    currentQuestionIndex: plan.questions.length - 1,
  };
  const result = advanceTurn(plan, state, "q10", evidence({ conceptualFound: true }), "NEXT_QUESTION");
  assert.equal(result.action, "END_INTERVIEW");
  assert.equal(result.state.status, "COMPLETED");
});

/* --------------------------------------------------------------- evidence */

console.log("\nevidence");

check("merge ORs evidence axes across a follow-up", () => {
  const merged = mergeEvidence(
    evidence({ conceptualFound: true }),
    evidence({ practicalFound: true }),
  );
  assert.equal(merged.conceptualFound, true);
  assert.equal(merged.practicalFound, true);
});

check("COMMUNICATION scores above NONE despite having no question slots", () => {
  const plan = makePlan(makeContext(30));
  assert.equal(
    plan.questions.filter((q) => q.competency === "COMMUNICATION").length,
    0,
    "fixture precondition: COMMUNICATION has no dedicated slots",
  );
  const state = stateWith({
    q1: evidence({ conceptualFound: true }),
    q2: evidence({ conceptualFound: true }),
    q3: evidence({ conceptualFound: true }),
  });
  assert.equal(deriveCompetencyTier("COMMUNICATION", state, plan), "DEMONSTRATED");
});

check("COMMUNICATION drops when the candidate is repeatedly derailed", () => {
  const plan = makePlan(makeContext(30));
  const state = stateWith({
    q1: evidence({ flaggedIssues: ["off_topic"] }),
    q2: evidence({ flaggedIssues: ["stuck_or_evasive"] }),
    q3: evidence({ conceptualFound: true }),
  });
  assert.equal(deriveCompetencyTier("COMMUNICATION", state, plan), "NONE");
});

check("COMMUNICATION is NONE only when there is no evidence at all", () => {
  const plan = makePlan(makeContext(30));
  assert.equal(deriveCompetencyTier("COMMUNICATION", stateWith({}), plan), "NONE");
});

check("fallback judgments cover every competency", () => {
  const plan = makePlan(makeContext(30));
  const state = stateWith({ q1: evidence({ conceptualFound: true }) });
  const { judgments } = deriveFallbackJudgments(state, plan);
  assert.equal(judgments.length, RUBRIC.length);
});

/* ---------------------------------------------------------------- scoring */

console.log("\nscoring");

check("all DEMONSTRATED scores 100", () => {
  const scores = aggregateScores(
    RUBRIC.map((r) => ({ competency: r.competency, tier: "DEMONSTRATED" as const, justification: "" })),
    "",
  );
  assert.equal(scores.overallScore, 100);
});

check("all NONE scores 0", () => {
  const scores = aggregateScores(
    RUBRIC.map((r) => ({ competency: r.competency, tier: "NONE" as const, justification: "" })),
    "",
  );
  assert.equal(scores.overallScore, 0);
});

check("a missing competency judgment scores NONE, not a crash", () => {
  const scores = aggregateScores([], "");
  assert.equal(scores.overallScore, 0);
  assert.equal(scores.perCompetency.length, RUBRIC.length);
});

check("identical evidence always yields an identical score", () => {
  const judgments = RUBRIC.map((r) => ({
    competency: r.competency,
    tier: "EXPLAINED" as const,
    justification: "",
  }));
  assert.equal(
    aggregateScores(judgments, "a").overallScore,
    aggregateScores(judgments, "b").overallScore,
  );
});

/* ------------------------------------------------------------ eligibility */

console.log("\neligibility");

const ids = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => `sub${i + 1 + offset}`);

const completedAttempt = (consumed: string[]): PriorAttempt => ({
  attemptNumber: 1,
  status: "COMPLETED",
  consumedSubmissionIds: consumed,
  startedAt: new Date(),
});

check("locked below the first-attempt threshold", () => {
  const result = computeEligibility(ids(INTERVIEW_MIN_COMPLETED_DAYS - 1), []);
  assert.equal(result.state, "locked");
});

check("ready at exactly the threshold", () => {
  const result = computeEligibility(ids(INTERVIEW_MIN_COMPLETED_DAYS), []);
  assert.equal(result.state, "ready");
  if (result.state === "ready") assert.equal(result.attemptNumber, 1);
});

check("retake locked immediately after an attempt consumes everything", () => {
  const all = ids(30);
  const result = computeEligibility(all, [completedAttempt(all)]);
  assert.equal(result.state, "retake_locked");
  if (result.state === "retake_locked") {
    assert.equal(result.newDaysSinceLastAttempt, 0);
  }
});

check("29 new days is still locked", () => {
  const first = ids(30);
  const result = computeEligibility([...first, ...ids(29, 30)], [completedAttempt(first)]);
  assert.equal(result.state, "retake_locked");
});

check("30 new days unlocks attempt 2", () => {
  const first = ids(30);
  const result = computeEligibility([...first, ...ids(30, 30)], [completedAttempt(first)]);
  assert.equal(result.state, "ready");
  if (result.state === "ready") {
    assert.equal(result.attemptNumber, 2);
    assert.equal(result.eligibleSubmissionIds.length, 30);
    assert.ok(!result.eligibleSubmissionIds.some((id) => first.includes(id)));
  }
});

check("elapsed time alone never unlocks a retake", () => {
  const first = ids(30);
  const longAgo: PriorAttempt = {
    ...completedAttempt(first),
    startedAt: new Date("2020-01-01"),
  };
  assert.equal(computeEligibility(first, [longAgo]).state, "retake_locked");
});

check("abandoned attempts consume nothing", () => {
  const abandoned: PriorAttempt = {
    attemptNumber: 1,
    status: "ABANDONED",
    consumedSubmissionIds: [],
    startedAt: new Date("2020-01-01"),
  };
  const result = computeEligibility(ids(30), [abandoned]);
  assert.equal(result.state, "ready");
  if (result.state === "ready") assert.equal(result.attemptNumber, 1);
});

check("invalid (technical failure) attempts consume nothing", () => {
  const invalid: PriorAttempt = {
    attemptNumber: 1,
    status: "INVALID",
    consumedSubmissionIds: [],
    startedAt: new Date("2020-01-01"),
  };
  const result = computeEligibility(ids(30), [invalid]);
  assert.equal(result.state, "ready");
  if (result.state === "ready") assert.equal(result.attemptNumber, 1);
});

check("a live session reports in_progress", () => {
  const live: PriorAttempt = {
    attemptNumber: 1,
    status: "IN_PROGRESS",
    consumedSubmissionIds: [],
    startedAt: new Date(),
  };
  assert.equal(computeEligibility(ids(30), [live]).state, "in_progress");
});

check("a stale session does not block a new attempt", () => {
  const stale: PriorAttempt = {
    attemptNumber: 1,
    status: "IN_PROGRESS",
    consumedSubmissionIds: [],
    startedAt: new Date(Date.now() - 60 * 60 * 1000),
  };
  assert.equal(computeEligibility(ids(30), [stale]).state, "ready");
});

check("progress combines across challenges", () => {
  const first = ids(30);
  const fromOtherChallenge = ["x1", "x2"].concat(ids(28, 100));
  const result = computeEligibility([...first, ...fromOtherChallenge], [completedAttempt(first)]);
  assert.equal(result.state, "ready");
});

console.log(`\n${passed} checks passed\n`);
