/**
 * Seeds a disposable demo candidate with the FULL 31-day cohort completed.
 *
 *   npx tsx scripts/seed-demo-candidate.ts
 *
 * Why this exists: demoing the Day 31 Final Interview needs a member who has
 * genuinely passed days 1..31, because `isBlueprintUnlocked` requires every day
 * in scope — not a count, not a highest-day. Setting `BYPASS_DAY_LOCKS=true`
 * also opens the milestone, but it opens ALL of them for everyone and hides the
 * real unlock behaviour, so it is the wrong thing to show a teammate.
 *
 * SAFETY
 *   - binds `DATABASE_SAMPLE_URL`, never `DATABASE_URL`
 *   - refuses to run if the target looks production-shaped (row counts, the
 *     same rule as scripts/db-preflight.mjs)
 *   - idempotent: re-running updates the same rows, and it touches ONLY this
 *     candidate. Existing members and their interviews/reports are never read
 *     for writing, never reset, never deleted.
 */
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

const sampleUrl = process.env.DATABASE_SAMPLE_URL;
if (!sampleUrl) {
  console.error("\n  DATABASE_SAMPLE_URL is not set. Refusing to run.\n");
  process.exit(1);
}
process.env.DATABASE_URL = sampleUrl;
process.env.DIRECT_URL = sampleUrl.replace("-pooler", "");

// NOTE: the import above is hoisted, but PrismaClient reads DATABASE_URL when
// it is CONSTRUCTED, not when the module loads — so the binding above applies.

const MAX_USERS = 500;
const MAX_SUBMISSIONS = 400;

const EMAIL = "demo-day31@abtalks.dev";
const PASSWORD = "demo-day31";
const NAME = "Ishaan Kapoor";
const TOTAL_DAYS = 31;

const prisma = new PrismaClient();

async function main() {
  // ---------------------------------------------------------------- guard
  const [users, submissions] = await Promise.all([
    prisma.user.count(),
    prisma.programMissionSubmission.count(),
  ]);

  if (users > MAX_USERS || submissions > MAX_SUBMISSIONS) {
    console.error(
      `\n  REFUSING TO WRITE — target looks like production.\n` +
        `  users=${users} (max ${MAX_USERS}), submissions=${submissions} (max ${MAX_SUBMISSIONS})\n`,
    );
    process.exit(1);
  }
  console.log(
    `\n  target      ${new URL(sampleUrl!).host}\n` +
      `  users       ${users}\n` +
      `  verdict     disposable test database — safe\n`,
  );

  // ----------------------------------------------------------- the cohort
  // Reuse whichever cohort the existing demo members sit in, so the new
  // candidate appears in the same place. Only create one if none exists.
  let cohort = await prisma.programCohort.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });

  if (!cohort) {
    cohort = await prisma.programCohort.create({
      data: {
        name: "AI Cohort — E2E Test",
        joinCode: "E2E-TEST",
        startsAt: new Date(Date.now() - 40 * 24 * 3600 * 1000),
        endsAt: new Date(Date.now() + 10 * 24 * 3600 * 1000),
        capacity: 100,
        status: "ACTIVE",
        requiresJoinCode: false,
      },
      select: { id: true, name: true },
    });
    console.log(`  created cohort "${cohort.name}"`);
  }

  // ------------------------------------------------------------ the user
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { password: PASSWORD, name: NAME },
    create: { email: EMAIL, password: PASSWORD, name: NAME },
    select: { id: true },
  });

  const member = await prisma.programMember.upsert({
    where: { userId_cohortId: { userId: user.id, cohortId: cohort.id } },
    update: { highestUnlockedDay: TOTAL_DAYS, status: "ENROLLED" },
    create: {
      userId: user.id,
      cohortId: cohort.id,
      status: "ENROLLED",
      fullName: NAME,
      jobRole: "Platform Engineer",
      company: "Meridian Health",
      yearsExperience: 4,
      githubUsername: "ishaan-demo",
      githubRepoUrl: "https://github.com/ishaan/ai-cohort",
      highestUnlockedDay: TOTAL_DAYS,
    },
    select: { id: true },
  });

  // ------------------------------------------------- 31 passed mission days
  // One passed submission per day. `collectPassSkipSets` reads `passed`, so
  // this is exactly what the unlock rule checks.
  for (let day = 1; day <= TOTAL_DAYS; day++) {
    const existing = await prisma.programMissionSubmission.findFirst({
      where: { memberId: member.id, dayNumber: day },
      select: { id: true },
    });

    const data = {
      passed: true,
      pointsAwarded: 12,
      payload: { repoRef: `day${day}_solution.py` },
      verdict: [{ check: "seed", detail: "demo", passed: true }],
    };

    if (existing) {
      await prisma.programMissionSubmission.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.programMissionSubmission.create({
        data: { ...data, memberId: member.id, dayNumber: day, attemptNumber: 1 },
      });
    }
  }

  const passed = await prisma.programMissionSubmission.count({
    where: { memberId: member.id, passed: true },
  });

  const interviews = await prisma.generalInterview.findMany({
    where: { memberId: member.id },
    select: { blueprint: true, status: true },
  });

  console.log(
    `  member      ${member.id} (${NAME})\n` +
      `  passed days ${passed}/${TOTAL_DAYS}\n` +
      `  interviews  ${interviews.length === 0 ? "none — both milestones open" : JSON.stringify(interviews)}\n\n` +
      `  LOGIN\n` +
      `    email     ${EMAIL}\n` +
      `    password  ${PASSWORD}\n`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
