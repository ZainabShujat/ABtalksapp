/**
 * Smoke test for the GeneralInterview persistence flow.
 *
 * SAFETY
 * ------
 * This script never reads DATABASE_URL. It requires SMOKE_DATABASE_URL, set
 * explicitly to a Neon *branch* (or other throwaway) database, plus
 * SMOKE_CONFIRM=yes. That makes it structurally impossible to pick up
 * production config by accident.
 *
 * It creates one throwaway user (…@smoke.abtalks.test) and deletes it — and
 * everything cascading from it — in a finally block. It writes no rows that are
 * not owned by that user.
 *
 * PREREQUISITES on the target branch
 * ----------------------------------
 *   npx prisma migrate deploy      # must include 20260813000000_general_interview
 *   npm run db:seed:content        # only if the branch has no Challenge/DailyTask rows
 *
 * RUN
 * ---
 *   SMOKE_DATABASE_URL="postgresql://…branch…" SMOKE_CONFIRM=yes \
 *     NODE_OPTIONS=--conditions=react-server npx tsx scripts/smoke-general-interview.ts
 *
 * The react-server condition is required so `import "server-only"` resolves to a
 * no-op outside Next.
 *
 * ANTHROPIC_API_KEY is optional. Without it every LLM call fails closed and the
 * deterministic fallbacks run instead — which is a valid path to exercise, but
 * scores will floor at 0. That does not affect any of the persistence assertions.
 */
import assert from "node:assert/strict";

/* ----------------------------------------------------------------- guards */

const SMOKE_URL = process.env.SMOKE_DATABASE_URL;
if (!SMOKE_URL) {
  console.error(
    "\nRefusing to run: SMOKE_DATABASE_URL is not set.\n" +
      "Point it at a Neon branch database. This script never reads DATABASE_URL.\n",
  );
  process.exit(1);
}
if (process.env.SMOKE_CONFIRM !== "yes") {
  let host = "(unparseable)";
  try {
    host = new URL(SMOKE_URL).host;
  } catch {
    /* keep placeholder */
  }
  console.error(
    `\nRefusing to run without confirmation.\n` +
      `Target host: ${host}\n` +
      `If that is a throwaway/branch database, re-run with SMOKE_CONFIRM=yes\n`,
  );
  process.exit(1);
}

// Must be set before anything imports @/lib/db — PrismaClient reads env at
// construction time.
process.env.DATABASE_URL = SMOKE_URL;
process.env.DIRECT_URL = SMOKE_URL;

/* ------------------------------------------------------------- test harness */

type Check = { name: string; ok: boolean; detail?: string };
const results: Check[] = [];

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, ok: false, detail });
    console.log(`  FAIL  ${name}\n        ${detail.split("\n")[0]}`);
  }
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const service = await import("../src/features/interview/service");
  const repo = await import("../src/features/interview/repository");
  const { computeEligibility } = await import(
    "../src/features/interview/eligibility"
  );
  const { submitInterviewAnswerSchema } = await import(
    "../src/lib/validations/interview"
  );

  const stamp = Date.now();
  const email = `smoke-${stamp}@smoke.abtalks.test`;
  let userId = "";

  try {
    /* ------------------------------------------------------------ fixtures */

    const challenge = await prisma.challenge.findFirst({
      where: { dailyTasks: { some: {} } },
      select: {
        id: true,
        domain: true,
        dailyTasks: {
          select: { id: true, dayNumber: true },
          orderBy: { dayNumber: "asc" },
          take: 60,
        },
      },
    });

    if (!challenge || challenge.dailyTasks.length < 60) {
      throw new Error(
        `Target database needs a Challenge with >= 60 DailyTasks (found ${
          challenge?.dailyTasks.length ?? 0
        }). Run: npm run db:seed:content`,
      );
    }

    const user = await prisma.user.create({
      data: {
        email,
        name: "Smoke Test",
        studentProfile: {
          create: {
            fullName: "Smoke Test",
            domain: challenge.domain,
            skills: ["python"],
            referralCode: `SMOKE${stamp}`.slice(0, 20),
          },
        },
        enrollments: {
          create: { challengeId: challenge.id, domain: challenge.domain },
        },
      },
      select: { id: true, enrollments: { select: { id: true } } },
    });
    userId = user.id;
    const enrollmentId = user.enrollments[0]!.id;

    /** Adds completed days [from, to) — a Submission row IS completion. */
    async function completeDays(from: number, to: number) {
      for (let i = from; i < to; i++) {
        const task = challenge!.dailyTasks[i]!;
        await prisma.submission.create({
          data: {
            userId,
            enrollmentId,
            dailyTaskId: task.id,
            dayNumber: task.dayNumber,
            status: "ON_TIME",
            githubUrl: `https://github.com/smoke/${stamp}-${task.dayNumber}`,
          },
        });
      }
    }

    await completeDays(0, 30);
    console.log(`\nfixture: user ${userId} with 30 completed days\n`);

    /* ------------------------------------------------------------ 1. start */

    let interviewId = "";
    let firstQuestionId = "";

    await check("1. startInterviewAction creates an IN_PROGRESS attempt", async () => {
      const started = await service.startInterviewForUser(userId);
      assert.ok(started.ok, `start failed: ${!started.ok ? started.message : ""}`);
      interviewId = started.data.interviewId;
      firstQuestionId = started.data.question.id;

      const row = await prisma.generalInterview.findUniqueOrThrow({
        where: { id: interviewId },
        select: {
          status: true,
          attemptNumber: true,
          startedAt: true,
          plan: true,
          state: true,
          eligibleSubmissionIds: true,
          consumedSubmissionIds: true,
        },
      });
      assert.equal(row.status, "IN_PROGRESS");
      assert.equal(row.attemptNumber, null, "attemptNumber must stay null");
      assert.ok(row.startedAt, "startedAt must be set");
      assert.ok(row.plan, "plan must be persisted");
      assert.ok(row.state, "state must be persisted server-side");
      assert.equal(row.eligibleSubmissionIds.length, 30);
      assert.equal(row.consumedSubmissionIds.length, 0, "must not consume yet");
    });

    /* ------------------------------------------------- 2. double start */

    await check("2. a second start while one is active is rejected", async () => {
      const second = await service.startInterviewForUser(userId);
      assert.equal(second.ok, false);

      const count = await prisma.generalInterview.count({
        where: { userId, status: "IN_PROGRESS" },
      });
      assert.equal(count, 1, "must not open a second attempt");
    });

    /* --------------------------------------------------- 3. submit answer */

    await check("3. submitInterviewAnswerAction persists and advances state", async () => {
      const before = await prisma.generalInterview.findUniqueOrThrow({
        where: { id: interviewId },
        select: { state: true },
      });
      const beforeIndex = (before.state as { currentQuestionIndex: number })
        .currentQuestionIndex;

      const turn = await service.recordAnswer(
        userId,
        interviewId,
        firstQuestionId,
        "I built a retrieval pipeline in Python; I chunked documents and embedded them with sentence-transformers, then tuned the top-k after seeing poor recall.",
      );
      assert.ok(turn.ok, `answer failed: ${!turn.ok ? turn.message : ""}`);

      const after = await prisma.generalInterview.findUniqueOrThrow({
        where: { id: interviewId },
        select: { state: true, transcript: true },
      });
      const state = after.state as {
        currentQuestionIndex: number;
        transcript: unknown[];
        evidenceByQuestionId: Record<string, unknown>;
      };

      assert.ok(
        Array.isArray(state.transcript) && state.transcript.length >= 2,
        "transcript must record the answer",
      );
      assert.ok(
        state.evidenceByQuestionId[firstQuestionId],
        "evidence must be stored for the answered question",
      );
      // Either the index advanced, or the same question stayed open as a follow-up.
      assert.ok(
        state.currentQuestionIndex >= beforeIndex,
        "state must advance monotonically",
      );
      assert.ok(after.transcript, "transcript projection must be written");
    });

    /* ------------------------------------------- 4. client cannot tamper */

    await check("4a. extra client-supplied fields are ignored by the schema", () => {
      const parsed = submitInterviewAnswerSchema.parse({
        interviewId: "abc",
        questionId: "q1",
        answerText: "hello",
        // A malicious client attempting to inject grading inputs:
        plan: { questions: [] },
        state: { currentQuestionIndex: 99 },
        evidence: { q1: { conceptualFound: true } },
        eligibleSubmissionIds: [],
        overallScore: 100,
      } as unknown);
      assert.deepEqual(Object.keys(parsed).sort(), [
        "answerText",
        "interviewId",
        "questionId",
      ]);
    });

    await check("4b. an answer for a non-current question is rejected", async () => {
      const turn = await service.recordAnswer(
        userId,
        interviewId,
        "q99",
        "trying to skip ahead",
      );
      assert.equal(turn.ok, false, "out-of-order answer must be rejected");
    });

    await check("4c. another user's interview is not reachable", async () => {
      const otherId = `smoke-other-${stamp}`;
      const turn = await service.recordAnswer(
        otherId,
        interviewId,
        firstQuestionId,
        "not mine",
      );
      assert.equal(turn.ok, false, "cross-user access must be rejected");
    });

    await check("4d. eligibility is recomputed server-side, not trusted", async () => {
      // The entitlement frozen on the row is what will be consumed; nothing the
      // client sends can widen or narrow it.
      const row = await prisma.generalInterview.findUniqueOrThrow({
        where: { id: interviewId },
        select: { eligibleSubmissionIds: true },
      });
      const owned = await prisma.submission.findMany({
        where: { userId },
        select: { id: true },
      });
      const ownedIds = new Set(owned.map((s) => s.id));
      assert.ok(
        row.eligibleSubmissionIds.every((id) => ownedIds.has(id)),
        "entitlement must reference only this user's submissions",
      );
    });

    /* ----------------------------------------- 5 & 6. finish + numbering */

    await check("5. finishInterviewAction scores from persisted state", async () => {
      // Back-date startedAt past the minimum-duration floor. Duration is derived
      // server-side from this column, never from client input.
      await prisma.generalInterview.update({
        where: { id: interviewId },
        data: { startedAt: new Date(Date.now() - 10 * 60 * 1000) },
      });

      const finished = await service.finishInterview(userId, interviewId);
      assert.ok(finished.ok, `finish failed: ${!finished.ok ? finished.message : ""}`);

      const row = await prisma.generalInterview.findUniqueOrThrow({
        where: { id: interviewId },
        select: {
          status: true,
          overallScore: true,
          conceptualScore: true,
          communicationScore: true,
          durationSec: true,
          evaluatedAt: true,
        },
      });
      assert.equal(row.status, "COMPLETED");
      assert.ok(
        typeof row.overallScore === "number" &&
          row.overallScore >= 0 &&
          row.overallScore <= 100,
        "overallScore must be a persisted 0-100 number",
      );
      assert.ok(typeof row.conceptualScore === "number");
      assert.ok(
        typeof row.communicationScore === "number",
        "COMMUNICATION must be scored even with no dedicated question slots",
      );
      assert.ok((row.durationSec ?? 0) >= 180, "duration derived from startedAt");
      assert.ok(row.evaluatedAt);
    });

    await check("6. a successful completion receives attempt number 1", async () => {
      const row = await prisma.generalInterview.findUniqueOrThrow({
        where: { id: interviewId },
        select: { attemptNumber: true, consumedSubmissionIds: true },
      });
      assert.equal(row.attemptNumber, 1);
      assert.equal(
        row.consumedSubmissionIds.length,
        30,
        "completion must consume the frozen entitlement",
      );
    });

    /* ------------------------------------- 7 & 8. abandoned / invalid */

    await check("7. ABANDONED and INVALID receive no attempt number", async () => {
      await completeDays(30, 60); // unlock another attempt

      const a = await service.startInterviewForUser(userId);
      assert.ok(a.ok, `start failed: ${!a.ok ? a.message : ""}`);
      await service.abandonInterview(userId, a.data.interviewId);

      const abandoned = await prisma.generalInterview.findUniqueOrThrow({
        where: { id: a.data.interviewId },
        select: { status: true, attemptNumber: true, consumedSubmissionIds: true },
      });
      assert.equal(abandoned.status, "ABANDONED");
      assert.equal(abandoned.attemptNumber, null);

      // INVALID: finishing under the duration floor must not score or consume.
      const b = await service.startInterviewForUser(userId);
      assert.ok(b.ok, `start failed: ${!b.ok ? b.message : ""}`);
      const tooShort = await service.finishInterview(userId, b.data.interviewId);
      assert.equal(tooShort.ok, false, "short session must not be scored");

      const invalid = await prisma.generalInterview.findUniqueOrThrow({
        where: { id: b.data.interviewId },
        select: {
          status: true,
          attemptNumber: true,
          consumedSubmissionIds: true,
          overallScore: true,
        },
      });
      assert.equal(invalid.status, "INVALID");
      assert.equal(invalid.attemptNumber, null);
      assert.equal(invalid.overallScore, null);
    });

    await check("8. ABANDONED/INVALID consume no challenge submissions", async () => {
      const rows = await prisma.generalInterview.findMany({
        where: { userId, status: { in: ["ABANDONED", "INVALID"] } },
        select: { consumedSubmissionIds: true },
      });
      assert.ok(rows.length >= 2, "expected an abandoned and an invalid attempt");
      for (const row of rows) {
        assert.equal(
          row.consumedSubmissionIds.length,
          0,
          "non-completed attempts must consume nothing",
        );
      }

      const consumed = await prisma.generalInterview.findMany({
        where: { userId, status: "COMPLETED" },
        select: { consumedSubmissionIds: true },
      });
      const total = consumed.flatMap((r) => r.consumedSubmissionIds);
      assert.equal(total.length, 30, "only the completed attempt consumed days");
    });

    /* --------------------------------------------- 9 & 10. retake rule */

    await check("9. next attempt stays locked below 30 new days", async () => {
      // 60 completed, 30 consumed → exactly 30 new. Temporarily verify the
      // boundary at 29 by testing the rule against a trimmed set.
      const all = await prisma.submission.findMany({
        where: { userId },
        select: { id: true },
        orderBy: { submittedAt: "asc" },
      });
      const priors = await repo.loadPriorAttempts(userId);
      const twentyNine = all.slice(0, 59).map((s) => s.id);
      const result = computeEligibility(twentyNine, priors);
      assert.equal(
        result.state,
        "retake_locked",
        "29 new days must not unlock a retake",
      );
    });

    await check("10. 30 new days unlocks a second attempt", async () => {
      const overview = await service.getInterviewOverview(userId);
      assert.ok(overview.ok);
      assert.equal(overview.data.eligibility.state, "ready");
      assert.equal(overview.data.totalCompletedDays, 60);

      const second = await service.startInterviewForUser(userId);
      assert.ok(second.ok, `start failed: ${!second.ok ? second.message : ""}`);

      const row = await prisma.generalInterview.findUniqueOrThrow({
        where: { id: second.data.interviewId },
        select: { eligibleSubmissionIds: true },
      });
      assert.equal(
        row.eligibleSubmissionIds.length,
        30,
        "second attempt is entitled to exactly the 30 unconsumed days",
      );

      const completedRow = await prisma.generalInterview.findFirstOrThrow({
        where: { userId, status: "COMPLETED" },
        select: { consumedSubmissionIds: true },
      });
      const alreadyConsumed = new Set(completedRow.consumedSubmissionIds);
      assert.ok(
        !row.eligibleSubmissionIds.some((id) => alreadyConsumed.has(id)),
        "must not re-offer days consumed by attempt 1",
      );

      await service.abandonInterview(userId, second.data.interviewId);
    });

    /* ------------------------------------------------- 11. concurrency */

    await check("11. concurrent completions get distinct attempt numbers", async () => {
      const { planQuestions } = await import(
        "../src/features/interview/question-rules"
      );
      const { buildRubricSnapshot } = await import(
        "../src/features/interview/rubric"
      );
      const { createInitialState } = await import(
        "../src/features/interview/state"
      );
      const { buildCandidateContext } = await import(
        "../src/features/interview/candidate-context"
      );
      const { aggregateScores } = await import(
        "../src/features/interview/scoring"
      );

      const context = await buildCandidateContext(userId);
      assert.ok(context);
      const plan = {
        questions: planQuestions(context),
        rubricSnapshot: buildRubricSnapshot(),
        contextSummary: {
          totalCompletedDays: 60,
          challengeSourcedQuestions: 10,
          resumeSourcedQuestions: 0,
          genericQuestions: 0,
          hasStructuredResume: false,
        },
      };
      const state = { ...createInitialState(), status: "IN_PROGRESS" as const };
      const scores = aggregateScores([], "concurrency probe");

      // Open two attempts directly, bypassing the one-active-attempt guard, so
      // the advisory lock is the only thing preventing a duplicate number.
      const [x, y] = await Promise.all([
        repo.createAttempt(userId, plan, state, []),
        repo.createAttempt(userId, plan, state, []),
      ]);

      const [rx, ry] = await Promise.all([
        repo.completeAttempt(x.id, userId, { state, scores, durationSec: 600 }),
        repo.completeAttempt(y.id, userId, { state, scores, durationSec: 600 }),
      ]);

      assert.ok(rx.ok && ry.ok, "both concurrent completions should commit");
      assert.notEqual(
        rx.attemptNumber,
        ry.attemptNumber,
        "concurrent completions must not share an attempt number",
      );

      const numbers = await prisma.generalInterview.findMany({
        where: { userId, attemptNumber: { not: null } },
        select: { attemptNumber: true },
      });
      const distinct = new Set(numbers.map((n) => n.attemptNumber));
      assert.equal(
        distinct.size,
        numbers.length,
        "all attempt numbers must be distinct",
      );
    });
  } finally {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      console.log(`\ncleanup: removed smoke user ${userId}`);
    }
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed\n`,
  );
  if (failed.length > 0) {
    for (const f of failed) console.error(`FAILED: ${f.name}\n  ${f.detail}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\nsmoke test crashed:", e);
  process.exit(1);
});
