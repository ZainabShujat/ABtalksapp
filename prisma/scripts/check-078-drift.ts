/**
 * Plan 078 Phase 4 drift monitor. With PHASE2_SAMPLE=1, compares only the
 * backfilled user slice. Unscoped counts on this child are not defects.
 *
 * Points count-drift excludes `idempotencyKey LIKE 'reconciliation:phase2:%'`.
 * Those rows are Phase 2f plugs so SUM(PointsTransaction) = User.synergyPoints
 * when the legacy event ledger already disagreed with the wallet. They have no
 * SynergyEvent by design. Do not delete them; V3 / ledger-vs-account still
 * include them.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { PrismaClient } from "@prisma/client";
import {
  PRODUCTION_NEON_HOST_ID,
  SAMPLE_DAY_CAP,
  isPhase2ProductionRun,
  isSampleMode,
  resolveSampleUserIds,
  sqlIn,
} from "./migrate-078-shared";

function assertNotProduction(url: string): void {
  if (url.includes(PRODUCTION_NEON_HOST_ID) && !isPhase2ProductionRun()) {
    throw new Error("Refusing to run against production Neon host.");
  }
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  assertNotProduction(url);
  const prisma = new PrismaClient();
  try {
    const sample = isSampleMode() ? await resolveSampleUserIds(prisma) : null;
    if (sample) console.log(`Drift scoped to ${sample.length} sample users`);
    const u = sqlIn('e."userId"', sample);
    const su = sqlIn('s."userId"', sample);
    const mu = sqlIn('m."userId"', sample);
    const syu = sqlIn('se."userId"', sample);
    const peu = sqlIn('pe."userId"', sample);
    const ptu = sqlIn('pt."userId"', sample);
    const dayCap = sample ? `AND s."dayNumber" <= ${SAMPLE_DAY_CAP}` : "";
    const missionCap = sample ? `AND pms."dayNumber" <= ${SAMPLE_DAY_CAP}` : "";
    const rows = await prisma.$queryRawUnsafe<
      {
        submissions: bigint;
        submission_attempts: bigint;
        missions: bigint;
        mission_attempts: bigint;
        enrollments: bigint;
        challenge_pe: bigint;
        members: bigint;
        program_pe: bigint;
        synergy: bigint;
        points_tx: bigint;
        points_tx_phase2_recon: bigint;
      }[]
    >(`
      SELECT
        (SELECT COUNT(*) FROM "Submission" s WHERE ${su} ${dayCap}) AS submissions,
        (SELECT COUNT(*) FROM "ActivityAttempt" a
          JOIN "Submission" s ON s.id = a.payload->>'legacySubmissionId'
         WHERE ${su} ${dayCap}) AS submission_attempts,
        (SELECT COUNT(*) FROM "ProgramMissionSubmission" pms
          JOIN "ProgramMember" m ON m.id = pms."memberId"
         WHERE ${mu} ${missionCap}) AS missions,
        (SELECT COUNT(*) FROM "ActivityAttempt" a
          JOIN "ProgramMissionSubmission" pms ON pms.id = a.payload->>'legacyMissionSubmissionId'
          JOIN "ProgramMember" m ON m.id = pms."memberId"
         WHERE ${mu} ${missionCap}) AS mission_attempts,
        (SELECT COUNT(*) FROM "Enrollment" e WHERE ${u}) AS enrollments,
        (SELECT COUNT(*) FROM "ProgramEnrollment" pe
         WHERE pe.id LIKE 'pe_enr_%' AND ${peu}) AS challenge_pe,
        (SELECT COUNT(*) FROM "ProgramMember" m WHERE ${mu}) AS members,
        (SELECT COUNT(*) FROM "ProgramEnrollment" pe
         WHERE pe.id LIKE 'pe_pm_%' AND ${peu}) AS program_pe,
        (SELECT COUNT(*) FROM "SynergyEvent" se WHERE ${syu}) AS synergy,
        (SELECT COUNT(*) FROM "PointsTransaction" pt
          WHERE ${ptu}
            AND pt."idempotencyKey" NOT LIKE 'reconciliation:phase2:%') AS points_tx,
        (SELECT COUNT(*) FROM "PointsTransaction" pt
          WHERE ${ptu}
            AND pt."idempotencyKey" LIKE 'reconciliation:phase2:%') AS points_tx_phase2_recon
    `);
    const r = rows[0];
    if (!r) throw new Error("No drift row");
    const deltas = {
      submitDay: Number(r.submissions) - Number(r.submission_attempts),
      verifyMission: Number(r.missions) - Number(r.mission_attempts),
      enrollment:
        Number(r.enrollments) + Number(r.members) - (Number(r.challenge_pe) + Number(r.program_pe)),
      points: Number(r.synergy) - Number(r.points_tx),
    };
    console.log(
      JSON.stringify(
        { scoped: Boolean(sample), counts: r, deltas },
        (_, v) => (typeof v === "bigint" ? Number(v) : v),
      ),
    );
    const hasDrift = Object.values(deltas).some((d) => d !== 0);
    if (hasDrift) {
      console.error("[078 dual-write] drift detected");
      process.exitCode = 1;
    } else {
      console.log("[078 dual-write] drift check clean");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
