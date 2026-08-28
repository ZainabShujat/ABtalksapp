/**
 * Regenerates the report for an already-completed interview.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/regenerate-interview-report.ts
 *
 * Uses ONLY what the interview already captured — the frozen plan, the runtime
 * state and the durable turn rows. Makes NO model calls: the narrative falls
 * back to the deterministic text generated from the evidence, and the report is
 * flagged accordingly. Scores are unaffected either way, because no model has
 * ever produced one.
 *
 * This exists because report generation and interview execution are separate
 * concerns. Once an interview is recorded, its report can be rebuilt at any
 * time — after a schema change, after a provider outage, or to check that the
 * assessment layer still agrees with itself.
 */
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

const shellEnv = { ...process.env };
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });
for (const [k, v] of Object.entries(shellEnv)) if (v !== undefined) process.env[k] = v;

if (process.env.DATABASE_SAMPLE_URL && !process.env.E2E_DB_BOUND) {
  process.env.DATABASE_URL = process.env.DATABASE_SAMPLE_URL;
  process.env.DIRECT_URL = process.env.DATABASE_SAMPLE_URL.replace("-pooler", "");
  process.env.E2E_DB_BOUND = "1";
}

const MAX_USERS = 500;

function ok(label: string, pass: boolean, extra = "") {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
  if (!pass) process.exitCode = 1;
}

async function main() {
  const prisma = new PrismaClient();

  const host = new URL(process.env.DATABASE_URL!).hostname;
  const users = await prisma.user.count();
  console.log(`\n  database ${host} · ${users} users`);
  if (users > MAX_USERS) {
    console.error("  REFUSING: production-shaped target.");
    process.exit(1);
  }
  ok("target is a disposable test database", true);

  const interview = await prisma.generalInterview.findFirst({
    where: { status: "COMPLETED" },
    orderBy: { evaluatedAt: "desc" },
    select: {
      id: true,
      memberId: true,
      blueprint: true,
      plan: true,
      state: true,
      durationSec: true,
      member: {
        select: {
          fullName: true,
          jobRole: true,
          company: true,
          cohort: { select: { name: true } },
        },
      },
    },
  });

  if (!interview) {
    console.error("\n  No completed interview in the test database.\n");
    process.exit(1);
  }

  console.log(`\n▸ SOURCE — interview ${interview.id}`);

  const turnRows = await prisma.interviewTurn.findMany({
    where: { interviewId: interview.id },
    orderBy: { turnIndex: "asc" },
    select: {
      turnIndex: true,
      questionId: true,
      tier: true,
      depthLevel: true,
      action: true,
      promptText: true,
      answerText: true,
      evidence: true,
      degraded: true,
    },
  });
  console.log(`     ${turnRows.length} captured turns · no model calls will be made`);

  const { buildInterviewReport } = await import("@/features/interview/report");
  const { parseReport } = await import("@/features/interview/report-assembly");
  const { scopeDaysFor } = await import("@/features/interview/cohort/planner");
  const { buildCohortCandidateContext } = await import(
    "@/features/interview/cohort/candidate-context"
  );

  const context = await buildCohortCandidateContext(
    interview.memberId,
    interview.blueprint,
  );

  console.log("\n▸ BUILD — from captured evidence only");
  const report = await buildInterviewReport(
    // No provider. The narrative falls back to deterministic text and the
    // document is flagged; the scores are identical either way.
    async () => ({ ok: false, message: "regeneration runs without a model" }),
    {
      plan: interview.plan as never,
      state: interview.state as never,
      turns: turnRows.map((t) => ({ ...t, evidence: t.evidence as never })),
      blueprint: interview.blueprint,
      scopeDays: scopeDaysFor(interview.blueprint),
      candidate: {
        name: interview.member.fullName,
        cohort: interview.member.cohort.name,
        jobRole: interview.member.jobRole,
        company: interview.member.company,
      },
      progressDay: context?.progressDay ?? null,
      durationSec: interview.durationSec ?? 0,
    },
  );

  ok("report built", true);
  console.log(
    `     overall ${report.overall.scoreOutOfTen}/10 · ${report.overall.readiness}`,
  );

  console.log("\n▸ VALIDATE (write side)");
  const validated = parseReport(report);
  ok("schema v2 accepts the document", validated.ok, validated.ok ? "" : validated.message);

  console.log("\n▸ PERSIST");
  const { saveReport } = await import("@/features/interview/repository");
  const saved = await saveReport(interview.id, interview.memberId, report);
  ok("stored", saved.ok, saved.ok ? "" : saved.message);

  console.log("\n▸ FRESH READ (new client, nothing cached)");
  await prisma.$disconnect();
  const fresh = new PrismaClient();
  const row = await fresh.interviewReport.findUnique({
    where: { interviewId: interview.id },
    select: { report: true, overallScore: true, version: true },
  });
  ok("row present after reconnect", row !== null);

  const reread = parseReport(row?.report);
  ok("schema v2 accepts it on read", reread.ok, reread.ok ? "" : reread.message);

  if (reread.ok) {
    const d = reread.data;
    ok("score survived the round trip", d.overall.score === report.overall.score);
    ok("question assessments present", d.questionAssessments.length > 0, `${d.questionAssessments.length}`);
    ok("deep probes nested, not flattened", d.questionAssessments.some((q) => q.probes.length > 0));
    ok("every question explains its score", d.questionAssessments.every((q) => q.whyThisScore.length > 0));
    ok("skills classified", d.skills.length > 0, `${d.skills.length}`);
    ok("agent insights present", d.agentInsights.length > 0, `${d.agentInsights.length}`);
    ok("transcript excerpts selected, not dumped", d.transcriptExcerpts.length > 0 && d.transcriptExcerpts.length <= 5);
    ok("assessment status recorded", Boolean(d.assessmentStatus.status), d.assessmentStatus.status);

    const unassessed = d.modules.filter((m) => !m.assessed);
    ok("unassessed modules carry null, never 0", unassessed.every((m) => m.score === null), `${unassessed.length} unassessed`);

    const answeredIds = new Set(
      d.questionAssessments.filter((q) => q.answered).map((q) => q.questionId),
    );
    const badRefs = d.expectedButNotDemonstrated
      .flatMap((s) => s.evidenceRefs)
      .filter((r) => !answeredIds.has(r));
    ok("nothing blamed on an unanswered question", badRefs.length === 0, badRefs.join(", "));

    console.log("");
    console.log(`     modules   ${d.modules.map((m) => `M${m.moduleNumber}:${m.assessed ? m.scoreOutOfTen : "n/a"}`).join("  ")}`);
    console.log(`     skills    ${["STRONG", "DEVELOPING", "WEAK", "NOT_DEMONSTRATED", "NOT_ASSESSED"].map((l) => `${l.toLowerCase()}:${d.skills.filter((s) => s.level === l).length}`).join("  ")}`);
    console.log(`     status    ${d.assessmentStatus.status} (${d.assessmentStatus.degradedTurns}/${d.assessmentStatus.totalTurns} turns degraded)`);
  }

  await fresh.$disconnect();
  console.log("");
}

main().catch((error) => {
  console.error("\nREGENERATION FAILED\n", error);
  process.exitCode = 1;
});
