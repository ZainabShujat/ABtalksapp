/**
 * End-to-end smoke test for the AI Cohort milestone interview.
 *
 * Exercises the parts `verify-cohort-interview.ts` cannot: the repository, the
 * start gate against real ProgramMissionSubmission rows, the full turn loop
 * through the service, and — most importantly — the PARTIAL UNIQUE INDEX that
 * enforces one completed interview per member per blueprint.
 *
 * Safety. This script writes. It refuses to run against anything that looks
 * like production, using the same data-shape check as `scripts/db-preflight.mjs`
 * (row counts, not a hostname allowlist). Every row it creates is namespaced
 * with a run id and deleted in `finally`, including on failure.
 *
 * No API key required: `askClaudeJson` returns `{ ok: false }` when
 * ANTHROPIC_API_KEY is unset, and both LLM call sites have deterministic
 * fallbacks. The interview therefore runs to completion and scores from
 * per-answer evidence alone, which is exactly the path we want covered.
 *
 * Everything lives inside `main()` because tsx transpiles this file as CJS,
 * where top-level await is unavailable — and the dynamic imports must happen
 * after the environment is loaded, so the Prisma client is constructed against
 * the right database.
 *
 * Run:
 *   npm run test:interview:db
 *
 * The `--conditions=react-server` flag in that script is REQUIRED, not optional:
 * without it the `server-only` package resolves to the entry that throws, and
 * importing `service.ts` fails before a single check runs.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/** Populate process.env from .env.local (Prisma only auto-loads .env). */
function loadEnvLocal() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split("\n")) {
    // .env.local may have CRLF line endings; a trailing \r corrupts the value.
    const line = rawLine.replace(/\r$/, "");
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

// Same thresholds as db-preflight.mjs. Duplicated deliberately: a guard that
// can be skipped by forgetting a separate command is not a guard.
const MAX_USERS = 500;
const MAX_MISSION_SUBMISSIONS = 200;

const RUN = `smoke-${Date.now()}`;

let passedChecks = 0;
const failures: string[] = [];

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passedChecks++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(`${name}\n       ${(e as Error).message.split("\n")[0]}`);
    console.log(`  FAIL ${name}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

/**
 * One cheap call to establish whether the Anthropic path is actually live.
 *
 * Deliberately separate from `askClaudeJson` so a failure here reports the real
 * upstream message (bad key, no credits, unknown model) instead of the
 * caller-facing "AI request failed."
 */
async function probeLlm(): Promise<boolean> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.log("\n  LLM probe: ANTHROPIC_API_KEY is not set.");
    return false;
  }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.PROGRAM_ANTHROPIC_MODEL ?? "claude-sonnet-5",
        max_tokens: 16,
        system: "Reply JSON only.",
        messages: [{ role: "user", content: 'Return {"ok":true}' }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) return true;

    const body = (await res.text().catch(() => "")).slice(0, 300);
    console.log(`\n  LLM probe: HTTP ${res.status} — ${body}`);
    return false;
  } catch (e) {
    console.log(`\n  LLM probe: request errored — ${String(e)}`);
    return false;
  }
}

async function main() {
  loadEnvLocal();

  const url = process.env.SMOKE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("\nFAIL — no SMOKE_DATABASE_URL or DATABASE_URL set.\n");
    process.exit(1);
  }
  process.env.DATABASE_URL = url;
  process.env.DIRECT_URL ??= url;

  const { prisma } = await import("../src/lib/db");
  const {
    startCohortInterview,
    recordCohortAnswer,
    finishCohortInterview,
    abandonCohortInterview,
  } = await import("../src/features/interview/service");
  const { assertCanStart, getBlueprintEligibility } = await import(
    "../src/features/interview/cohort-eligibility"
  );
  const { loadActiveAttempt, findActiveAttemptId } = await import(
    "../src/features/interview/repository"
  );
  const { planCohortInterview } = await import(
    "../src/features/interview/cohort/planner"
  );
  const { questionCountFor } = await import(
    "../src/features/interview/cohort/question-bank"
  );

  /* ------------------------------------------------- production guard */

  const [userCount, subCount] = await Promise.all([
    prisma.user.count(),
    prisma.programMissionSubmission.count(),
  ]);

  if (userCount > MAX_USERS || subCount > MAX_MISSION_SUBMISSIONS) {
    console.error(
      `\nFAIL — this looks like PRODUCTION (${userCount} users, ${subCount} ` +
        `mission submissions). Refusing to write.\n` +
        `Point DATABASE_URL or SMOKE_DATABASE_URL at the developer database.\n`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  /* --------------------------------------------- LLM availability probe */

  // The suite passes either way, because both LLM call sites have deterministic
  // fallbacks. That is a feature — but it also means a silent API failure would
  // otherwise look like a green run. Probe once and say so loudly, so nobody
  // reads "21 checks passed" as "evidence extraction is verified".
  const llmAvailable = await probeLlm();
  if (llmAvailable) {
    console.log(
      "\n  LLM: reachable — evidence extraction and semantic judgment ARE exercised.",
    );
  } else {
    console.log(
      "\n  LLM: UNAVAILABLE — every answer will fall back to deterministic\n" +
        "       evidence. The turn loop, persistence and milestone limit are\n" +
        "       still fully covered, but evidence extraction and the final\n" +
        "       semantic judgment are NOT verified by this run, and scores\n" +
        "       will be near the floor.",
    );
  }

  /* ------------------------------------------------------- fixtures */

  const cohort = await prisma.programCohort.create({
    data: {
      name: `Smoke cohort ${RUN}`,
      joinCode: RUN.slice(0, 20).toUpperCase(),
      startsAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      status: "ACTIVE",
    },
    select: { id: true },
  });

  const createdUserIds: string[] = [];

  async function makeMember(label: string) {
    const user = await prisma.user.create({
      data: { email: `${RUN}-${label}@abtalks.dev`, name: `Smoke ${label}` },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    const member = await prisma.programMember.create({
      data: {
        userId: user.id,
        cohortId: cohort.id,
        status: "ENROLLED",
        fullName: `Smoke ${label}`,
        jobRole: "Engineer",
        company: "ABTalks Test",
        yearsExperience: 3,
        githubUsername: `${RUN}-${label}`,
        githubRepoUrl: `https://github.com/${RUN}/${label}`,
      },
      select: { id: true },
    });
    return { userId: user.id, memberId: member.id };
  }

  /** Records days 1..upTo as PASSED for a member. */
  async function passDays(memberId: string, upTo: number, skip: number[] = []) {
    for (let day = 1; day <= upTo; day++) {
      if (skip.includes(day)) continue;
      await prisma.programMissionSubmission.create({
        data: {
          memberId,
          dayNumber: day,
          attemptNumber: 1,
          payload: {},
          verdict: [],
          passed: true,
        },
      });
    }
  }

  /** Answers every question until the service says the interview is finished. */
  async function answerThrough(memberId: string, interviewId: string) {
    let guard = 0;
    for (;;) {
      if (guard++ > 60) throw new Error("turn loop did not terminate");

      const attempt = await loadActiveAttempt(interviewId, memberId);
      if (!attempt) return;

      const question =
        attempt.plan.questions[attempt.state.currentQuestionIndex] ?? null;
      if (!question) return;

      const turn = await recordCohortAnswer(
        memberId,
        interviewId,
        question.id,
        "I built the retrieval layer myself. I chunked the policy documents, " +
          "attached plan metadata, and checked the exclusion clauses survived " +
          "the split. The tradeoff was storage against context fidelity.",
      );
      if (!turn.ok) throw new Error(turn.message);
      if (turn.data.finished) return;
    }
  }

  /** Back-dates the attempt so the minimum-duration floor is satisfied. */
  async function backdate(interviewId: string, minutes = 10) {
    await prisma.generalInterview.update({
      where: { id: interviewId },
      data: { startedAt: new Date(Date.now() - minutes * 60 * 1000) },
    });
  }

  async function cleanup() {
    // GeneralInterview and ProgramMissionSubmission cascade from ProgramMember,
    // which cascades from User.
    await prisma.programMember.deleteMany({ where: { cohortId: cohort.id } });
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.programCohort.deleteMany({ where: { id: cohort.id } });
  }

  /* ----------------------------------------------------- the tests */

  try {
    console.log(`\nSmoke run ${RUN}\n  cohort ${cohort.id}`);

    section("Start gate — real mission submissions");

    const partial = await makeMember("partial");
    await passDays(partial.memberId, 14);

    await check("incomplete Day 15 blocks the DAY_15 interview", async () => {
      const gate = await assertCanStart(partial.memberId, "DAY_15");
      assert.equal(gate.ok, false);
      if (!gate.ok) assert.equal(gate.reason, "LOCKED");
    });

    await check("a blocked member cannot open an attempt row", async () => {
      const started = await startCohortInterview(partial.memberId, "DAY_15");
      assert.equal(started.ok, false);
      const rows = await prisma.generalInterview.count({
        where: { memberId: partial.memberId },
      });
      assert.equal(rows, 0, "a locked start created a row");
    });

    await check("a passed-day COUNT of 15 does not unlock DAY_15", async () => {
      // 14 days passed plus day 20 = fifteen passed days, but not days 1..15.
      await prisma.programMissionSubmission.create({
        data: {
          memberId: partial.memberId,
          dayNumber: 20,
          attemptNumber: 1,
          payload: {},
          verdict: [],
          passed: true,
        },
      });
      const gate = await assertCanStart(partial.memberId, "DAY_15");
      assert.equal(gate.ok, false);
    });

    await check("a FAILED day does not count toward the unlock", async () => {
      await prisma.programMissionSubmission.create({
        data: {
          memberId: partial.memberId,
          dayNumber: 15,
          attemptNumber: 1,
          payload: {},
          verdict: [],
          passed: false,
        },
      });
      const gate = await assertCanStart(partial.memberId, "DAY_15");
      assert.equal(gate.ok, false, "an unpassed day 15 unlocked the interview");
    });

    await check("passing the real day 15 unlocks it", async () => {
      await prisma.programMissionSubmission.create({
        data: {
          memberId: partial.memberId,
          dayNumber: 15,
          attemptNumber: 2,
          payload: {},
          verdict: [],
          passed: true,
        },
      });
      const gate = await assertCanStart(partial.memberId, "DAY_15");
      assert.equal(gate.ok, true);
    });

    await check("a DAY_15-complete member is still locked out of DAY_31", async () => {
      const gate = await assertCanStart(partial.memberId, "DAY_31");
      assert.equal(gate.ok, false);

      const eligibility = await getBlueprintEligibility(
        partial.memberId,
        "DAY_31",
      );
      assert.equal(eligibility.state, "locked");
      if (eligibility.state !== "locked") return;

      // This member has days 1..15 plus the stray day 20 from the count test
      // above. Day 20 IS inside the DAY_31 window, so it legitimately counts
      // here even though it counted for nothing against DAY_15 — which is the
      // distinction between "sixteen passed days" and "days 1..31 passed".
      assert.equal(eligibility.passedCount, 16);
      assert.equal(eligibility.missingDays.length, 15);
      assert.ok(!eligibility.missingDays.includes(20), "day 20 is passed");
      assert.deepEqual(eligibility.missingDays.slice(0, 3), [16, 17, 18]);
      assert.equal(eligibility.needed, 31);
    });

    await check("a day-27 gap blocks DAY_31", async () => {
      const gappy = await makeMember("gappy");
      await passDays(gappy.memberId, 31, [27]);
      const gate = await assertCanStart(gappy.memberId, "DAY_31");
      assert.equal(gate.ok, false);
      const eligibility = await getBlueprintEligibility(
        gappy.memberId,
        "DAY_31",
      );
      if (eligibility.state === "locked") {
        assert.deepEqual(eligibility.missingDays, [27]);
      }
    });

    /* ----------------------------------------------- the full loop */

    section("Full interview loop");

    let interviewId = "";

    await check("start creates exactly one IN_PROGRESS attempt", async () => {
      const started = await startCohortInterview(partial.memberId, "DAY_15");
      assert.equal(started.ok, true);
      if (!started.ok) return;

      interviewId = started.data.interviewId;
      assert.equal(started.data.blueprint, "DAY_15");
      assert.equal(started.data.resumed, false);
      assert.equal(started.data.question.order, 1);
      assert.equal(
        started.data.question.totalQuestions,
        questionCountFor("DAY_15"),
      );

      const row = await prisma.generalInterview.findUniqueOrThrow({
        where: { id: interviewId },
        select: { status: true, blueprint: true, scopeDays: true },
      });
      assert.equal(row.status, "IN_PROGRESS");
      assert.equal(row.blueprint, "DAY_15");
      assert.equal(row.scopeDays.length, 15);
    });

    await check("the frozen plan matches the DAY_15 bank exactly", async () => {
      const row = await prisma.generalInterview.findUniqueOrThrow({
        where: { id: interviewId },
        select: { plan: true },
      });
      const stored = row.plan as unknown as ReturnType<
        typeof planCohortInterview
      >;
      const expected = planCohortInterview("DAY_15");
      assert.deepEqual(
        stored.questions.map((q) => q.id),
        expected.questions.map((q) => q.id),
      );
      assert.deepEqual(
        stored.questions.map((q) => q.text),
        expected.questions.map((q) => q.text),
      );
    });

    await check("no stored question references a day after 15", async () => {
      const row = await prisma.generalInterview.findUniqueOrThrow({
        where: { id: interviewId },
        select: { plan: true },
      });
      const stored = row.plan as unknown as ReturnType<
        typeof planCohortInterview
      >;
      for (const q of stored.questions) {
        for (const day of q.sourceRef.sourceDays ?? []) {
          assert.ok(day <= 15, `${q.id} stored a day ${day} reference`);
        }
      }
    });

    await check(
      "starting again resumes rather than creating a second row",
      async () => {
        const again = await startCohortInterview(partial.memberId, "DAY_15");
        assert.equal(again.ok, true);
        if (again.ok) {
          assert.equal(again.data.interviewId, interviewId);
          assert.equal(again.data.resumed, true);
        }
        const count = await prisma.generalInterview.count({
          where: { memberId: partial.memberId, blueprint: "DAY_15" },
        });
        assert.equal(count, 1);
      },
    );

    await check("an answer for the wrong question is rejected", async () => {
      const turn = await recordCohortAnswer(
        partial.memberId,
        interviewId,
        "d31-q12",
        "trying to answer a Day 31 question",
      );
      assert.equal(turn.ok, false);
    });

    await check(
      "another member cannot load or answer this interview",
      async () => {
        const intruder = await makeMember("intruder");

        const loaded = await loadActiveAttempt(interviewId, intruder.memberId);
        assert.equal(loaded, null, "cross-member read succeeded");

        const turn = await recordCohortAnswer(
          intruder.memberId,
          interviewId,
          "d15-q03",
          "not my interview",
        );
        assert.equal(turn.ok, false, "cross-member write succeeded");
      },
    );

    await check("the interview runs to completion and scores", async () => {
      await answerThrough(partial.memberId, interviewId);
      await backdate(interviewId);

      const finished = await finishCohortInterview(
        partial.memberId,
        interviewId,
      );
      assert.equal(finished.ok, true);
      if (!finished.ok) return;

      assert.equal(finished.data.blueprint, "DAY_15");
      assert.ok(finished.data.scores.overallScore >= 0);
      assert.ok(finished.data.scores.overallScore <= 100);
      assert.equal(finished.data.scores.perCompetency.length, 5);
    });

    await check(
      "the completed row carries scores, transcript and evidence",
      async () => {
        const row = await prisma.generalInterview.findUniqueOrThrow({
          where: { id: interviewId },
          select: {
            status: true,
            overallScore: true,
            communicationScore: true,
            transcript: true,
            evidence: true,
            durationSec: true,
            evaluatedAt: true,
            endedAt: true,
          },
        });
        assert.equal(row.status, "COMPLETED");
        assert.notEqual(row.overallScore, null);
        assert.notEqual(row.communicationScore, null);
        assert.ok(Array.isArray(row.transcript));
        assert.ok((row.transcript as unknown[]).length > 0);
        assert.ok(row.evidence !== null);
        assert.ok((row.durationSec ?? 0) > 0);
        assert.notEqual(row.evaluatedAt, null);
        assert.notEqual(row.endedAt, null);
      },
    );

    /* -------------------------------------------- the one-attempt limit */

    section("Milestone limit");

    await check("a second DAY_15 interview is refused at the gate", async () => {
      const gate = await assertCanStart(partial.memberId, "DAY_15");
      assert.equal(gate.ok, false);
      if (!gate.ok) assert.equal(gate.reason, "TAKEN");
    });

    await check("start refuses to open a second DAY_15 attempt", async () => {
      const started = await startCohortInterview(partial.memberId, "DAY_15");
      assert.equal(started.ok, false);
      const count = await prisma.generalInterview.count({
        where: { memberId: partial.memberId, blueprint: "DAY_15" },
      });
      assert.equal(count, 1, "a second DAY_15 row was created");
    });

    await check(
      "the DB rejects a second COMPLETED row even bypassing the service",
      async () => {
        // Defence in depth: the partial unique index must hold against a writer
        // that never went through the service at all.
        await assert.rejects(
          prisma.generalInterview.create({
            data: {
              memberId: partial.memberId,
              blueprint: "DAY_15",
              status: "COMPLETED",
              plan: {},
              scopeDays: [],
            },
          }),
          /Unique constraint|P2002/,
        );
      },
    );

    await check(
      "the index allows many non-completed rows for the same blueprint",
      async () => {
        const a = await prisma.generalInterview.create({
          data: {
            memberId: partial.memberId,
            blueprint: "DAY_15",
            status: "ABANDONED",
            plan: {},
            scopeDays: [],
          },
          select: { id: true },
        });
        const b = await prisma.generalInterview.create({
          data: {
            memberId: partial.memberId,
            blueprint: "DAY_15",
            status: "INVALID",
            plan: {},
            scopeDays: [],
          },
          select: { id: true },
        });
        assert.notEqual(a.id, b.id);
        await prisma.generalInterview.deleteMany({
          where: { id: { in: [a.id, b.id] } },
        });
      },
    );

    /* ----------------------------------------- abandon consumes nothing */

    section("Abandon and invalid consume no milestone");

    await check(
      "an abandoned attempt leaves the milestone claimable",
      async () => {
        const fresh = await makeMember("abandoner");
        await passDays(fresh.memberId, 15);

        const started = await startCohortInterview(fresh.memberId, "DAY_15");
        assert.equal(started.ok, true);
        if (!started.ok) return;

        const abandoned = await abandonCohortInterview(
          fresh.memberId,
          started.data.interviewId,
        );
        assert.equal(abandoned.ok, true);

        const row = await prisma.generalInterview.findUniqueOrThrow({
          where: { id: started.data.interviewId },
          select: { status: true },
        });
        assert.equal(row.status, "ABANDONED");

        // Still claimable.
        const gate = await assertCanStart(fresh.memberId, "DAY_15");
        assert.equal(gate.ok, true, "abandoning consumed the milestone");

        const restarted = await startCohortInterview(fresh.memberId, "DAY_15");
        assert.equal(restarted.ok, true);
        assert.notEqual(
          restarted.ok && restarted.data.interviewId,
          started.data.interviewId,
        );
      },
    );

    await check(
      "a too-short interview is INVALID and consumes nothing",
      async () => {
        const quick = await makeMember("quick");
        await passDays(quick.memberId, 15);

        const started = await startCohortInterview(quick.memberId, "DAY_15");
        assert.equal(started.ok, true);
        if (!started.ok) return;

        // No backdating: the attempt is seconds old, under the 180s floor.
        const finished = await finishCohortInterview(
          quick.memberId,
          started.data.interviewId,
        );
        assert.equal(finished.ok, false, "a seconds-long interview was scored");

        const row = await prisma.generalInterview.findUniqueOrThrow({
          where: { id: started.data.interviewId },
          select: { status: true, overallScore: true, invalidReason: true },
        });
        assert.equal(row.status, "INVALID");
        assert.equal(row.overallScore, null);
        assert.notEqual(row.invalidReason, null);

        const gate = await assertCanStart(quick.memberId, "DAY_15");
        assert.equal(gate.ok, true, "an invalid attempt consumed the milestone");
      },
    );

    /* ------------------------------------------------ DAY_31 end to end */

    section("DAY_31");

    await check("a fully-passed member completes DAY_31", async () => {
      const finisher = await makeMember("finisher");
      await passDays(finisher.memberId, 31);

      const started = await startCohortInterview(finisher.memberId, "DAY_31");
      assert.equal(started.ok, true);
      if (!started.ok) return;

      assert.equal(
        started.data.question.totalQuestions,
        questionCountFor("DAY_31"),
      );

      await answerThrough(finisher.memberId, started.data.interviewId);
      await backdate(started.data.interviewId);

      const finished = await finishCohortInterview(
        finisher.memberId,
        started.data.interviewId,
      );
      assert.equal(finished.ok, true);

      // DAY_15 remains independently claimable — the milestones do not interact.
      const day15Gate = await assertCanStart(finisher.memberId, "DAY_15");
      assert.equal(day15Gate.ok, true);
      assert.equal(await findActiveAttemptId(finisher.memberId, "DAY_31"), null);
    });
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    console.log(`\n${passedChecks} checks passed, ${failures.length} failed`);
    if (failures.length > 0) {
      console.log("\nFailures:");
      for (const f of failures) console.log(`  - ${f}`);
      process.exit(1);
    }
    console.log("");
  })
  .catch((e) => {
    console.error("\nSmoke run crashed:", e);
    process.exit(1);
  });
