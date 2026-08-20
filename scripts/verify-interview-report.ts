/**
 * Checks for the assessment and reporting layer (docs/plans/072, Phase 2).
 *
 * Scoring is pure arithmetic over recorded evidence, so all of it is tested
 * without a network or a database. The narrative model is stubbed, including
 * the case that matters most: a model that cites questions the candidate never
 * answered.
 *
 * Run: npx tsx scripts/verify-interview-report.ts
 */
import assert from "node:assert/strict";

import { planCohortInterview } from "../src/features/interview/cohort/planner";
import { getQuestionBank } from "../src/features/interview/cohort/question-bank";
import { moduleForDay } from "../src/features/interview/cohort/curriculum";
import {
  assertScopeIntegrity,
  scoreModules,
  scoreQuestion,
  scoreToTier,
} from "../src/features/interview/module-scoring";
import {
  assessCompetencies,
  overallFromCompetencies,
} from "../src/features/interview/scoring";
import {
  filterNarrative,
  parseReport,
} from "../src/features/interview/report-assembly";
import { coreProgressFor } from "../src/features/interview/report-analysis";
import { coreProgressFor } from "../src/features/interview/report-analysis";
import { buildInterviewReport } from "../src/features/interview/report";
import { createInitialState, startInterview } from "../src/features/interview/state";
import type { AskJson } from "../src/features/interview/agent/llm/json-provider";
import type {
  AnswerEvidence,
  InterviewPlan,
  InterviewState,
} from "../src/features/interview/types";

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
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

/* ------------------------------------------------------------- fixtures */

const plan: InterviewPlan = planCohortInterview("DAY_15");
const DAY_15_SCOPE = Array.from({ length: 15 }, (_, i) => i + 1);
const DAY_31_SCOPE = Array.from({ length: 31 }, (_, i) => i + 1);

function evidence(matched: number[], over: Partial<AnswerEvidence> = {}): AnswerEvidence {
  return {
    conceptualFound: matched.length > 0,
    practicalFound: matched.length > 1,
    tradeoffsFound: false,
    flaggedIssues: [],
    reasoning: "test",
    matchedEvidence: matched,
    relevance: "ON_TOPIC",
    ...over,
  };
}

/** A finished interview state where every question matched `perQuestion` items. */
function stateWith(
  activePlan: InterviewPlan,
  perQuestion: (index: number) => number[] | null,
): InterviewState {
  const base = startInterview(createInitialState());
  const evidenceByQuestionId: Record<string, AnswerEvidence> = {};
  const transcript: InterviewState["transcript"] = [];

  activePlan.questions.forEach((question, index) => {
    const matched = perQuestion(index);
    if (matched === null) return;
    evidenceByQuestionId[question.id] = evidence(matched);
    transcript.push({
      role: "candidate",
      text: `Answer to ${question.id} covering ${matched.length} points.`,
      questionId: question.id,
      ts: Date.now(),
    });
  });

  return {
    ...base,
    status: "COMPLETED",
    evidenceByQuestionId,
    transcript,
  };
}

/** Every question fully answered. */
const fullState = stateWith(plan, (i) => {
  const q = plan.questions[i]!;
  return Array.from({ length: q.expectedEvidence?.length ?? 0 }, (_, k) => k);
});

/** Every question answered at exactly the bar. */
const barState = stateWith(plan, (i) => {
  const q = plan.questions[i]!;
  return Array.from({ length: q.minEvidence ?? 1 }, (_, k) => k);
});

/** Nothing matched anywhere. */
const emptyState = stateWith(plan, () => []);

const candidate = {
  name: "Test Candidate",
  cohort: "AI Cohort — Test",
  jobRole: "Data Engineer",
  company: "Acme Health",
};

function askStub(payload: unknown): AskJson {
  return async () => ({ ok: true, data: payload });
}

const askFails: AskJson = async () => ({ ok: false, message: "no provider" });

async function buildWith(
  ask: AskJson,
  state: InterviewState,
  activePlan: InterviewPlan = plan,
  scopeDays: number[] = DAY_15_SCOPE,
) {
  return buildInterviewReport(ask, {
    plan: activePlan,
    state,
    turns: [],
    blueprint: "DAY_15",
    scopeDays,
    candidate,
    progressDay: 18,
    durationSec: 640,
  });
}

/* ---------------------------------------------------------------- tests */

async function main() {
  console.log("\nAssessment and report (plan 072, Phase 2)\n");

  /* ------------------------------------------------ question scoring */

  section("Question scoring");

  await check("clearing the evidence bar scores 70", () => {
    const q = plan.questions[1]!;
    const state = stateWith(plan, (i) =>
      i === 1 ? Array.from({ length: q.minEvidence ?? 1 }, (_, k) => k) : null,
    );
    assert.equal(scoreQuestion(q, state).score, 70);
  });

  await check("covering the whole checklist scores 100", () => {
    const q = plan.questions[1]!;
    assert.equal(scoreQuestion(q, fullState).score, 100);
  });

  await check("below the bar scores proportionally, never zero for a real attempt", () => {
    const q = plan.questions[1]!;
    const bar = q.minEvidence ?? 2;
    const state = stateWith(plan, (i) => (i === 1 ? [0] : null));
    const score = scoreQuestion(q, state).score;
    assert.equal(score, Math.round(70 * (1 / bar)));
    assert.ok(score > 0 && score < 70);
  });

  await check("matching nothing scores zero", () => {
    assert.equal(scoreQuestion(plan.questions[1]!, emptyState).score, 0);
  });

  await check("an unreached question is marked unanswered, not failed", () => {
    const q = plan.questions[5]!;
    const state = stateWith(plan, (i) => (i === 0 ? [0, 1] : null));
    const score = scoreQuestion(q, state);
    assert.equal(score.answered, false);
    assert.equal(score.score, 0);
  });

  await check("cleared escalation rungs add a small capped bonus", () => {
    const q = plan.questions[1]!;
    const rung = q.deepProbes?.find((p) => p.level === 2);
    assert.ok(rung, "fixture drift: q2 should carry a level-2 rung");

    const bar = q.minEvidence ?? 2;
    const withRung = stateWith(plan, (i) =>
      i === 1 ? Array.from({ length: bar }, (_, k) => k) : null,
    );
    withRung.evidenceByQuestionId[`${q.id}@L2`] = evidence([0, 1]);

    const score = scoreQuestion(q, withRung);
    assert.equal(score.rungsCleared, 1);
    assert.equal(score.depthReached, 2);
    assert.equal(score.score, 75);
  });

  await check("the bonus can never push a score past 100", () => {
    const q = plan.questions[1]!;
    const state = stateWith(plan, (i) =>
      i === 1
        ? Array.from({ length: q.expectedEvidence?.length ?? 0 }, (_, k) => k)
        : null,
    );
    for (const probe of q.deepProbes ?? []) {
      state.evidenceByQuestionId[`${q.id}@L${probe.level}`] = evidence([0, 1]);
    }
    assert.equal(scoreQuestion(q, state).score, 100);
  });

  /* -------------------------------------------------- module scoring */

  section("Module-wise scoring");

  await check("modules are scored from the 8-module curriculum", () => {
    const modules = scoreModules(plan, fullState, DAY_15_SCOPE);
    assert.ok(modules.length > 0);
    for (const m of modules) {
      const real = moduleForDay(m.dayRange.from);
      assert.equal(m.moduleNumber, real?.number);
      assert.equal(m.title, real?.title);
    }
  });

  await check("DAY_15 scores ONLY modules inside days 1–15", () => {
    const modules = scoreModules(plan, fullState, DAY_15_SCOPE);
    for (const m of modules) {
      assert.ok(
        m.dayRange.from <= 15,
        `module ${m.moduleNumber} starts at day ${m.dayRange.from}`,
      );
    }
    // Modules 5–8 begin at day 16 and must not appear at all.
    assert.equal(modules.filter((m) => m.moduleNumber >= 5).length, 0);
  });

  await check("DAY_31 covers the whole curriculum", () => {
    const day31 = planCohortInterview("DAY_31");
    const state31 = stateWith(day31, (i) => {
      const q = day31.questions[i]!;
      return Array.from({ length: q.expectedEvidence?.length ?? 0 }, (_, k) => k);
    });
    const modules = scoreModules(day31, state31, DAY_31_SCOPE);
    assert.equal(modules.length, 8);
    assert.ok(modules.some((m) => m.moduleNumber === 8));
  });

  await check("a module with no question reports null, never a zero", () => {
    const day31 = planCohortInterview("DAY_31");
    const state31 = stateWith(day31, () => []);
    const modules = scoreModules(day31, state31, DAY_31_SCOPE);
    const unassessed = modules.filter((m) => m.questionsAsked === 0);
    for (const m of unassessed) {
      assert.equal(m.score, null, `module ${m.moduleNumber} scored instead of null`);
      assert.ok(m.note.toLowerCase().includes("not assessed"));
    }
  });

  await check("every module score cites the questions behind it", () => {
    const modules = scoreModules(plan, fullState, DAY_15_SCOPE);
    for (const m of modules.filter((x) => x.score !== null)) {
      assert.ok(m.evidenceRefs.length > 0, `module ${m.moduleNumber} cites nothing`);
      for (const ref of m.evidenceRefs) {
        assert.ok(plan.questions.some((q) => q.id === ref));
      }
    }
  });

  await check("a scope leak is refused rather than scored", () => {
    const leaky: InterviewPlan = {
      ...plan,
      questions: [
        {
          ...plan.questions[0]!,
          sourceRef: { ...plan.questions[0]!.sourceRef, sourceDays: [22] },
        },
        ...plan.questions.slice(1),
      ],
    };
    assert.throws(() => assertScopeIntegrity(leaky, DAY_15_SCOPE), /outside the assessed scope/);
  });

  /* ---------------------------------------------- competency scoring */

  section("Competency scoring against the existing rubric");

  await check("all five rubric competencies are always reported", () => {
    const scores = plan.questions.map((q) => scoreQuestion(q, fullState));
    const competencies = assessCompetencies(scores, fullState, plan);
    assert.deepEqual(
      competencies.map((c) => c.competency).sort(),
      [
        "COMMUNICATION",
        "CONCEPTUAL",
        "PRACTICAL",
        "PROBLEM_SOLVING",
        "TECHNICAL_DEPTH",
      ],
    );
  });

  await check("rubric weights are carried through unchanged", () => {
    const scores = plan.questions.map((q) => scoreQuestion(q, fullState));
    const competencies = assessCompetencies(scores, fullState, plan);
    assert.equal(competencies.reduce((sum, c) => sum + c.weight, 0), 100);
  });

  await check("competency scores cite their questions", () => {
    const scores = plan.questions.map((q) => scoreQuestion(q, fullState));
    for (const c of assessCompetencies(scores, fullState, plan)) {
      if (c.competency === "COMMUNICATION") continue;
      assert.ok(c.evidenceRefs.length > 0, `${c.competency} cites nothing`);
    }
  });

  await check("COMMUNICATION is derived across the transcript, not scored zero", () => {
    const scores = plan.questions.map((q) => scoreQuestion(q, fullState));
    const comms = assessCompetencies(scores, fullState, plan).find(
      (c) => c.competency === "COMMUNICATION",
    );
    assert.ok(comms);
    assert.ok(comms!.score > 0, "communication scored zero for want of a question slot");
  });

  await check("a perfect interview scores 100 overall", () => {
    const scores = plan.questions.map((q) => scoreQuestion(q, fullState));
    const overall = overallFromCompetencies(
      assessCompetencies(scores, fullState, plan),
    );
    assert.equal(overall, 100);
  });

  await check("covering nothing scores zero on every assessed competency", () => {
    const scores = plan.questions.map((q) => scoreQuestion(q, emptyState));
    const competencies = assessCompetencies(scores, emptyState, plan);

    for (const c of competencies) {
      if (c.competency === "COMMUNICATION") continue;
      assert.equal(c.score, 0, `${c.competency} scored ${c.score}`);
    }

    // COMMUNICATION is deliberately NOT zero here. The candidate answered every
    // question on topic and never derailed — they simply had no substance. That
    // is worth the lowest non-zero tier, and it is the only reason the overall
    // is not a flat 0.
    const overall = overallFromCompetencies(competencies);
    assert.ok(overall > 0 && overall < 10, `overall was ${overall}`);
  });

  await check("an interview where nothing was answered scores 0", () => {
    const unanswered = stateWith(plan, () => null);
    const scores = plan.questions.map((q) => scoreQuestion(q, unanswered));
    assert.equal(
      overallFromCompetencies(assessCompetencies(scores, unanswered, plan)),
      0,
    );
  });

  await check("identical evidence always yields an identical score", () => {
    const a = overallFromCompetencies(
      assessCompetencies(
        plan.questions.map((q) => scoreQuestion(q, barState)),
        barState,
        plan,
      ),
    );
    const b = overallFromCompetencies(
      assessCompetencies(
        plan.questions.map((q) => scoreQuestion(q, barState)),
        barState,
        plan,
      ),
    );
    assert.equal(a, b);
  });

  await check("score bands map to tiers consistently", () => {
    assert.equal(scoreToTier(100), "DEMONSTRATED");
    assert.equal(scoreToTier(70), "EXPLAINED");
    assert.equal(scoreToTier(35), "CLAIMED");
    assert.equal(scoreToTier(0), "NONE");
  });

  /* ------------------------------------------ extension containment */

  section("Live progress must not contaminate milestone scoring");

  await check("EXTENSION answers do not move the overall score", async () => {
    const bank31 = getQuestionBank("DAY_31").questions[0]!;
    const withExtension: InterviewPlan = {
      ...plan,
      questions: [
        ...plan.questions,
        {
          id: bank31.id,
          order: plan.questions.length + 1,
          competency: bank31.competency,
          sourceRef: {
            source: "COHORT_CURRICULUM",
            sourceDays: bank31.sourceDays,
            label: bank31.sourceLabel,
          },
          text: bank31.text,
          llmPhrased: false,
          difficulty: bank31.difficulty,
          tier: "EXTENSION",
          mode: bank31.mode,
          expectedEvidence: bank31.expectedEvidence,
          minEvidence: bank31.minEvidence,
          maxFollowUps: bank31.maxFollowUps,
          followUpPrompt: bank31.followUpPrompt,
        },
      ],
    };

    const withoutExt = stateWith(plan, (i) =>
      Array.from({ length: plan.questions[i]!.minEvidence ?? 1 }, (_, k) => k),
    );
    const withExt: InterviewState = {
      ...withoutExt,
      evidenceByQuestionId: {
        ...withoutExt.evidenceByQuestionId,
        [bank31.id]: evidence([0, 1, 2]),
      },
    };

    const base = overallFromCompetencies(
      assessCompetencies(
        plan.questions.map((q) => scoreQuestion(q, withoutExt)),
        withoutExt,
        plan,
      ),
    );

    const report = await buildWith(askFails, withExt, withExtension);
    assert.equal(report.overall.score, base, "extension answer changed the score");
  });

  await check("EXTENSION answers are reported separately", async () => {
    const bank31 = getQuestionBank("DAY_31").questions[0]!;
    const withExtension: InterviewPlan = {
      ...plan,
      questions: [
        ...plan.questions,
        {
          id: bank31.id,
          order: 99,
          competency: bank31.competency,
          sourceRef: {
            source: "COHORT_CURRICULUM",
            sourceDays: bank31.sourceDays,
            label: bank31.sourceLabel,
          },
          text: bank31.text,
          llmPhrased: false,
          difficulty: bank31.difficulty,
          tier: "EXTENSION",
          expectedEvidence: bank31.expectedEvidence,
          minEvidence: bank31.minEvidence,
          maxFollowUps: bank31.maxFollowUps,
          followUpPrompt: bank31.followUpPrompt,
        },
      ],
    };
    const state: InterviewState = {
      ...barState,
      evidenceByQuestionId: {
        ...barState.evidenceByQuestionId,
        [bank31.id]: evidence([0, 1]),
      },
    };

    const report = await buildWith(askFails, state, withExtension);
    assert.equal(report.beyondMilestone.length, 1);
    assert.equal(report.beyondMilestone[0]!.questionId, bank31.id);
    // And no module score may reference it.
    for (const m of report.modules) {
      assert.ok(!m.evidenceRefs.includes(bank31.id));
    }
  });

  /* ------------------------------------------------ narrative safety */

  section("Narrative traceability");

  await check("an uncited strength is dropped", () => {
    const kept = filterNarrative(
      [
        { text: "Cited and real.", evidenceRefs: ["d15-q01"] },
        { text: "Uncited praise.", evidenceRefs: [] },
      ],
      new Set(["d15-q01"]),
    );
    assert.equal(kept.length, 1);
    assert.equal(kept[0]!.text, "Cited and real.");
  });

  await check("a strength citing an UNANSWERED question is dropped", () => {
    const kept = filterNarrative(
      [{ text: "Praise for work never done.", evidenceRefs: ["d15-q99"] }],
      new Set(["d15-q01"]),
    );
    assert.equal(kept.length, 0);
  });

  await check("a fabricated ref is stripped but a real one survives", () => {
    const kept = filterNarrative(
      [{ text: "Half real.", evidenceRefs: ["d15-q01", "made-up"] }],
      new Set(["d15-q01"]),
    );
    assert.deepEqual(kept[0]!.evidenceRefs, ["d15-q01"]);
  });

  await check("a model citing only fabricated questions cannot reach the report", async () => {
    const report = await buildWith(
      askStub({
        strengths: [
          { text: "Outstanding Kubernetes work.", evidenceRefs: ["totally-made-up"] },
        ],
        improvements: [
          { text: "Should revisit nothing.", evidenceRefs: ["also-fake"] },
        ],
        summary: "A summary.",
        recommendation: "A recommendation.",
      }),
      barState,
    );

    for (const item of [...report.strengths, ...report.improvements]) {
      assert.ok(!item.text.includes("Kubernetes"));
      for (const ref of item.evidenceRefs) {
        assert.ok(
          plan.questions.some((q) => q.id === ref),
          `report cites unknown question ${ref}`,
        );
      }
    }
    assert.equal(report.narrativeDegraded, true, "should be flagged as degraded");
  });

  await check("every surviving reference points at an answered question", async () => {
    const answeredIds = new Set(Object.keys(barState.evidenceByQuestionId));
    const report = await buildWith(
      askStub({
        strengths: [
          { text: "Explained chunk overlap well.", evidenceRefs: ["d15-q01"] },
        ],
        improvements: [
          { text: "Work on evaluation methodology.", evidenceRefs: ["d15-q09"] },
        ],
        summary: "Solid across the board.",
        recommendation: "Continue to day 31.",
      }),
      barState,
    );

    for (const item of [...report.strengths, ...report.improvements]) {
      for (const ref of item.evidenceRefs) {
        assert.ok(answeredIds.has(ref), `${ref} was never answered`);
      }
    }
  });

  await check("suggested days come from the question, never from the model", async () => {
    const report = await buildWith(
      askStub({
        strengths: [{ text: "Good.", evidenceRefs: ["d15-q01"] }],
        improvements: [
          { text: "Revisit chunking.", evidenceRefs: ["d15-q01"] },
        ],
        summary: "s",
        recommendation: "r",
      }),
      barState,
    );

    const item = report.improvements.find((i) => i.evidenceRefs.includes("d15-q01"));
    assert.ok(item);
    const q = plan.questions.find((x) => x.id === "d15-q01")!;
    assert.deepEqual(item!.suggestedDays, q.sourceRef.sourceDays);
  });

  await check("a model outage still produces a usable report", async () => {
    const report = await buildWith(askFails, barState);
    assert.ok(report.strengths.length > 0, "no strengths at all");
    assert.ok(report.summary.length > 0);
    assert.ok(report.recommendation.length > 0);
    assert.equal(report.narrativeDegraded, true);
  });

  /* ------------------------------------------------ report document */

  section("Report document");

  await check("the report validates against its schema", async () => {
    const report = await buildWith(askFails, barState);
    const parsed = parseReport(report);
    assert.ok(parsed.ok, parsed.ok ? "" : parsed.message);
  });

  await check("the report round-trips through JSON unchanged", async () => {
    const report = await buildWith(askFails, fullState);
    const roundTripped = parseReport(JSON.parse(JSON.stringify(report)));
    assert.ok(roundTripped.ok, roundTripped.ok ? "" : roundTripped.message);
    assert.equal(roundTripped.ok && roundTripped.data.overall.score, report.overall.score);
  });

  await check("a malformed document is refused, not stored", () => {
    const bad = parseReport({ version: 1, candidate: {} });
    assert.equal(bad.ok, false);
  });

  await check("the report carries every required section", async () => {
    const report = await buildWith(askFails, fullState);
    assert.ok(report.candidate.name.length > 0);
    assert.equal(report.milestone.blueprint, "DAY_15");
    assert.equal(report.milestone.scopeFrom, 1);
    assert.equal(report.milestone.scopeTo, 15);
    assert.equal(report.overall.durationSec, 640);
    assert.ok(report.modules.length > 0);
    assert.equal(report.competencies.length, 5);
    assert.ok(report.evidence.length > 0);
    assert.ok(report.summary.length > 0);
    assert.ok(report.recommendation.length > 0);
  });

  await check("live progress appears as context but not in the scope", async () => {
    const report = await buildWith(askFails, barState);
    assert.equal(report.milestone.progressDay, 18);
    assert.equal(report.milestone.scopeTo, 15);
  });

  await check("evidence rows quote the candidate verbatim", async () => {
    const report = await buildWith(askFails, fullState);
    const row = report.evidence.find((r) => r.answered);
    assert.ok(row);
    const spoken = fullState.transcript.find(
      (l) => l.role === "candidate" && l.questionId === row!.questionId,
    );
    assert.ok(spoken);
    assert.ok(spoken!.text.startsWith(row!.answerExcerpt.replace(/…$/, "")));
  });

  await check("skills are checklist items, classified, never invented", async () => {
    const report = await buildWith(askFails, barState);
    const allExpected = new Set(
      plan.questions.flatMap((q) => q.expectedEvidence ?? []),
    );

    for (const s of report.skills) {
      assert.ok(allExpected.has(s.skill), `invented skill: ${s.skill}`);
      assert.ok(
        ["STRONG", "DEVELOPING", "WEAK", "NOT_DEMONSTRATED", "NOT_ASSESSED"].includes(
          s.level,
        ),
        `bad level ${s.level}`,
      );
    }
    assert.ok(report.skills.some((s) => s.level === "STRONG"));
  });

  await check("a skill is never called absent unless its question was answered", async () => {
    // Only the first question is answered; everything else was never reached,
    // so its skills must read NOT_ASSESSED rather than as a shortcoming.
    const partial = stateWith(plan, (i) =>
      i === 0 ? [0, 1] : null,
    );
    const report = await buildWith(askFails, partial);

    const unreachedIds = new Set(
      plan.questions.slice(1).map((q) => q.id),
    );
    for (const s of report.expectedButNotDemonstrated) {
      for (const ref of s.evidenceRefs) {
        assert.ok(
          !unreachedIds.has(ref),
          `${s.skill} blamed on unreached question ${ref}`,
        );
      }
    }
  });

  await check("every core question gets a full assessment with a reason", async () => {
    const report = await buildWith(askFails, barState);
    assert.equal(
      report.questionAssessments.length,
      plan.questions.filter((q) => (q.tier ?? "CORE") === "CORE").length,
    );
    for (const q of report.questionAssessments) {
      assert.ok(q.whyThisScore.length > 0, `${q.questionId} has no reason`);
      assert.ok(q.scoreOutOfTen >= 0 && q.scoreOutOfTen <= 10);
      assert.equal(q.scoreOutOfTen, Math.round(q.score) / 10);
      assert.ok(q.skillsTested.length > 0);
    }
  });

  await check("an unassessed module is never scored", async () => {
    const report = await buildWith(askFails, barState);
    for (const m of report.modules) {
      if (!m.assessed) {
        assert.equal(m.score, null);
        assert.equal(m.scoreOutOfTen, null);
      }
    }
  });

  await check("assessment status separates a low score from a broken run", async () => {
    const clean = await buildWith(askFails, emptyState);
    // Zero evidence, but no degraded turns: a valid low assessment, and the
    // narrative fallback alone must not be reported as a broken assessment.
    assert.notEqual(clean.assessmentStatus.status, "DEGRADED");

    const degradedTurns = Array.from({ length: 4 }, (_, i) => ({
      turnIndex: i, questionId: "d15-q03", tier: "CORE", depthLevel: 1,
      action: "NEXT_QUESTION", promptText: "", answerText: "x",
      evidence: null, degraded: true,
    }));
    const broken = await buildInterviewReport(askFails, {
      plan, state: barState, turns: degradedTurns, blueprint: "DAY_15",
      scopeDays: DAY_15_SCOPE, candidate, progressDay: 18, durationSec: 640,
    });
    assert.equal(broken.assessmentStatus.status, "DEGRADED");
    assert.equal(broken.assessmentStatus.degradedTurns, 4);
  });

  /* ---------------------------------------------- exit thresholds */

  section("Exit thresholds (core questions, never turns)");

  const coreCount = plan.questions.filter(
    (q) => (q.tier ?? "CORE") === "CORE",
  ).length;

  await check("progress counts CORE questions, not turns", () => {
    // Two answered core questions plus a pile of probe evidence: the probes
    // must not inflate progress, or the halfway warning fires far too early.
    const state = stateWith(plan, (i) => (i < 2 ? [0] : null));
    state.evidenceByQuestionId["d15-q03@L2"] = evidence([0, 1]);
    state.evidenceByQuestionId["d15-q03@L3"] = evidence([0, 1]);
    state.evidenceByQuestionId["d15-q09@L2"] = evidence([0, 1]);

    const progress = coreProgressFor(plan, state);
    assert.equal(progress.answered, 2);
    assert.equal(progress.total, coreCount);
  });

  await check("below halfway stays under the threshold", () => {
    const under = Math.max(0, Math.floor(coreCount / 2) - 1);
    const progress = coreProgressFor(
      plan,
      stateWith(plan, (i) => (i < under ? [0] : null)),
    );
    assert.ok(progress.ratio < 0.5, `ratio was ${progress.ratio}`);
  });

  await check("exactly half trips the harder warning", () => {
    const half = Math.ceil(coreCount / 2);
    const progress = coreProgressFor(
      plan,
      stateWith(plan, (i) => (i < half ? [0] : null)),
    );
    assert.ok(progress.ratio >= 0.5, `ratio was ${progress.ratio}`);
  });

  await check("a fresh interview is at zero", () => {
    const progress = coreProgressFor(plan, stateWith(plan, () => null));
    assert.equal(progress.answered, 0);
    assert.equal(progress.ratio, 0);
  });

  await check("a finished interview is at one", () => {
    const progress = coreProgressFor(plan, stateWith(plan, () => [0]));
    assert.equal(progress.ratio, 1);
  });

  /* ------------------------------------------ internal consistency */

  section("Internal consistency (regression: evidence must not be lost)");

  await check("an answer covering every expected item scores 100", () => {
    const q = plan.questions[1]!;
    const all = Array.from(
      { length: q.expectedEvidence!.length },
      (_, i) => i,
    );
    const state = stateWith(plan, (i) => (i === 1 ? all : null));

    const score = scoreQuestion(q, state);
    assert.equal(score.judged, true);
    assert.equal(score.matched, q.expectedEvidence!.length);
    assert.equal(score.score, 100);
  });

  await check("the report marks every item demonstrated and none missing", async () => {
    const q = plan.questions[1]!;
    const all = Array.from({ length: q.expectedEvidence!.length }, (_, i) => i);
    const state = stateWith(plan, (i) => (i === 1 ? all : null));

    const report = await buildWith(askFails, state);
    const assessed = report.questionAssessments.find(
      (a) => a.questionId === q.id,
    );
    assert.ok(assessed, "question missing from the report");
    assert.equal(assessed!.scoreOutOfTen, 10);
    assert.deepEqual(assessed!.demonstrated, q.expectedEvidence);
    assert.deepEqual(assessed!.missing, []);

    // The exact contradiction that was reported: an item may never appear in
    // both lists at once.
    for (const item of assessed!.demonstrated) {
      assert.ok(!assessed!.missing.includes(item), `${item} in both lists`);
    }
  });

  await check("a partial answer splits the checklist correctly", async () => {
    const q = plan.questions[1]!;
    const state = stateWith(plan, (i) => (i === 1 ? [0, 2] : null));

    const report = await buildWith(askFails, state);
    const a = report.questionAssessments.find((x) => x.questionId === q.id)!;

    assert.deepEqual(a.demonstrated, [
      q.expectedEvidence![0],
      q.expectedEvidence![2],
    ]);
    assert.ok(a.missing.includes(q.expectedEvidence![1]!));
    assert.ok(!a.missing.includes(q.expectedEvidence![0]!));
    assert.ok(a.judged);
    assert.ok(a.scoreOutOfTen > 0 && a.scoreOutOfTen < 10);
  });

  await check("no question ever lists an item as both demonstrated and missing", async () => {
    const report = await buildWith(askFails, barState);
    for (const a of report.questionAssessments) {
      for (const item of a.demonstrated) {
        assert.ok(
          !a.missing.includes(item),
          `${a.questionId}: "${item}" is both demonstrated and missing`,
        );
      }
    }
  });

  /* ------------------------------- unjudged answers (provider outage) */

  section("Unjudged answers are never reported as failures");

  /** Evidence with NO checklist claim — what the deterministic fallback records. */
  function unjudged(): AnswerEvidence {
    return {
      conceptualFound: true,
      practicalFound: false,
      tradeoffsFound: false,
      flaggedIssues: [],
      reasoning: "Structural heuristic — no semantic model was available.",
      // matchedEvidence deliberately absent
    };
  }

  function unjudgedState(): InterviewState {
    const base = stateWith(plan, () => null);
    const evidenceByQuestionId: Record<string, AnswerEvidence> = {};
    const transcript: InterviewState["transcript"] = [];
    for (const q of plan.questions) {
      evidenceByQuestionId[q.id] = unjudged();
      transcript.push({
        role: "candidate",
        text: "An answer that plainly contains the expected evidence.",
        questionId: q.id,
        ts: Date.now(),
      });
    }
    return { ...base, evidenceByQuestionId, transcript };
  }

  await check("an unjudged answer is not scored zero, it is not scored at all", () => {
    const score = scoreQuestion(plan.questions[1]!, unjudgedState());
    assert.equal(score.answered, true);
    assert.equal(score.judged, false);
  });

  await check("an unjudged question lists NOTHING as missing", async () => {
    const report = await buildWith(askFails, unjudgedState());
    for (const a of report.questionAssessments) {
      assert.equal(a.judged, false);
      assert.equal(a.strength, "NOT_JUDGED");
      assert.deepEqual(
        a.missing,
        [],
        `${a.questionId} claimed missing evidence without a verdict`,
      );
      assert.deepEqual(a.demonstrated, []);
    }
  });

  await check("unjudged answers do not drag modules to zero", async () => {
    const report = await buildWith(askFails, unjudgedState());
    for (const m of report.modules) {
      assert.equal(m.score, null, `module ${m.moduleNumber} scored on no verdict`);
      assert.equal(m.assessed, false);
    }
  });

  await check("unjudged skills are NOT_ASSESSED, never WEAK", async () => {
    const report = await buildWith(askFails, unjudgedState());
    assert.equal(report.expectedButNotDemonstrated.length, 0);
    assert.ok(report.skills.every((s) => s.level === "NOT_ASSESSED"));
  });

  await check("a fully unjudged interview reports DEGRADED", async () => {
    const report = await buildWith(askFails, unjudgedState());
    assert.equal(report.assessmentStatus.status, "DEGRADED");
    assert.ok(report.assessmentStatus.unjudgedQuestions > 0);
  });

  await check("an explicit empty match IS still a real zero", async () => {
    // The evaluator looked and found nothing. That is a verdict, and it must
    // still count — this fix must not become a way to dodge a bad answer.
    const state = stateWith(plan, () => []);
    const report = await buildWith(askFails, state);
    const a = report.questionAssessments[0]!;
    assert.equal(a.judged, true);
    assert.equal(a.scoreOutOfTen, 0);
    assert.ok(a.missing.length > 0);
  });

  console.log(`\n${passed} checks passed, ${failed} failed.\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nSUITE CRASHED\n", error);
  process.exitCode = 1;
});
