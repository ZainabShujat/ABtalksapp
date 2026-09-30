/**
 * Seed 3 program members with varied evidence for Scout scoring QA.
 *
 * Usage (after hire migration applied on Neon branch):
 *   npx tsx prisma/seed-hire-fixtures.ts
 *
 * Idempotent on emails *@hire.abtalks.dev.
 * Does NOT run if DATABASE_URL looks like known production hosts.
 */
import { config } from "dotenv";
import { Role, CandidatePersona, EnrollmentStatusV2 } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";
import {
  cohortSlugForProgramCohort,
  mintProgressRowId,
  peIdForMember,
} from "../src/repositories/ids";

config({ path: ".env.local" });
config();

const PRODUCTION_DB_HOST_IDS = ["ep-nameless-term-ams9a5e3", ".main."] as const;
const SUFFIX = "@hire.abtalks.dev";
const COHORT_NAME = "AI Cohort — Hire Scout Fixtures";

function assertNotProductionDb() {
  const url = process.env.DATABASE_URL ?? "";
  for (const id of PRODUCTION_DB_HOST_IDS) {
    if (url.includes(id)) {
      throw new Error(
        `Refusing to seed: DATABASE_URL looks like production (${id}). Use a Neon branch.`,
      );
    }
  }
}

async function upsertUser(email: string, name: string) {
  return prisma.user.upsert({
    where: { email },
    create: {
      email,
      name,
      password: await hashPassword("test"),
      role: Role.STUDENT,
      emailVerified: new Date(),
    },
    update: { name },
    select: { id: true, email: true },
  });
}

async function main() {
  assertNotProductionDb();

  const cohort = await prisma.programCohort.upsert({
    where: { joinCode: "HIRESCOUT" },
    create: {
      name: COHORT_NAME,
      joinCode: "HIRESCOUT",
      startsAt: new Date("2026-06-01"),
      endsAt: new Date("2026-07-01"),
      status: "COMPLETED",
      requiresJoinCode: true,
      resultsPublishedAt: new Date(),
      capacity: 50,
    },
    update: {
      resultsPublishedAt: new Date(),
      status: "COMPLETED",
      name: COHORT_NAME,
    },
    select: { id: true, name: true },
  });

  const fixtures = [
    {
      email: `strong${SUFFIX}`,
      name: "Scout Strong",
      skills: ["Python", "SQL", "TypeScript", "Docker"],
      missionPoints: 240,
      cleanPassCount: 18,
      totalScore: 520,
      years: 4,
      commits: 22,
      projects: [88, 92],
      interview: { overall: 86, comm: 84, tech: 88, problem: 85 },
    },
    {
      email: `narrow${SUFFIX}`,
      name: "Scout Narrow",
      skills: ["Python", "FastAPI"],
      missionPoints: 120,
      cleanPassCount: 8,
      totalScore: 280,
      years: 2,
      commits: 10,
      projects: [75],
      interview: { overall: 70, comm: 72, tech: 74, problem: 68 },
    },
    {
      email: `consistent${SUFFIX}`,
      name: "Scout Consistent",
      skills: ["Python", "SQL", "dbt"],
      missionPoints: 96,
      cleanPassCount: 5,
      totalScore: 240,
      years: 3,
      commits: 28,
      projects: [60, 65],
      interview: null as null | {
        overall: number;
        comm: number;
        tech: number;
        problem: number;
      },
    },
  ];

  for (const f of fixtures) {
    const user = await upsertUser(f.email, f.name);
    const slug = cohortSlugForProgramCohort(cohort.id);
    let learningCohort = await prisma.cohort.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!learningCohort) {
      const version = await prisma.programVersion.findFirst({
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!version) {
        throw new Error("Missing ProgramVersion — run db:seed:program first");
      }
      learningCohort = await prisma.cohort.create({
        data: {
          programVersionId: version.id,
          slug,
          name: COHORT_NAME,
          startMode: "FIXED",
          startsAt: new Date("2026-06-01"),
          endsAt: new Date("2026-07-01"),
          timezone: "Asia/Kolkata",
          status: "COMPLETED",
          capacity: 50,
          joinCode: "HIRESCOUT",
          requiresJoinCode: true,
          resultsPublishedAt: new Date(),
        },
        select: { id: true },
      });
    }

    const existingPe = await prisma.programEnrollment.findUnique({
      where: {
        userId_cohortId: { userId: user.id, cohortId: learningCohort.id },
      },
      select: { id: true },
    });
    const memberId = existingPe
      ? existingPe.id.replace(/^pe_pm_/, "")
      : mintProgressRowId();
    const peId = existingPe?.id ?? peIdForMember(memberId);
    const member = { id: memberId };

    await prisma.programEnrollment.upsert({
      where: { id: peId },
      create: {
        id: peId,
        userId: user.id,
        cohortId: learningCohort.id,
        status: EnrollmentStatusV2.COMPLETED,
        startedAt: new Date("2026-06-01"),
        joinedAt: new Date("2026-06-01"),
        enrolledAt: new Date("2026-06-01"),
        completedAt: new Date("2026-07-01"),
        githubRepoUrl: `https://github.com/example/${f.email.split("@")[0]}`,
        missionPoints: f.missionPoints,
        cleanPassCount: f.cleanPassCount,
        totalScore: f.totalScore,
        projectPoints: f.projects.reduce((a, b) => a + b, 0),
        commitPoints: f.commits * 2,
      },
      update: {
        status: EnrollmentStatusV2.COMPLETED,
        missionPoints: f.missionPoints,
        cleanPassCount: f.cleanPassCount,
        totalScore: f.totalScore,
        projectPoints: f.projects.reduce((a, b) => a + b, 0),
        commitPoints: f.commits * 2,
      },
    });

    await prisma.candidateProfile.upsert({
      where: { userId: user.id },
      create: {
        id: `cp_${user.id}`,
        userId: user.id,
        fullName: f.name,
        primaryPersona: CandidatePersona.PROFESSIONAL,
        githubUsername: f.email.split("@")[0]!,
        referralCode: `HIRE${user.id.slice(-6).toUpperCase()}`,
      },
      update: { fullName: f.name },
    });

    // Commit days (idempotent-ish: delete + recreate for fixture member)
    await prisma.programCommitDay.deleteMany({ where: { memberId: member.id } });
    const days = [];
    for (let i = 0; i < f.commits; i++) {
      const d = new Date("2026-06-01");
      d.setUTCDate(d.getUTCDate() + i);
      days.push({
        memberId: member.id,
        programEnrollmentId: `pe_pm_${member.id}`,
        date: d,
        commitCount: 1 + (i % 3),
      });
    }
    if (days.length) {
      await prisma.programCommitDay.createMany({ data: days });
    }

    await prisma.programProject.deleteMany({ where: { memberId: member.id } });
    for (let i = 0; i < f.projects.length; i++) {
      await prisma.programProject.create({
        data: {
          memberId: member.id,
          programEnrollmentId: `pe_pm_${member.id}`,
          moduleNumber: i + 1,
          repoUrl: `https://github.com/example/proj-${i + 1}`,
          writeup: `Fixture project using ${f.skills.join(", ")}`,
          status: "GRADED",
          aiScore: f.projects[i],
          adminScore: f.projects[i],
          gradedAt: new Date(),
        },
      });
    }

    if (f.interview) {
      await prisma.programInterview.upsert({
        where: { memberId: member.id },
        create: {
          memberId: member.id,
          programEnrollmentId: `pe_pm_${member.id}`,
          status: "COMPLETED",
          overallScore: f.interview.overall,
          commScore: f.interview.comm,
          techScore: f.interview.tech,
          problemScore: f.interview.problem,
          summary: "Fixture interview summary.",
          evaluatedAt: new Date(),
        },
        update: {
          status: "COMPLETED",
          overallScore: f.interview.overall,
          commScore: f.interview.comm,
          techScore: f.interview.tech,
          problemScore: f.interview.problem,
        },
      });
    } else {
      await prisma.programInterview.deleteMany({ where: { memberId: member.id } });
    }

    console.log(`  member ${f.email} → ${member.id}`);
  }

  // Approved recruiter for /hire smoke
  const rec = await upsertUser(`recruiter${SUFFIX}`, "Hire Recruiter");
  await prisma.user.update({
    where: { id: rec.id },
    data: { role: Role.RECRUITER, password: await hashPassword("test") },
  });
  await prisma.recruiterProfile.upsert({
    where: { userId: rec.id },
    create: {
      userId: rec.id,
      fullName: "Hire Recruiter",
      company: "Scout Test Co",
      approved: true,
      approvedAt: new Date(),
    },
    update: { approved: true, approvedAt: new Date() },
  });
  console.log(`  recruiter recruiter${SUFFIX} / password test`);

  console.log("Done. Cohort:", cohort.name);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
