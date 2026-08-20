/**
 * The interview, end to end, THROUGH PRISMA.
 *
 * Unlike `e2e-interview-report.ts` (which uses an in-memory store), this script
 * calls the real `server-only` service layer and writes to a real database:
 *
 *   seed member + passed days
 *     → startCohortInterview   (creates the GeneralInterview row)
 *     → recordCohortAnswer ×N  (writes InterviewTurn rows + runtime state)
 *     → finishCohortInterview  (scores, writes the report)
 *     → getCohortInterviewReport
 *     → re-read with a FRESH PrismaClient
 *
 * Run it with the server-only condition unlocked and the test database bound:
 *
 *   NODE_OPTIONS=--conditions=react-server \
 *   DATABASE_URL=... DIRECT_URL=... \
 *   npx tsx scripts/e2e-interview-db.ts
 *
 * SAFETY: refuses to run against anything that looks like production. The check
 * is on data shape, the same rule `scripts/db-preflight.mjs` uses, and it runs
 * before the first write.
 */
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

// Shell-provided values win. `override: true` is needed so .env.local beats
// .env, but it would otherwise also clobber variables set on the command line —
// which silently ignored INTERVIEW_LLM_PROVIDER=anthropic on the first run and
// sent the whole interview to the rate-limited Gemini key.
const shellEnv = { ...process.env };
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });
for (const [key, value] of Object.entries(shellEnv)) {
  if (value !== undefined) process.env[key] = value;
}

// Bind the test database BEFORE anything imports `@/lib/db`, which reads
// DATABASE_URL at module load.
if (process.env.DATABASE_SAMPLE_URL && !process.env.E2E_DB_BOUND) {
  process.env.DATABASE_URL = process.env.DATABASE_SAMPLE_URL;
  process.env.DIRECT_URL = process.env.DATABASE_SAMPLE_URL.replace(
    "-pooler",
    "",
  );
  process.env.E2E_DB_BOUND = "1";
}

const MAX_USERS_FOR_TEST_DB = 500;
const MAX_SUBMISSIONS_FOR_TEST_DB = 200;

const TEST_EMAIL = "interview-e2e@abtalks.dev";
const PASSED_THROUGH_DAY = 18; // unlocks DAY_15 and yields beyond-scope days

/* --------------------------------------------------------------- helpers */

function log(step: string, detail = "") {
  console.log(`\n▸ ${step}${detail ? `\n     ${detail}` : ""}`);
}

function ok(label: string, pass: boolean, extra = "") {
  console.log(`     ${pass ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
  if (!pass) process.exitCode = 1;
  return pass;
}

/** Scripted answers that genuinely contain the banked expected evidence. */
const ANSWERS: Record<string, string> = {
  "d15-q03":
    "There was no API cost and no key required to start, and the data stays on the machine which matters for PHI. It also forced me to understand model size versus available RAM.",
  "d15-q09":
    "I could distinguish retrieval quality from generation quality — there was a case where retrieval was good but the answer still was not, and grounding or citation behaviour explained it.",
  "d15-q01":
    "The overlap preserves context across a chunk boundary. With zero overlap you can cut a clause mid-idea, so retrieval may return partial or missed exclusion clauses. The tradeoff is more chunks and more storage cost.",
  "d15-q10":
    "I appended turns to a messages list passed back each call. The context window grows toward the token limit, so cost and latency grow with every turn and I would need truncation or summarisation.",
  "d15-q04":
    "The filter restricts the candidate set considered for similarity, which prevents returning another plan's policy text. Without it top-k can be dominated by irrelevant plans.",
  "d15-q05":
    "I locked variant three. I scored on accuracy, tone, conciseness and compliance, and the runner-up dropped the standard disclaimer language.",
  "d15-q07":
    "Chroma is local and persistent so no external service was needed, and there was no hosting cost. Pinecone would win for scale or managed operations.",
  "d15-q02":
    "One question needed both paths: the SQL lookup returned the plan and claim rows, the vector lookup returned the policy text, and I combined the two into one answer.",
  "d15-q08":
    "The model receives a malformed or unexpected shape, which leads to downstream hallucination or a crash. Validation is the trust boundary between tool output and the model.",
  "d15-q06":
    "This is a retrieval and data problem, not a style problem. Fine-tuning changes tone and format, not facts, so I would inspect the knowledge base or the SQL source first.",
};

/** A deliberately off-topic turn, to prove the redirect path writes correctly. */
const OFF_TOPIC = "Actually, who won the cricket match last night?";

function answerFor(questionId: string, turnIndex: number): string {
  // One off-topic turn early on, so the persisted trail contains a REDIRECT.
  if (turnIndex === 1) return OFF_TOPIC;
  const base = questionId.split("@")[0]!;
  return ANSWERS[base] ?? "I worked through that during the cohort.";
}

/* ------------------------------------------------------------------ main */

async function main() {
  const prisma = new PrismaClient();

  /* ------------------------------------------------------- 0. safety */

  log("0. SAFETY — refusing to touch production");
  const host = new URL(process.env.DATABASE_URL!).hostname;
  const [users, submissions] = await Promise.all([
    prisma.user.count(),
    prisma.programMissionSubmission.count(),
  ]);
  console.log(`     host  ${host}`);
  console.log(`     users ${users} · mission submissions ${submissions}`);

  if (users > MAX_USERS_FOR_TEST_DB || submissions > MAX_SUBMISSIONS_FOR_TEST_DB) {
    console.error(
      `\n  REFUSING: this looks like production (${users} users, ${submissions} submissions).`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }
  ok("target is a disposable test database", true);

  /* --------------------------------------------------------- 1. seed */

  log("1. SEED — cohort member with days 1–18 passed");

  // Clean any previous run so the script is idempotent.
  const existing = await prisma.user.findUnique({
    where: { email: TEST_EMAIL },
    select: { id: true },
  });
  if (existing) {
    await prisma.user.delete({ where: { id: existing.id } });
  }

  const now = new Date();
  const cohort = await prisma.programCohort.upsert({
    where: { joinCode: "E2E-TEST" },
    create: {
      name: "AI Cohort — E2E Test",
      joinCode: "E2E-TEST",
      startsAt: new Date(now.getTime() - 20 * 24 * 3600 * 1000),
      endsAt: new Date(now.getTime() + 20 * 24 * 3600 * 1000),
      status: "ACTIVE",
      requiresJoinCode: false,
    },
    update: {},
    select: { id: true, name: true },
  });

  const user = await prisma.user.create({
    data: { email: TEST_EMAIL, name: "Priya Raman (E2E)" },
    select: { id: true },
  });

  const member = await prisma.programMember.create({
    data: {
      userId: user.id,
      cohortId: cohort.id,
      status: "ENROLLED",
      fullName: "Priya Raman",
      jobRole: "Data Engineer",
      company: "Meridian Health",
      yearsExperience: 4,
      githubUsername: "priya-e2e",
      githubRepoUrl: "https://github.com/priya/ai-cohort",
      highestUnlockedDay: PASSED_THROUGH_DAY,
      enrolledAt: now,
    },
    select: { id: true },
  });

  await prisma.programMissionSubmission.createMany({
    data: Array.from({ length: PASSED_THROUGH_DAY }, (_, i) => ({
      memberId: member.id,
      dayNumber: i + 1,
      attemptNumber: 1,
      // A repoRef on most days so question grounding has real artifacts.
      payload: (i + 1) % 4 === 0 ? {} : { repoRef: `day${i + 1}_solution.py` },
      verdict: [{ check: "seed", passed: true, detail: "e2e" }],
      passed: true,
      pointsAwarded: 12,
    })),
  });

  await prisma.programProject.create({
    data: {
      memberId: member.id,
      moduleNumber: 4,
      repoUrl: "https://github.com/priya/ai-cohort",
      writeup: "Coverage RAG pipeline with plan-scoped retrieval\n\nDetails…",
      status: "GRADED",
      aiScore: 88,
    },
  });

  console.log(`     member ${member.id} · cohort "${cohort.name}"`);
  ok("18 passed mission submissions written", true);

  /* -------------------------------------------------- 2. candidate ctx */

  const { buildCohortCandidateContext } = await import(
    "@/features/interview/cohort/candidate-context"
  );
  const context = await buildCohortCandidateContext(member.id, "DAY_15");

  log("2. CANDIDATE CONTEXT — read from the database");
  ok("context loaded", context !== null);
  if (!context) {
    await prisma.$disconnect();
    return;
  }
  console.log(
    `     ${context.fullName} · progress Day ${context.progressDay} · ` +
      `${context.submissions.length} submissions · ${context.projects.length} project`,
  );
  ok("live progress is Day 18", context.progressDay === PASSED_THROUGH_DAY);
  ok(
    "beyond-scope days detected",
    context.beyondScopePassedDays.join(",") === "16,17,18",
    context.beyondScopePassedDays.join(",") || "none",
  );

  /* ------------------------------------------------------- 3. start */

  const { startCohortInterview, recordCohortAnswer, finishCohortInterview, getCohortInterviewReport } =
    await import("@/features/interview/service");

  log("3. START — creating the attempt");
  const started = await startCohortInterview(member.id, "DAY_15");
  if (!started.ok) {
    console.error(`     could not start: ${started.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  const interviewId = started.data.interviewId;
  console.log(`     interview ${interviewId}`);
  console.log(`     Q1: ${started.data.question.text.slice(0, 120)}…`);
  ok("GeneralInterview row created", true);
  ok(
    "first question is grounded in real submitted work",
    started.data.question.text.includes("Day"),
  );

  /* ------------------------------------------------------- 4. turns */

  log("4. CONVERSATION — every answer through the real graph");
  let currentQuestionId = started.data.question.id;
  let turns = 0;
  let finished = false;
  const actions: string[] = [];

  while (turns < 60 && !finished) {
    const answer = answerFor(currentQuestionId, turns);
    const turn = await recordCohortAnswer(
      member.id,
      interviewId,
      currentQuestionId,
      answer,
    );
    if (!turn.ok) {
      console.log(`     turn refused: ${turn.message}`);
      break;
    }
    actions.push(turn.data.action);
    turns++;
    finished = turn.data.finished;
    if (turn.data.question) currentQuestionId = turn.data.question.id;
  }

  console.log(`     ${turns} turns · finished=${finished}`);
  console.log(`     actions: ${actions.join(" → ")}`);
  ok("interview reached completion", finished);
  ok("at least one off-topic answer was REDIRECTed", actions.includes("REDIRECT"));

  const turnRows = await prisma.interviewTurn.count({ where: { interviewId } });
  console.log(`     InterviewTurn rows: ${turnRows}`);
  ok("turn rows persisted", turnRows === turns, `${turnRows} rows for ${turns} turns`);

  const redirectRow = await prisma.interviewTurn.findFirst({
    where: { interviewId, action: "REDIRECT" },
    select: { answerText: true, evidence: true },
  });
  ok(
    "the redirect turn stored the answer but NO evidence",
    Boolean(redirectRow) && redirectRow!.evidence === null,
  );

  /* ------------------------------------------------------ 5. finish */

  log("5. FINISH — scoring and report generation");

  // The minimum-duration floor exists so a 20-second session cannot be scored.
  // A script completes in seconds, so the attempt's start is backdated. This is
  // the ONLY thing here that a real candidate's clock would provide instead.
  await prisma.generalInterview.update({
    where: { id: interviewId },
    data: { startedAt: new Date(Date.now() - 11 * 60 * 1000) },
  });

  const done = await finishCohortInterview(member.id, interviewId);
  if (!done.ok) {
    console.error(`     finish failed: ${done.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(
    `     overall ${done.data.scores.overallScore}/100 · duration ${done.data.durationSec}s`,
  );
  ok("interview scored", true);
  ok("report generated and stored", done.data.reportReady === true);

  const row = await prisma.generalInterview.findUnique({
    where: { id: interviewId },
    select: { status: true, overallScore: true, evaluatedAt: true },
  });
  ok("interview row is COMPLETED", row?.status === "COMPLETED");
  ok("overall score persisted on the row", typeof row?.overallScore === "number");

  /* ---------------------------------------------------- 6. retrieve */

  log("6. RETRIEVE — through the service, as the page does");
  const fetched = await getCohortInterviewReport(member.id, "DAY_15");
  ok("report retrieved", fetched.ok, fetched.ok ? "" : fetched.message);
  if (!fetched.ok) {
    await prisma.$disconnect();
    return;
  }
  const report = fetched.data.report;
  console.log(
    `     overall ${report.overall.score} · ${report.modules.length} modules · ` +
      `${report.competencies.length} competencies · ${report.evidence.length} evidence rows`,
  );

  /* -------------------------------------------------- 7. fresh read */

  log("7. FRESH READ — brand-new client, nothing cached");
  await prisma.$disconnect();

  const fresh = new PrismaClient();
  const stored = await fresh.interviewReport.findUnique({
    where: { interviewId },
    select: { report: true, overallScore: true, generatedAt: true, version: true },
  });
  ok("InterviewReport row exists after reconnect", stored !== null);

  const { parseReport } = await import("@/features/interview/report-assembly");
  const reparsed = parseReport(stored?.report);
  ok("stored JSON still validates against the schema", reparsed.ok);

  if (reparsed.ok) {
    const r = reparsed.data;
    ok("score survived the round trip", r.overall.score === report.overall.score);
    ok("scope is still Days 1–15", r.milestone.scopeFrom === 1 && r.milestone.scopeTo === 15);
    ok(
      "live progress recorded as context",
      r.milestone.progressDay === PASSED_THROUGH_DAY,
    );

    const answeredIds = new Set(
      r.evidence.filter((e) => e.answered).map((e) => e.questionId),
    );
    const refs = [
      ...r.strengths.flatMap((s) => s.evidenceRefs),
      ...r.improvements.flatMap((i) => i.evidenceRefs),
      ...r.competencies.flatMap((c) => c.evidenceRefs),
      ...r.modules.flatMap((m) => m.evidenceRefs),
    ];
    const untraceable = refs.filter((ref) => !answeredIds.has(ref));
    ok(
      `every one of ${refs.length} references is traceable`,
      untraceable.length === 0,
      untraceable.join(", "),
    );

    const leaks = r.evidence
      .filter((e) => e.tier === "CORE")
      .flatMap((e) => e.sourceDays)
      .filter((d) => d > 15);
    ok("no CORE evidence outside days 1–15", leaks.length === 0);

    console.log("");
    console.log(`     SUMMARY: ${r.summary.slice(0, 260)}`);
    console.log("");
    console.log(`     narrative model used: ${r.narrativeDegraded ? "none (fallback)" : "Claude"}`);
  }

  const freshTurns = await fresh.interviewTurn.count({ where: { interviewId } });
  ok("turn rows survived the reconnect", freshTurns === turns, `${freshTurns} rows`);

  await fresh.$disconnect();

  log("DONE", `member ${member.id} · interview ${interviewId}`);
  console.log(
    `     Sign in as ${TEST_EMAIL} to open the report in the browser.\n`,
  );
}

main().catch((error) => {
  console.error("\nE2E FAILED\n", error);
  process.exitCode = 1;
});
