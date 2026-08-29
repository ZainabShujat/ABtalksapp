/**
 * Deterministic checks for the interview platform's ENGINE layer (plan 103
 * Phase 3): scoring, report assembly, narrative filtering and validation.
 *
 * SCOPE. The first sections are pure — no database, no network, no model. The
 * final section is a DATABASE-BACKED E2E against the demo database, exercising
 * the real service and repository. It is skipped when DATABASE_URL is absent.
 * It creates two throwaway users and deletes them, and their attempts, at the
 * end.
 *
 * Grading uses the mock LLM provider, so results are deterministic and offline.
 *
 * Run: npx tsx scripts/verify-mock-interview-e2e.ts
 */
import assert from "node:assert/strict";

import { getStartableDomain } from "../src/features/interview/platform/domains";
import {
  buildPlatformPlan,
  platformContextOf,
} from "../src/features/interview/platform/planner";
import {
  assessPlatformCompetencies,
  assessSections,
  overallFromPlatformCompetencies,
  platformProgress,
} from "../src/features/interview/platform/scoring";
import {
  assembleAssessmentReport,
  filterNarrative,
} from "../src/features/interview/platform/report-assembly";
import {
  buildAssessmentReport,
  parseAssessmentReport,
} from "../src/features/interview/platform/report";
import { assessmentReportSchema } from "../src/lib/validations/mock-interview";
import { appendLine, createInitialState } from "../src/features/interview/state";
import type { TurnRow } from "../src/features/interview/report-analysis";
import type {
  AnswerEvidence,
  InterviewState,
} from "../src/features/interview/types";

let checks = 0;
function check(label: string, fn: () => void): void {
  fn();
  checks += 1;
  console.log(`  ok  ${label}`);
}

const domain = getStartableDomain("ai-fluency");
assert.notEqual(domain, null, "ai-fluency must be startable");
const plan = buildPlatformPlan(domain!, { candidateFirstName: "Zainab" });
const ctx = platformContextOf(plan)!;

/** A state in which the first `n` questions were answered. */
function stateWith(
  n: number,
  matched: (index: number) => number[] | undefined,
): InterviewState {
  let s: InterviewState = { ...createInitialState(), status: "IN_PROGRESS" };
  plan.questions.slice(0, n).forEach((q, i) => {
    const evidence = {
      conceptualFound: true,
      practicalFound: false,
      tradeoffsFound: false,
      flaggedIssues: [],
      reasoning: "test",
      relevance: "ON_TOPIC",
      ...(matched(i) === undefined ? {} : { matchedEvidence: matched(i) }),
    } as AnswerEvidence;
    s = appendLine(s, "interviewer", q.text, q.id);
    s = appendLine(s, "candidate", `answer to ${q.id}`, q.id);
    s = {
      ...s,
      evidenceByQuestionId: { ...s.evidenceByQuestionId, [q.id]: evidence },
    };
  });
  return s;
}

function turnsFor(s: InterviewState): TurnRow[] {
  return Object.keys(s.evidenceByQuestionId).map((questionId, i) => ({
    turnIndex: i,
    questionId,
    tier: "CORE",
    depthLevel: 1,
    action: "NEXT_QUESTION",
    promptText: "q",
    answerText: "a",
    evidence: s.evidenceByQuestionId[questionId]!,
    degraded: false,
  }));
}

/* ------------------------------------------------------------------ scoring */

console.log("\nplatform scoring");

check("a fully covered interview scores near the top", () => {
  const s = stateWith(plan.questions.length, () => [0, 1, 2]);
  const overall = overallFromPlatformCompetencies(
    assessPlatformCompetencies(plan, s, ctx.rubric.id),
  );
  assert.equal(overall >= 85, true, `overall was ${overall}`);
  assert.equal(overall <= 100, true);
});

check("an empty interview scores 0 without dividing by zero", () => {
  const comps = assessPlatformCompetencies(
    plan,
    createInitialState(),
    ctx.rubric.id,
  );
  assert.equal(overallFromPlatformCompetencies(comps), 0);
  assert.equal(
    comps.every((c) => c.unassessed),
    true,
  );
});

check("UNJUDGED answers are excluded, not scored as zero", () => {
  // `matchedEvidence` absent = the evaluator never judged it (provider outage).
  const s = stateWith(1, () => undefined);
  const q = plan.questions[0]!;
  const comps = assessPlatformCompetencies(plan, s, ctx.rubric.id);
  const own = comps.find((c) => c.competencyId === q.platformCompetencyId)!;
  assert.equal(own.unassessed, true, "an unjudged answer must not be assessed");
  assert.match(own.justification, /evaluator was unavailable/);
});

check("an unjudged answer does not drag the overall score down", () => {
  const judged = overallFromPlatformCompetencies(
    assessPlatformCompetencies(plan, stateWith(2, () => [0, 1, 2]), ctx.rubric.id),
  );
  // Same two answers, plus a third the evaluator never judged.
  let s = stateWith(2, () => [0, 1, 2]);
  const third = plan.questions[2]!;
  s = {
    ...s,
    evidenceByQuestionId: {
      ...s.evidenceByQuestionId,
      [third.id]: {
        conceptualFound: true,
        practicalFound: false,
        tradeoffsFound: false,
        flaggedIssues: [],
        reasoning: "degraded",
      } as AnswerEvidence,
    },
  };
  const withUnjudged = overallFromPlatformCompetencies(
    assessPlatformCompetencies(plan, s, ctx.rubric.id),
  );
  assert.equal(
    withUnjudged >= judged,
    true,
    `unjudged answer lowered the score from ${judged} to ${withUnjudged}`,
  );
});

check("competency ids come from the PLATFORM rubric, not the engine union", () => {
  const s = stateWith(plan.questions.length, () => [0]);
  const ids = assessPlatformCompetencies(plan, s, ctx.rubric.id)
    .map((c) => c.competencyId)
    .sort();
  assert.deepEqual(
    ids,
    ctx.rubric.competencies.map((c) => c.id).sort(),
  );
  for (const engine of [
    "CONCEPTUAL",
    "PRACTICAL",
    "PROBLEM_SOLVING",
    "TECHNICAL_DEPTH",
    "COMMUNICATION",
  ]) {
    assert.equal(ids.includes(engine), false, `${engine} leaked into the rubric`);
  }
});

check("an unanswered section reports null, never 0", () => {
  const s = stateWith(1, () => [0, 1, 2]);
  const sections = assessSections(plan, s, ctx.sections);
  const untouched = sections.filter((x) => x.questionsAnswered === 0);
  assert.equal(untouched.length > 0, true, "expected an untouched section");
  for (const x of untouched) {
    assert.equal(x.score, null, `${x.sectionId} scored ${x.score}, not null`);
    assert.match(x.note, /Not assessed/);
  }
});

check("progress counts questions, not turns", () => {
  const p = platformProgress(plan, stateWith(3, () => [0]));
  assert.equal(p.answered, 3);
  assert.equal(p.total, plan.questions.length);
  assert.equal(p.ratio, 3 / plan.questions.length);
});

/* ------------------------------------------------------ narrative filtering */

console.log("\nnarrative filtering");

check("an item citing an unanswered question is dropped entirely", () => {
  const out = filterNarrative(
    [
      { text: "real", evidenceRefs: ["aif-1"] },
      { text: "hallucinated", evidenceRefs: ["aif-999"] },
      { text: "mixed", evidenceRefs: ["aif-1", "aif-999"] },
      { text: "uncited", evidenceRefs: [] },
      { text: "   ", evidenceRefs: ["aif-1"] },
    ],
    new Set(["aif-1"]),
  );
  assert.deepEqual(
    out.map((i) => i.text),
    ["real", "mixed"],
  );
  assert.deepEqual(
    out[1]!.evidenceRefs,
    ["aif-1"],
    "an unresolvable ref must be stripped from a surviving item",
  );
});

/* ------------------------------------------------ assembly and validation */

console.log("\nreport assembly + validation");

check("an assembled report validates against the stored-document schema", () => {
  const s = stateWith(plan.questions.length, () => [0, 1]);
  const report = assembleAssessmentReport({
    plan,
    context: ctx,
    state: s,
    candidate: { name: "Zainab" },
    attemptNumber: 2,
    durationSec: 640,
    turns: turnsFor(s),
    narrative: {
      strengths: [{ text: "s", evidenceRefs: ["aif-1"] }],
      improvements: [
        { text: "i", evidenceRefs: ["aif-1"], suggestedSections: [] },
      ],
      summary: "ok",
      recommendation: "practise",
      degraded: false,
    },
  });

  const parsed = parseAssessmentReport(report);
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.message);
  assert.equal(assessmentReportSchema.safeParse(report).success, true);
});

check("the report carries coverage, and no cohort milestone or day scope", () => {
  const s = stateWith(2, () => [0]);
  const report = assembleAssessmentReport({
    plan,
    context: ctx,
    state: s,
    candidate: { name: "Z" },
    attemptNumber: 1,
    durationSec: 100,
    turns: turnsFor(s),
    narrative: {
      strengths: [],
      improvements: [],
      summary: "x",
      recommendation: "y",
      degraded: true,
    },
  });
  const json = JSON.stringify(report);
  assert.equal(report.coverage.domainSlug, "ai-fluency");
  assert.equal(report.coverage.attemptNumber, 1);
  assert.equal("milestone" in report, false, "cohort milestone block appeared");
  assert.equal("modules" in report, false, "cohort modules appeared");
  assert.equal(json.includes("scopeFrom"), false);
  assert.equal(json.includes("Infinity"), false, "empty day scope leaked Infinity");
  assert.equal(Number.isFinite(report.overall.score), true);
});

check("a report with zero answers still validates", () => {
  const report = assembleAssessmentReport({
    plan,
    context: ctx,
    state: createInitialState(),
    candidate: { name: "Z" },
    attemptNumber: 1,
    durationSec: 5,
    turns: [],
    narrative: {
      strengths: [],
      improvements: [],
      summary: "none",
      recommendation: "none",
      degraded: true,
    },
  });
  assert.equal(parseAssessmentReport(report).ok, true);
  assert.equal(report.overall.score, 0);
  assert.equal(report.narrativeDegraded, true);
});

check("a malformed document is refused by the parse boundary", () => {
  assert.equal(parseAssessmentReport({ version: 1 }).ok, false);
  assert.equal(parseAssessmentReport(null).ok, false);
  assert.equal(parseAssessmentReport({ version: 99 }).ok, false);
  assert.equal(parseAssessmentReport("not an object").ok, false);
});

/* --------------------------------------------- narrative generation (stub) */

/**
 * Wrapped in a function rather than run at top level: `tsx` transforms these
 * scripts to CJS, which has no top-level await.
 */
async function narrativeChecks(): Promise<void> {
console.log("\nnarrative generation (stub provider — no network)");

const base = {
  plan,
  context: ctx,
  state: stateWith(plan.questions.length, () => [0, 1]),
  candidate: { name: "Zainab" },
  attemptNumber: 1,
  durationSec: 700,
  turns: turnsFor(stateWith(plan.questions.length, () => [0, 1])),
};

let captured = "";
const degraded = await buildAssessmentReport(async ({ system, user }) => {
  captured = `${system}\n${user}`;
  return { ok: false, message: "provider down" };
}, base);

check("the prompt carries evidence but no computed score", () => {
  assert.equal(captured.includes("Covered:"), true);
  assert.equal(captured.includes("Missed:"), true);
  assert.equal(
    captured.includes("must never state, guess, or imply one"),
    true,
  );
  assert.equal(
    /scoreOutOfTen|overallScore|"weight"|readiness/.test(captured),
    false,
    "a computed score leaked into the narrative prompt",
  );
});

check("a provider failure degrades to deterministic prose, still valid", () => {
  assert.equal(degraded.narrativeDegraded, true);
  assert.equal(degraded.summary.length > 0, true);
  assert.equal(degraded.recommendation.length > 0, true);
  assert.equal(parseAssessmentReport(degraded).ok, true);
});

const hallucinated = await buildAssessmentReport(
  async () => ({
    ok: true,
    data: {
      strengths: [
        { text: "cited a real question", evidenceRefs: ["aif-1"] },
        { text: "praised work that never happened", evidenceRefs: ["ghost-q"] },
      ],
      improvements: [{ text: "gap", evidenceRefs: ["aif-2"] }],
      summary: "went well",
      recommendation: "keep going",
    },
  }),
  base,
);

check("a model claim citing a fake question id never reaches the document", () => {
  const texts = hallucinated.strengths.map((x) => x.text);
  assert.equal(texts.includes("cited a real question"), true);
  assert.equal(texts.includes("praised work that never happened"), false);
  assert.equal(JSON.stringify(hallucinated).includes("ghost-q"), false);
});

check("suggestedSections come from provenance, never from the model", () => {
  for (const item of hallucinated.improvements) {
    for (const section of item.suggestedSections) {
      assert.equal(
        ctx.sections.some((x) => x.id === section),
        true,
        `bogus section ${section}`,
      );
    }
  }
});

check("the model cannot influence any number in the document", () => {
  const s = stateWith(plan.questions.length, () => [0, 1]);
  const deterministic = assembleAssessmentReport({
    ...base,
    state: s,
    turns: turnsFor(s),
    narrative: {
      strengths: [],
      improvements: [],
      summary: "",
      recommendation: "",
      degraded: true,
    },
  });
  // Same evidence, wildly different prose → identical scores.
  assert.equal(hallucinated.overall.score, deterministic.overall.score);
  assert.deepEqual(
    hallucinated.competencies.map((c) => c.score),
    deterministic.competencies.map((c) => c.score),
  );
  assert.deepEqual(
    hallucinated.sections.map((x) => x.score),
    deterministic.sections.map((x) => x.score),
  );
});

}

/* ==========================================================================
 * DATABASE-BACKED E2E
 *
 * Exercises the REAL service and repository against the demo database, rather
 * than a replica of them — which is the only way these assertions mean
 * anything. `service.ts` and `repository.ts` both `import "server-only"`, a
 * module that throws outside a React Server Component, so they are loaded
 * through a require hook that resolves `server-only` to a no-op. The hook is
 * scoped to this script and affects nothing else.
 *
 * Skipped automatically when DATABASE_URL is absent, so the pure checks above
 * still run in an environment with no database.
 * ======================================================================== */

async function dbChecks(): Promise<void> {
  // `tsx` does not read `.env` the way the Prisma CLI does, so load it the same
  // way the other scripts in this folder do. `.env` is deliberate, not
  // `.env.local`: it is the file the Prisma CLI itself resolves, so this script
  // and `prisma migrate` can never disagree about which database they mean.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require("dotenv") as typeof import("dotenv")).config({ path: ".env" });

  if (!process.env.DATABASE_URL) {
    console.log("\ndatabase-backed E2E: SKIPPED (no DATABASE_URL)\n");
    return;
  }

  const host = /@([^/?]+)\//.exec(process.env.DATABASE_URL)?.[1] ?? "(unknown)";
  console.log(`\ndatabase-backed E2E target: ${host}`);

  // Deterministic, offline grading. A real provider would make these
  // assertions depend on a network call and on model behaviour.
  process.env.INTERVIEW_LLM_PROVIDER = "mock";

  // `server-only` throws on import outside a React Server Component. Seed the
  // require cache with an already-loaded empty module for it, so the real
  // `service.ts` and `repository.ts` can be exercised here rather than a
  // replica of them. Nothing else is affected, and it is undone in `finally`.
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  } as unknown as NodeJS.Module;

  /* eslint-disable @typescript-eslint/no-require-imports */
  const { PrismaClient } = require("@prisma/client");
  const service =
    require("../src/features/interview/platform/service") as typeof import("../src/features/interview/platform/service");
  const repo =
    require("../src/features/interview/platform/repository") as typeof import("../src/features/interview/platform/repository");
  /* eslint-enable @typescript-eslint/no-require-imports */

  const prisma = new PrismaClient();
  const stamp = Date.now();
  const emailA = `mock-e2e-a-${stamp}@abtalks.dev`;
  const emailB = `mock-e2e-b-${stamp}@abtalks.dev`;

  console.log("\ndatabase-backed E2E (demo database)");

  const userA = await prisma.user.create({
    data: { email: emailA, name: "Test Candidate" },
    select: { id: true },
  });
  const userB = await prisma.user.create({
    data: { email: emailB, name: "Other Candidate" },
    select: { id: true },
  });

  try {
    /* ---------------------------------------------------------- creation */

    const started = await service.startAttempt(userA.id, "ai-fluency");
    assert.equal(started.ok, true, started.ok ? "" : started.message);
    if (!started.ok) throw new Error("start failed");
    const attempt1 = started.data.attemptId;

    check("first attempt is created with attemptNumber 1", () => {
      assert.equal(started.data.attemptNumber, 1);
      assert.equal(started.data.domainSlug, "ai-fluency");
      assert.equal(started.data.prompt.length > 0, true);
      assert.deepEqual(started.data.capabilities, ["VOICE"]);
    });

    const row1 = await prisma.mockInterview.findUnique({
      where: { id: attempt1 },
      select: {
        userId: true,
        packId: true,
        packVersion: true,
        capabilities: true,
        status: true,
        plan: true,
      },
    });
    check("packRef and capabilities are frozen on the row", () => {
      assert.equal(row1.userId, userA.id);
      assert.equal(row1.packId, "ai-fluency");
      assert.equal(row1.packVersion, 1);
      assert.deepEqual(row1.capabilities, ["VOICE"]);
      assert.equal(row1.status, "IN_PROGRESS");
    });

    /* ------------------------------------------------- ownership isolation */

    const asB = await repo.loadActiveAttempt(attempt1, userB.id);
    const reportAsB = await repo.loadReport(attempt1, userB.id);
    const turnsAsB = await repo.loadTurns(attempt1, userB.id);
    check("attempt, turns and report are invisible to another user", () => {
      assert.equal(asB, null, "userB could load userA's attempt");
      assert.equal(reportAsB, null, "userB could load userA's report");
      assert.deepEqual(turnsAsB, [], "userB could read userA's turns");
    });

    const answerAsB = await service.recordAnswer(userB.id, attempt1, "aif-1", {
      text: "trying to answer someone else's interview",
    });
    const finishAsB = await service.finishAttempt(userB.id, attempt1);
    const abandonAsB = await service.abandonAttempt(userB.id, attempt1);
    check("another user cannot answer, finish or abandon this attempt", () => {
      assert.equal(answerAsB.ok, false);
      assert.equal(finishAsB.ok, false);
      assert.equal(abandonAsB.ok, false);
    });

    /* -------------------------------------------------- turn persistence */

    let openQuestionId = started.data.question.id;
    let answeredQuestions = 0;
    for (let i = 0; i < 12 && answeredQuestions < 4; i += 1) {
      const res = await service.recordAnswer(userA.id, attempt1, openQuestionId, {
        text:
          "It predicts the next piece of text from patterns it learned in " +
          "training, rather than looking an answer up in a database. I used it " +
          "last week to draft a summary and had to correct two figures it " +
          "invented, so I check anything numeric against the source.",
      });
      assert.equal(res.ok, true, res.ok ? "" : res.message);
      if (!res.ok) break;
      answeredQuestions = res.data.progress.answered;
      if (res.data.finished || !res.data.question) break;
      openQuestionId = res.data.question.id;
    }

    const turns = await repo.loadTurns(attempt1, userA.id);
    check("turns persist in order with prompt, answer and evidence", () => {
      assert.equal(turns.length > 0, true, "no turns were written");
      turns.forEach((t, i) => assert.equal(t.turnIndex, i, "turnIndex gap"));
      assert.equal(turns.every((t) => t.answerText.length > 0), true);
      assert.equal(turns.every((t) => typeof t.sectionId === "string"), true);
    });

    check("at least 3 questions were answered", () => {
      assert.equal(
        answeredQuestions >= 3,
        true,
        `only ${answeredQuestions} answered`,
      );
    });

    /* -------------------------------------------- completion + report */

    const finished = await service.finishAttempt(userA.id, attempt1);
    assert.equal(finished.ok, true, finished.ok ? "" : finished.message);
    if (!finished.ok) throw new Error("finish failed");

    const completedRow = await prisma.mockInterview.findUnique({
      where: { id: attempt1 },
      select: {
        status: true,
        overallScore: true,
        competencyScores: true,
        durationSec: true,
        evaluatedAt: true,
      },
    });
    check("the attempt is COMPLETED with denormalised scores", () => {
      assert.equal(completedRow.status, "COMPLETED");
      assert.equal(typeof completedRow.overallScore, "number");
      assert.notEqual(completedRow.competencyScores, null);
      assert.notEqual(completedRow.evaluatedAt, null);
    });

    const loaded = await service.getAttemptReport(userA.id, attempt1);
    check("the report persists and validates on read", () => {
      assert.equal(loaded.ok, true, loaded.ok ? "" : loaded.message);
      if (!loaded.ok) return;
      assert.equal(loaded.data.report.coverage.domainSlug, "ai-fluency");
      assert.equal(loaded.data.report.coverage.attemptNumber, 1);
      assert.equal(parseAssessmentReport(loaded.data.report).ok, true);
    });

    const again = await service.finishAttempt(userA.id, attempt1);
    const reportAfter = await service.getAttemptReport(userA.id, attempt1);
    check("a duplicate finish returns the stored result, unchanged", () => {
      assert.equal(again.ok, true, "duplicate finish should be answered");
      assert.equal(loaded.ok && reportAfter.ok, true);
      if (loaded.ok && reportAfter.ok) {
        assert.equal(
          reportAfter.data.generatedAt.getTime(),
          loaded.data.generatedAt.getTime(),
          "the report was regenerated by a duplicate finish",
        );
      }
    });

    /* --------------------------------------------------------- retake */

    const retake = await service.startAttempt(userA.id, "ai-fluency");
    check("retaking the same domain creates attemptNumber 2", () => {
      assert.equal(retake.ok, true, retake.ok ? "" : retake.message);
      if (retake.ok) assert.equal(retake.data.attemptNumber, 2);
    });
    if (!retake.ok) throw new Error("retake failed");
    const attempt2 = retake.data.attemptId;

    /* -------------------------------------------------------- abandon */

    const abandoned = await service.abandonAttempt(userA.id, attempt2);
    const abandonedRow = await prisma.mockInterview.findUnique({
      where: { id: attempt2 },
      select: { status: true, id: true },
    });
    check("an abandoned attempt is marked, not deleted", () => {
      assert.equal(abandoned.ok, true);
      assert.notEqual(abandonedRow, null, "the row was deleted");
      assert.equal(abandonedRow.status, "ABANDONED");
    });

    /* ------------------------------------ the 3-answer scoring threshold */

    const thin = await service.startAttempt(userA.id, "ai-fluency");
    if (!thin.ok) throw new Error("thin start failed");
    const attempt3 = thin.data.attemptId;

    check("attemptNumber increments across abandoned attempts too", () => {
      assert.equal(thin.data.attemptNumber, 3);
    });

    const one = await service.recordAnswer(userA.id, attempt3, thin.data.question.id, {
      text: "It predicts text rather than retrieving a stored answer.",
    });
    assert.equal(one.ok, true);

    const refused = await service.finishAttempt(userA.id, attempt3);
    check("fewer than 3 answered questions cannot produce a scored report", () => {
      assert.equal(refused.ok, false, "a 1-answer attempt produced a report");
      if (!refused.ok) {
        assert.match(refused.message, /at least 3 answered questions/);
      }
    });

    const thinRow = await prisma.mockInterview.findUnique({
      where: { id: attempt3 },
      select: { status: true, invalidReason: true, report: { select: { id: true } } },
    });
    check("the refused attempt is INVALID and has no report", () => {
      assert.equal(thinRow.status, "INVALID");
      assert.equal(thinRow.report, null, "a report was stored for a thin attempt");
      assert.match(thinRow.invalidReason ?? "", /3 answers needed/);
    });

    /* ----------------------- L2/L3 evidence must not count as questions */

    const depth = await service.startAttempt(userA.id, "ai-fluency");
    if (!depth.ok) throw new Error("depth start failed");
    const attempt4 = depth.data.attemptId;

    // One question answered, plus rung evidence under `@L2` and `@L3` for the
    // SAME question. Five evidence keys, one answered question.
    const live = await repo.loadActiveAttempt(attempt4, userA.id);
    const qid = depth.data.question.id;
    const ev = {
      conceptualFound: true,
      practicalFound: true,
      tradeoffsFound: true,
      flaggedIssues: [],
      reasoning: "seeded",
      matchedEvidence: [0, 1],
      relevance: "ON_TOPIC",
    };
    const seeded = {
      ...live.state,
      evidenceByQuestionId: {
        [qid]: ev,
        [`${qid}@L2`]: ev,
        [`${qid}@L3`]: ev,
      },
    };
    await repo.saveTurn(attempt4, userA.id, seeded);

    const depthRefused = await service.finishAttempt(userA.id, attempt4);
    check("L2/L3 evidence from ONE question does not satisfy the 3-question bar", () => {
      assert.equal(
        Object.keys(seeded.evidenceByQuestionId).length,
        3,
        "test setup should produce 3 evidence KEYS",
      );
      assert.equal(
        depthRefused.ok,
        false,
        "3 evidence keys from 1 question wrongly produced a scored report",
      );
      if (!depthRefused.ok) {
        assert.match(depthRefused.message, /you answered 1/);
      }
    });

    /* ------------------------------------------------------------ history */

    const history = await service.getHistory(userA.id);
    check("history lists this user's attempts and nobody else's", () => {
      assert.equal(history.ok, true);
      if (!history.ok) return;
      const ids = history.data.map((h) => h.id);
      assert.equal(ids.includes(attempt1), true);
      assert.equal(ids.includes(attempt2), true);
      assert.equal(
        history.data.every((h) => h.domainLabel.length > 0),
        true,
      );
    });

    const historyB = await service.getHistory(userB.id);
    check("another user's history is empty", () => {
      assert.equal(historyB.ok, true);
      if (historyB.ok) assert.equal(historyB.data.length, 0);
    });
  } finally {
    // Cascades to turns and reports.
    await prisma.mockInterview.deleteMany({
      where: { userId: { in: [userA.id, userB.id] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await prisma.$disconnect();
    delete require.cache[serverOnlyPath];
    console.log("  ..  test users and attempts cleaned up");
  }
}

void narrativeChecks()
  .then(dbChecks)
  .then(() => {
    console.log(`\n${checks} checks passed.\n`);
  })
  .catch((error) => {
    console.error("\nFAILED:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
