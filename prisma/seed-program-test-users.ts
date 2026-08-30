/**
 * Seed AI Cohort test users for local/dev testing.
 *
 * Usage: npm run db:seed:program:users
 *
 * Logins (password "test" unless noted):
 *   prog.day1@abtalks.dev       ENROLLED, Day 1 unlocked
 *   prog.day3@abtalks.dev       ENROLLED, Day 3 unlocked (pack A smoke)
 *   prog.mid@abtalks.dev        ENROLLED, Day 10 unlocked (checkpoint)
 *   prog.apply@abtalks.dev      user only — start apply funnel
 *   prog.applied@abtalks.dev    APPLIED (not yet assessed)
 *   prog.waitlist@abtalks.dev   WAITLISTED
 *   prog.recruiter@abtalks.dev  approved recruiter → /talent
 *   prog.recruiter.pending@abtalks.dev  pending recruiter
 *
 * Ensures one non-ARCHIVED cohort (creates "AI Cohort — Test Batch" if missing).
 * Idempotent: upserts these emails only; does not wipe challenge test users.
 */
import { config } from "dotenv";
import {
  ProgramMemberStatus,
  Role,
  type PrismaClient,
} from "@prisma/client";
import { prisma } from "../src/lib/db";

config({ path: ".env.local" });
config();

const TEST_EMAIL_SUFFIX = "@abtalks.dev";
const DEV_PASSWORD = "test";
const DEV_NEON_HOST_ID = "ep-young-shadow-amawetjy";
const PRODUCTION_DB_HOST_IDS = ["ep-nameless-term-ams9a5e3", ".main."] as const;
const COHORT_NAME = "AI Cohort — Test Batch";
const EMAIL_PREFIX = "prog.";

type MemberSeed = {
  email: string;
  name: string;
  status: ProgramMemberStatus;
  highestUnlockedDay: number;
  githubUsername: string;
  enrolled?: boolean;
};

type UserOnlySeed = {
  email: string;
  name: string;
  role?: Role;
};

const MEMBER_USERS: MemberSeed[] = [
  {
    email: `${EMAIL_PREFIX}day1${TEST_EMAIL_SUFFIX}`,
    name: "Prog Day One",
    status: "ENROLLED",
    highestUnlockedDay: 1,
    githubUsername: "prog-day1",
    enrolled: true,
  },
  {
    email: `${EMAIL_PREFIX}day3${TEST_EMAIL_SUFFIX}`,
    name: "Prog Day Three",
    status: "ENROLLED",
    highestUnlockedDay: 3,
    githubUsername: "prog-day3",
    enrolled: true,
  },
  {
    email: `${EMAIL_PREFIX}mid${TEST_EMAIL_SUFFIX}`,
    name: "Prog Mid Checkpoint",
    status: "ENROLLED",
    highestUnlockedDay: 10,
    githubUsername: "prog-mid",
    enrolled: true,
  },
  {
    email: `${EMAIL_PREFIX}day15${TEST_EMAIL_SUFFIX}`,
    name: "Prog Day Fifteen",
    status: "ENROLLED",
    highestUnlockedDay: 15,
    githubUsername: "prog-day15",
    enrolled: true,
  },
  {
    email: `${EMAIL_PREFIX}day31${TEST_EMAIL_SUFFIX}`,
    name: "Prog Day Thirty-One",
    status: "ENROLLED",
    highestUnlockedDay: 31,
    githubUsername: "prog-day31",
    enrolled: true,
  },
  {
    email: `${EMAIL_PREFIX}applied${TEST_EMAIL_SUFFIX}`,
    name: "Prog Applied",
    status: "APPLIED",
    highestUnlockedDay: 1,
    githubUsername: "prog-applied",
  },
  {
    email: `${EMAIL_PREFIX}waitlist${TEST_EMAIL_SUFFIX}`,
    name: "Prog Waitlist",
    status: "WAITLISTED",
    highestUnlockedDay: 1,
    githubUsername: "prog-waitlist",
  },
];

const APPLY_USER: UserOnlySeed = {
  email: `${EMAIL_PREFIX}apply${TEST_EMAIL_SUFFIX}`,
  name: "Prog Apply Fresh",
};

const RECRUITERS: {
  email: string;
  name: string;
  company: string;
  approved: boolean;
}[] = [
  {
    email: `${EMAIL_PREFIX}recruiter${TEST_EMAIL_SUFFIX}`,
    name: "Prog Recruiter",
    company: "ABTalks Hiring Co",
    approved: true,
  },
  {
    email: `${EMAIL_PREFIX}recruiter.pending${TEST_EMAIL_SUFFIX}`,
    name: "Prog Recruiter Pending",
    company: "Pending Talent Inc",
    approved: false,
  },
];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function assertNotProduction() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const nodeEnv = process.env.NODE_ENV ?? "";
  const allowOverride = process.env.SEED_ALLOW_PRODUCTION === "true";

  if (allowOverride) {
    console.warn("⚠️  SEED_ALLOW_PRODUCTION=true — bypassing production guard");
    return;
  }

  if (nodeEnv === "production") {
    fail("❌ NODE_ENV is production. Refusing to seed program test users.");
  }

  const dbLower = dbUrl.toLowerCase();
  for (const indicator of PRODUCTION_DB_HOST_IDS) {
    if (dbLower.includes(indicator.toLowerCase())) {
      fail(
        `❌ DATABASE_URL looks like production (${indicator}). Refusing to seed.`,
      );
    }
  }

  if (!dbLower.includes(DEV_NEON_HOST_ID) && !dbLower.includes("localhost")) {
    const host = dbUrl.split("@")[1]?.split("/")[0] ?? "(unknown)";
    fail(
      "❌ DATABASE_URL doesn't look like the known dev DB.\n" +
        `   URL host: ${host}\n` +
        "   Set SEED_ALLOW_PRODUCTION=true to override (NOT RECOMMENDED)",
    );
  }
}

async function ensureUser(
  db: PrismaClient,
  email: string,
  name: string,
  role: Role = Role.STUDENT,
): Promise<string> {
  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    await db.user.update({
      where: { id: existing.id },
      data: { password: DEV_PASSWORD, name, role },
    });
    return existing.id;
  }
  const created = await db.user.create({
    data: {
      email,
      password: DEV_PASSWORD,
      name,
      role,
      emailVerified: new Date(),
    },
    select: { id: true },
  });
  return created.id;
}

async function ensureCohort(db: PrismaClient): Promise<{
  id: string;
  name: string;
  created: boolean;
}> {
  const existing = await db.programCohort.findFirst({
    where: { status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, status: true, joinCode: true },
  });
  if (existing) {
    if (existing.status === "DRAFT") {
      await db.programCohort.update({
        where: { id: existing.id },
        data: { status: "ENROLLING" },
      });
      console.log(
        `[program-users] promoted cohort "${existing.name}" DRAFT → ENROLLING`,
      );
    }
    return { id: existing.id, name: existing.name, created: false };
  }

  const startsAt = new Date();
  startsAt.setUTCHours(0, 0, 0, 0);
  const endsAt = new Date(startsAt);
  endsAt.setUTCDate(endsAt.getUTCDate() + 38);

  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let joinCode = "";
  for (let i = 0; i < 8; i++) {
    joinCode += alphabet[Math.floor(Math.random() * alphabet.length)]!;
  }

  const created = await db.programCohort.create({
    data: {
      name: COHORT_NAME,
      joinCode,
      startsAt,
      endsAt,
      capacity: 50,
      status: "ENROLLING",
    },
    select: { id: true, name: true },
  });
  console.log(`[program-users] created cohort join code: ${joinCode}`);
  return { id: created.id, name: created.name, created: true };
}

async function upsertMember(
  db: PrismaClient,
  cohortId: string,
  userId: string,
  seed: MemberSeed,
) {
  const profile = {
    fullName: seed.name,
    jobRole: "Student",
    company: "ABTalks Test College",
    yearsExperience: 0,
    education: "B.Tech CSE",
    university: "Test University",
    graduationYear: 2026,
    skills: ["Python", "Git", "AI"],
    linkedinUrl: `https://linkedin.com/in/${seed.githubUsername}`,
    resumeUrl: null as string | null,
    phone: null as string | null,
    githubUsername: seed.githubUsername,
    githubRepoUrl: `https://github.com/${seed.githubUsername}/ai-cohort`,
    status: seed.status,
    highestUnlockedDay: seed.highestUnlockedDay,
    enrolledAt: seed.enrolled ? new Date() : null,
  };

  await db.programMember.upsert({
    where: { userId_cohortId: { userId, cohortId } },
    create: { userId, cohortId, ...profile },
    update: profile,
  });
}

async function seedProgramTestUsers() {
  assertNotProduction();
  console.log("[program-users] starting…");

  const cohort = await ensureCohort(prisma);
  console.log(
    cohort.created
      ? `[program-users] created cohort "${cohort.name}"`
      : `[program-users] using existing cohort "${cohort.name}"`,
  );

  for (const m of MEMBER_USERS) {
    const userId = await ensureUser(prisma, m.email, m.name);
    await upsertMember(prisma, cohort.id, userId, m);
    console.log(
      `   ${m.email} → ${m.status}, day ${m.highestUnlockedDay} (password: ${DEV_PASSWORD})`,
    );
  }

  await ensureUser(prisma, APPLY_USER.email, APPLY_USER.name);
  // Fresh apply funnel: remove any prior membership so /program/apply shows the form
  await prisma.programMember.deleteMany({
    where: {
      cohortId: cohort.id,
      user: { email: APPLY_USER.email },
    },
  });
  console.log(
    `   ${APPLY_USER.email} → user only, no membership (password: ${DEV_PASSWORD})`,
  );

  for (const r of RECRUITERS) {
    const userId = await ensureUser(prisma, r.email, r.name, Role.RECRUITER);
    await prisma.recruiterProfile.upsert({
      where: { userId },
      create: {
        userId,
        fullName: r.name,
        company: r.company,
        approved: r.approved,
        approvedAt: r.approved ? new Date() : null,
      },
      update: {
        fullName: r.name,
        company: r.company,
        approved: r.approved,
        approvedAt: r.approved ? new Date() : null,
      },
    });
    console.log(
      `   ${r.email} → recruiter ${r.approved ? "APPROVED" : "PENDING"} (password: ${DEV_PASSWORD})`,
    );
  }

  console.log("[program-users] done");
  console.log(`
Quick starts:
  Day 1 member:     ${EMAIL_PREFIX}day1${TEST_EMAIL_SUFFIX} / ${DEV_PASSWORD}
  Day 3 member:     ${EMAIL_PREFIX}day3${TEST_EMAIL_SUFFIX} / ${DEV_PASSWORD}
  Day 15 member:    ${EMAIL_PREFIX}day15${TEST_EMAIL_SUFFIX} / ${DEV_PASSWORD}
  Day 31 member:    ${EMAIL_PREFIX}day31${TEST_EMAIL_SUFFIX} / ${DEV_PASSWORD}
  Apply funnel:     ${APPLY_USER.email} / ${DEV_PASSWORD}
  Recruiter pool:   ${RECRUITERS[0]!.email} / ${DEV_PASSWORD}
`);
}

seedProgramTestUsers()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[program-users] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
