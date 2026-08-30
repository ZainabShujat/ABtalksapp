/**
 * W1-B prep — copy PointsAccount.balance onto legacy compatibility mirrors.
 *
 * Authoritative: PointsAccount.balance
 * Repair: User.synergyPoints = balance; StudentProfile.synergyPoints = balance
 *
 * Never updates PointsAccount or PointsTransaction.
 * Never creates a PointsAccount from User.
 * Dry-run unless --apply. Child by default; production needs
 * PHASE2_ALLOW_PRODUCTION=1 + direct host.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { assertChildBranch } from "./migrate-078-shared";

config({ path: ".env.local" });
config();

const prisma = new PrismaClient();

type CountRow = { n: bigint };
type MismatchRow = {
  userId: string;
  paBalance: number;
  userSynergy: number;
  profileSynergy: number | null;
};

async function countPointsVsUser(): Promise<number> {
  const rows = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS n
      FROM "PointsAccount" pa
      JOIN "User" u ON u.id = pa."userId"
     WHERE pa.balance <> u."synergyPoints"
  `;
  return Number(rows[0]?.n ?? 0);
}

async function countPointsVsProfile(): Promise<number> {
  const rows = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS n
      FROM "PointsAccount" pa
      JOIN "StudentProfile" sp ON sp."userId" = pa."userId"
     WHERE pa.balance <> sp."synergyPoints"
  `;
  return Number(rows[0]?.n ?? 0);
}

async function countLedgerVsAccount(): Promise<number> {
  const rows = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS n FROM (
      SELECT pa."userId"
        FROM "PointsAccount" pa
        LEFT JOIN "PointsTransaction" pt ON pt."userId" = pa."userId"
       GROUP BY pa."userId", pa.balance
      HAVING pa.balance <> COALESCE(SUM(pt.amount), 0)
    ) q
  `;
  return Number(rows[0]?.n ?? 0);
}

async function countMissingAccount(): Promise<number> {
  const rows = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS n
      FROM "User" u
     WHERE u."synergyPoints" <> 0
       AND NOT EXISTS (
         SELECT 1 FROM "PointsAccount" pa WHERE pa."userId" = u.id)
  `;
  return Number(rows[0]?.n ?? 0);
}

async function listMismatches(): Promise<MismatchRow[]> {
  return prisma.$queryRaw<MismatchRow[]>`
    SELECT pa."userId" AS "userId",
           pa.balance AS "paBalance",
           u."synergyPoints" AS "userSynergy",
           sp."synergyPoints" AS "profileSynergy"
      FROM "PointsAccount" pa
      JOIN "User" u ON u.id = pa."userId"
      LEFT JOIN "StudentProfile" sp ON sp."userId" = pa."userId"
     WHERE pa.balance <> u."synergyPoints"
        OR (sp."userId" IS NOT NULL AND sp."synergyPoints" <> pa.balance)
     ORDER BY pa."userId"
  `;
}

async function main() {
  assertChildBranch();
  const apply = process.argv.includes("--apply");

  const before = {
    pointsAccountVsUserSynergy: await countPointsVsUser(),
    pointsAccountVsStudentProfile: await countPointsVsProfile(),
    pointsLedgerVsAccount: await countLedgerVsAccount(),
    nonzeroWalletsMissingPointsAccount: await countMissingAccount(),
  };
  const mismatches = await listMismatches();

  console.log(
    JSON.stringify(
      {
        apply,
        before,
        mismatchCount: mismatches.length,
        sample: mismatches.slice(0, 20).map((m) => ({
          userId: m.userId,
          pointsAccount: m.paBalance,
          userSynergyPoints: m.userSynergy,
          studentProfileSynergyPoints: m.profileSynergy,
        })),
      },
      null,
      2,
    ),
  );

  if (before.pointsLedgerVsAccount !== 0) {
    console.warn(
      "pointsLedgerVsAccount is not 0. This script will not rewrite PointsTransaction.",
    );
  }
  if (before.nonzeroWalletsMissingPointsAccount !== 0) {
    console.warn(
      "nonzero User.synergyPoints with no PointsAccount left untouched (no account to copy).",
    );
  }

  if (!apply) {
    console.log("Dry run. Pass --apply to set User/StudentProfile synergyPoints = PointsAccount.balance.");
    return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const userResult = await tx.$executeRaw`
      UPDATE "User" u
         SET "synergyPoints" = pa.balance
        FROM "PointsAccount" pa
       WHERE pa."userId" = u.id
         AND u."synergyPoints" <> pa.balance
    `;
    const profileResult = await tx.$executeRaw`
      UPDATE "StudentProfile" sp
         SET "synergyPoints" = pa.balance
        FROM "PointsAccount" pa
       WHERE pa."userId" = sp."userId"
         AND sp."synergyPoints" <> pa.balance
    `;
    return {
      usersUpdated: Number(userResult),
      profilesUpdated: Number(profileResult),
    };
  });

  const after = {
    pointsAccountVsUserSynergy: await countPointsVsUser(),
    pointsAccountVsStudentProfile: await countPointsVsProfile(),
    pointsLedgerVsAccount: await countLedgerVsAccount(),
    nonzeroWalletsMissingPointsAccount: await countMissingAccount(),
  };

  console.log(JSON.stringify({ updated, after }, null, 2));

  if (after.pointsAccountVsUserSynergy !== 0) {
    throw new Error(
      `Post-repair pointsAccountVsUserSynergy is ${after.pointsAccountVsUserSynergy}, expected 0`,
    );
  }
  if (after.pointsAccountVsStudentProfile !== 0) {
    throw new Error(
      `Post-repair pointsAccountVsStudentProfile is ${after.pointsAccountVsStudentProfile}, expected 0`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
