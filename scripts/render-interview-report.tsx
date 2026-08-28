/**
 * Renders the report page's view component against the PERSISTED report.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/render-interview-report.tsx [out.html]
 *
 * This is not a mock render. It loads the row the interview actually wrote,
 * validates it through the same `parseReport` the page uses, and renders the
 * same `InterviewReportView` the route renders — to static HTML instead of to a
 * browser. It exists because a dev server cannot always be started here, and
 * "the component compiles" is a much weaker claim than "the component turns
 * this exact stored document into a page".
 */
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
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

function ok(label: string, pass: boolean, extra = "") {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
  if (!pass) process.exitCode = 1;
}

async function main() {
  const out = process.argv[2] ?? "interview-report.html";
  const prisma = new PrismaClient();

  const users = await prisma.user.count();
  console.log(`\n  database ${new URL(process.env.DATABASE_URL!).hostname} · ${users} users`);
  if (users > 500) {
    console.error("  REFUSING: production-shaped target.");
    process.exit(1);
  }

  const row = await prisma.interviewReport.findFirst({
    orderBy: { generatedAt: "desc" },
    select: { report: true, generatedAt: true, interviewId: true },
  });
  if (!row) {
    console.error("\n  No persisted report in the test database.\n");
    process.exit(1);
  }
  console.log(`\n▸ SOURCE — persisted report for interview ${row.interviewId}`);

  const { parseReport } = await import("@/features/interview/report-assembly");
  const parsed = parseReport(row.report);
  ok("stored document validates on read", parsed.ok, parsed.ok ? "" : parsed.message);
  if (!parsed.ok) {
    await prisma.$disconnect();
    return;
  }

  const { InterviewReportView } = await import(
    "@/components/interview/cohort/report-view"
  );

  console.log("\n▸ RENDER — the same component the route renders");
  const html = renderToStaticMarkup(
    InterviewReportView({ report: parsed.data, generatedAt: row.generatedAt }),
  );
  ok("component rendered without throwing", html.length > 0, `${html.length} chars`);

  const d = parsed.data;
  // React escapes text on render, so "Code & technical depth" arrives as
  // "Code &amp; technical depth". Compare against the escaped form rather than
  // reporting a correct render as a failure.
  const escape = (t: string) =>
    t
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const has = (needle: string) =>
    html.includes(needle) || html.includes(escape(needle));

  console.log("\n▸ CONTENT — every required section present in the markup");
  ok("overall score /10", has(d.overall.scoreOutOfTen.toFixed(1)));
  ok("readiness band", has(d.overall.readiness));
  ok("executive summary", has(d.summary.slice(0, 40)));
  ok("evaluation breakdown", has("Evaluation breakdown"));
  ok("competency labels", d.competencies.every((c) => has(c.label)));
  ok("module performance", has("Module performance"));
  ok(
    "module titles",
    d.modules.filter((m) => m.assessed).every((m) => has(m.title)),
  );
  ok("skills section", has("Skills"));
  ok("agent insights", d.agentInsights.length === 0 || has("Agent insights"));
  ok("question-by-question", has("Question-by-question assessment"));
  ok("per-question reasons", has("Why this score"));
  ok(
    "question ids rendered",
    d.questionAssessments.every((q) => has(q.questionId)),
  );
  ok(
    "deep probes nested",
    d.questionAssessments.every(
      (q) => q.probes.length === 0 || has("Deep probe"),
    ),
  );
  ok(
    "expected but not demonstrated",
    d.expectedButNotDemonstrated.length === 0 ||
      has("Expected but not demonstrated"),
  );
  ok(
    "transcript evidence",
    d.transcriptExcerpts.length === 0 || has("Transcript evidence"),
  );
  ok("final recommendation", has("Final recommendation"));
  ok(
    "assessment status surfaced when not normal",
    d.assessmentStatus.status === "NORMAL" ||
      has(d.assessmentStatus.status === "DEGRADED" ? "Degraded assessment" : "Partially degraded"),
  );
  ok(
    "unassessed modules never show a zero score",
    d.modules
      .filter((m) => !m.assessed)
      .every((m) => !html.includes(`Module ${m.moduleNumber} — ${m.title}</span>`)),
  );

  // A standalone page so the markup can be opened directly, with the same
  // scoped tokens the app supplies. This mirrors the room's palette; it is a
  // preview harness, not a second stylesheet for the app.
  const page = `<!doctype html><meta charset="utf-8"><title>Interview report preview</title>
<style>
  body{margin:0;background:#040A12;color:#fff;font-family:ui-sans-serif,system-ui,sans-serif;padding:32px}
  .interview-room{--iv-surface:rgba(5,12,33,.89);--iv-surface-raised:rgba(255,255,255,.04);
    --iv-border:rgba(46,57,75,.69);--iv-border-soft:rgba(46,57,75,.4);
    --iv-text:rgba(255,255,255,.94);--iv-text-muted:rgba(255,255,255,.55);
    --iv-text-faint:rgba(255,255,255,.38);--iv-accent:#968bec;--iv-live:#6ae276}
  .interview-room *{box-sizing:border-box}
</style>
<div style="max-width:960px;margin:0 auto">${html}</div>`;

  writeFileSync(out, page, "utf8");
  console.log(`\n▸ WRITTEN — ${out}`);
  console.log(
    `     ${d.questionAssessments.length} questions · ${d.modules.length} modules · ` +
      `${d.skills.length} skills · ${d.agentInsights.length} insights\n`,
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("\nRENDER FAILED\n", error);
  process.exitCode = 1;
});
