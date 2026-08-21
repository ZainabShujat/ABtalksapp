/**
 * Plan 078 Phase 4 drift monitor — compares legacy vs new counts for the four dual-write paths.
 * Target the Neon child branch. Read-only.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { PrismaClient } from "@prisma/client";
import { PRODUCTION_NEON_HOST_ID } from "./migrate-078-shared";

function assertNotProduction(url: string): void {
  if (url.includes(PRODUCTION_NEON_HOST_ID)) {
    throw new Error("Refusing to run against production Neon host.");
  }
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  assertNotProduction(url);
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw<
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
      }[]
    >`
      SELECT
        (SELECT COUNT(*) FROM "Submission") AS submissions,
        (SELECT COUNT(*) FROM "ActivityAttempt" WHERE payload->>'legacySubmissionId' IS NOT NULL) AS submission_attempts,
        (SELECT COUNT(*) FROM "ProgramMissionSubmission") AS missions,
        (SELECT COUNT(*) FROM "ActivityAttempt" WHERE payload->>'legacyMissionSubmissionId' IS NOT NULL) AS mission_attempts,
        (SELECT COUNT(*) FROM "Enrollment") AS enrollments,
        (SELECT COUNT(*) FROM "ProgramEnrollment" WHERE id LIKE 'pe_enr_%') AS challenge_pe,
        (SELECT COUNT(*) FROM "ProgramMember") AS members,
        (SELECT COUNT(*) FROM "ProgramEnrollment" WHERE id LIKE 'pe_pm_%') AS program_pe,
        (SELECT COUNT(*) FROM "SynergyEvent") AS synergy,
        (SELECT COUNT(*) FROM "PointsTransaction") AS points_tx
    `;
    const r = rows[0];
    if (!r) throw new Error("No drift row");
    const deltas = {
      submitDay: Number(r.submissions) - Number(r.submission_attempts),
      verifyMission: Number(r.missions) - Number(r.mission_attempts),
      enrollment:
        Number(r.enrollments) + Number(r.members) - (Number(r.challenge_pe) + Number(r.program_pe)),
      points: Number(r.synergy) - Number(r.points_tx),
    };
    console.log(JSON.stringify({ counts: r, deltas }, (_, v) =>
      typeof v === "bigint" ? Number(v) : v,
    ));
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
