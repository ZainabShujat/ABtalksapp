/**
 * One-time catch-up: StudentProfile.skills → Skill + CandidateSkill, and
 * repair deterministic edu_sp_* / exp_sp_* rows from StudentProfile.
 *
 * Does not rewrite CandidateProfile scalars (preserves 2a ProgramMember extras).
 * Does not delete SkillEvidence. Production write authorized after deploy.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { assertChildBranch } from "./migrate-078-shared";
import {
  syncCandidateSkillsFromLegacy,
  syncProfileOwnedEducation,
  syncProfileOwnedExperience,
} from "../../src/repositories/dual-write";

config({ path: ".env.local" });
config();

const prisma = new PrismaClient();
const BATCH = 25;

async function verify(): Promise<{
  referralMismatch: number;
  crossTableCollisions: number;
  missingSkills: number;
  extraEduSp: number;
  extraExpSp: number;
}> {
  const referralMismatch = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM "StudentProfile" sp
    JOIN "CandidateProfile" cp ON cp."userId" = sp."userId"
    WHERE sp."referralCode" IS DISTINCT FROM cp."referralCode"
  `;
  const crossTableCollisions = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM "StudentProfile" sp
    JOIN "CandidateProfile" cp ON cp."referralCode" = sp."referralCode"
    WHERE cp."userId" <> sp."userId"
  `;
  const missingSkills = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM "StudentProfile" sp
    JOIN "CandidateProfile" cp ON cp."userId" = sp."userId"
    WHERE cardinality(sp.skills) > 0
      AND NOT EXISTS (
        SELECT 1 FROM "CandidateSkill" cs WHERE cs."userId" = sp."userId"
      )
  `;
  const extraEduSp = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM (
      SELECT "userId"
      FROM "CandidateEducation"
      WHERE id LIKE 'edu_sp_%'
      GROUP BY "userId"
      HAVING COUNT(*) > 1
    ) d
  `;
  const extraExpSp = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM (
      SELECT "userId"
      FROM "CandidateExperience"
      WHERE id LIKE 'exp_sp_%'
      GROUP BY "userId"
      HAVING COUNT(*) > 1
    ) d
  `;
  return {
    referralMismatch: referralMismatch[0]?.n ?? -1,
    crossTableCollisions: crossTableCollisions[0]?.n ?? -1,
    missingSkills: missingSkills[0]?.n ?? -1,
    extraEduSp: extraEduSp[0]?.n ?? -1,
    extraExpSp: extraExpSp[0]?.n ?? -1,
  };
}

async function main() {
  assertChildBranch();
  const verifyOnly = process.env.CATCHUP_VERIFY_ONLY === "1";

  if (!verifyOnly) {
    let processed = 0;
    let skippedNoCp = 0;
    let cursor: string | undefined;

    for (;;) {
      const batch = await prisma.studentProfile.findMany({
        take: BATCH,
        ...(cursor
          ? { skip: 1, cursor: { userId: cursor } }
          : {}),
        orderBy: { userId: "asc" },
        select: {
          userId: true,
          college: true,
          collegeId: true,
          graduationYear: true,
          organization: true,
          role: true,
          yearsExperience: true,
          skills: true,
        },
      });
      if (batch.length === 0) break;

      await prisma.$transaction(
        async (tx) => {
          for (const sp of batch) {
            const cp = await tx.candidateProfile.findUnique({
              where: { userId: sp.userId },
              select: { userId: true },
            });
            if (!cp) {
              skippedNoCp += 1;
              continue;
            }
            await syncProfileOwnedEducation(tx, sp.userId, sp);
            await syncProfileOwnedExperience(tx, sp.userId, sp);
            await syncCandidateSkillsFromLegacy(tx, sp.userId, sp.skills);
            processed += 1;
          }
        },
        { maxWait: 15000, timeout: 120000 },
      );

      cursor = batch[batch.length - 1]?.userId;
      if (processed % 250 === 0) {
        console.log(JSON.stringify({ processed, skippedNoCp, cursor }));
      }
    }

    console.log(JSON.stringify({ processed, skippedNoCp, done: true }));
  }

  const counts = await verify();
  console.log(JSON.stringify({ verify: counts }));
  if (
    counts.referralMismatch !== 0 ||
    counts.crossTableCollisions !== 0 ||
    counts.missingSkills !== 0 ||
    counts.extraEduSp !== 0 ||
    counts.extraExpSp !== 0
  ) {
    throw new Error(
      `Catch-up verify failed: ${JSON.stringify(counts)}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
