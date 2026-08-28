/**
 * Copy StudentProfile.referralCode onto CandidateProfile for the same user.
 * Production write: authorized for the six known placeholders.
 * Does not mint codes, change StudentProfile, or touch Referral rows.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { assertChildBranch } from "./migrate-078-shared";

config({ path: ".env.local" });
config();

const prisma = new PrismaClient();

async function main() {
  assertChildBranch();

  const mismatches = await prisma.$queryRaw<
    { userId: string; spCode: string; cpCode: string }[]
  >`
    SELECT sp."userId",
           sp."referralCode" AS "spCode",
           cp."referralCode" AS "cpCode"
    FROM "StudentProfile" sp
    JOIN "CandidateProfile" cp ON cp."userId" = sp."userId"
    WHERE sp."referralCode" IS DISTINCT FROM cp."referralCode"
  `;

  const collisions = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM "StudentProfile" sp
    JOIN "CandidateProfile" mine ON mine."userId" = sp."userId"
    JOIN "CandidateProfile" other
      ON other."referralCode" = sp."referralCode"
     AND other."userId" <> sp."userId"
    WHERE sp."referralCode" IS DISTINCT FROM mine."referralCode"
  `;

  const collisionCount = collisions[0]?.n ?? 0;
  console.log(
    JSON.stringify({
      mismatchCount: mismatches.length,
      collisionCount,
      mismatchCodeLens: mismatches.map((m) => ({
        spLen: m.spCode.length,
        cpLen: m.cpCode.length,
      })),
    }),
  );

  if (collisionCount !== 0) {
    throw new Error(
      `Preflight failed: ${collisionCount} StudentProfile codes belong to a different CandidateProfile user`,
    );
  }

  if (mismatches.length === 0) {
    console.log("No referral mismatches. Nothing to repair.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const row of mismatches) {
      await tx.candidateProfile.update({
        where: { userId: row.userId },
        data: { referralCode: row.spCode },
      });
    }
  });

  const remaining = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM "StudentProfile" sp
    JOIN "CandidateProfile" cp ON cp."userId" = sp."userId"
    WHERE sp."referralCode" IS DISTINCT FROM cp."referralCode"
  `;
  const remainingN = remaining[0]?.n ?? -1;
  if (remainingN !== 0) {
    throw new Error(`Post-repair mismatch count is ${remainingN}, expected 0`);
  }

  const crossTable = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM "StudentProfile" sp
    JOIN "CandidateProfile" cp ON cp."referralCode" = sp."referralCode"
    WHERE cp."userId" <> sp."userId"
  `;
  const crossTableN = crossTable[0]?.n ?? -1;
  if (crossTableN !== 0) {
    throw new Error(
      `Post-repair cross-table referral collision count is ${crossTableN}, expected 0`,
    );
  }

  console.log(
    JSON.stringify({
      remainingMismatch: remainingN,
      crossTableCollisions: crossTableN,
    }),
  );
  console.log(
    "Repair complete. All StudentProfile.referralCode match CandidateProfile.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
