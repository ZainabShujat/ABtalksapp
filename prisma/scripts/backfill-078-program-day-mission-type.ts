/**
 * Copy ProgramDay.missionType onto ContentActivityConfig for act_pd_* rows.
 * Does not touch ProgramMissionSubmission or other configs.
 */
import { config } from "dotenv";
import { PrismaClient, ProgramMissionType } from "@prisma/client";
import { assertChildBranch } from "./migrate-078-shared";

config({ path: ".env.local" });
config();

const prisma = new PrismaClient();

async function main() {
  assertChildBranch();
  const apply = process.argv.includes("--apply");

  const rows = await prisma.$queryRaw<
    {
      programDayId: string;
      dayNumber: number;
      legacyType: string;
      configId: string | null;
      storedType: string | null;
    }[]
  >`
    SELECT pd.id AS "programDayId",
           pd."dayNumber" AS "dayNumber",
           pd."missionType"::text AS "legacyType",
           c.id AS "configId",
           c."missionType"::text AS "storedType"
    FROM "ProgramDay" pd
    JOIN "Activity" a ON a.id = 'act_pd_' || pd.id
    LEFT JOIN "ContentActivityConfig" c ON c."activityId" = a.id
    ORDER BY pd."dayNumber"
  `;

  const missingActivity = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM "ProgramDay" pd
    LEFT JOIN "Activity" a ON a.id = 'act_pd_' || pd.id
    WHERE a.id IS NULL
  `;
  const missingN = missingActivity[0]?.n ?? -1;
  if (missingN !== 0) {
    throw new Error(`${missingN} ProgramDays have no act_pd_ Activity`);
  }

  const toUpdate = rows.filter((r) => r.storedType !== r.legacyType);
  console.log(
    JSON.stringify({
      programDays: rows.length,
      alreadyMatching: rows.length - toUpdate.length,
      toUpdate: toUpdate.map((r) => ({
        dayNumber: r.dayNumber,
        legacyType: r.legacyType,
        storedType: r.storedType,
        hasConfig: r.configId != null,
      })),
    }),
  );

  if (!apply) {
    console.log("Dry run. Pass --apply to write ContentActivityConfig.missionType.");
    return;
  }

  await prisma.$executeRaw`
    UPDATE "ContentActivityConfig" AS c
    SET "missionType" = pd."missionType"
    FROM "ProgramDay" pd
    JOIN "Activity" a ON a.id = 'act_pd_' || pd.id
    WHERE c."activityId" = a.id
      AND c."missionType" IS DISTINCT FROM pd."missionType"
  `;

  const stillMissing = toUpdate.filter((r) => r.configId == null);
  for (const row of stillMissing) {
    await prisma.contentActivityConfig.create({
      data: {
        activityId: `act_pd_${row.programDayId}`,
        missionType: row.legacyType as ProgramMissionType,
      },
    });
  }

  const remaining = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM "ProgramDay" pd
    JOIN "Activity" a ON a.id = 'act_pd_' || pd.id
    LEFT JOIN "ContentActivityConfig" c ON c."activityId" = a.id
    WHERE c."missionType" IS DISTINCT FROM pd."missionType"
  `;
  const remainingN = remaining[0]?.n ?? -1;
  if (remainingN !== 0) {
    throw new Error(`Post-backfill missionType drift is ${remainingN}, expected 0`);
  }
  console.log(JSON.stringify({ updated: toUpdate.length, remainingDrift: remainingN }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
