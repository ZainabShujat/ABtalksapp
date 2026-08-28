import "server-only";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export type DriftDelta = {
  path: "submitDay" | "verifyMission" | "points" | "enrollment";
  legacy: number;
  next: number;
  delta: number;
};

export type DriftReport = {
  deltas: DriftDelta[];
  hasDrift: boolean;
};

type CountRow = { n: bigint | number };

function asCount(rows: CountRow[]): number {
  return Number(rows[0]?.n ?? 0);
}

export async function checkDualWriteDrift(): Promise<DriftReport> {
  const [
    submissions,
    submissionAttempts,
    missions,
    missionAttempts,
    enrollments,
    challengePe,
    members,
    programPe,
    synergyEvents,
    pointsTx,
  ] = await Promise.all([
    prisma.$queryRaw<CountRow[]>`SELECT COUNT(*)::bigint AS n FROM "Submission"`,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS n FROM "ActivityAttempt"
      WHERE payload->>'legacySubmissionId' IS NOT NULL`,
    prisma.$queryRaw<CountRow[]>`SELECT COUNT(*)::bigint AS n FROM "ProgramMissionSubmission"`,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS n FROM "ActivityAttempt"
      WHERE payload->>'legacyMissionSubmissionId' IS NOT NULL`,
    prisma.$queryRaw<CountRow[]>`SELECT COUNT(*)::bigint AS n FROM "Enrollment"`,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS n FROM "ProgramEnrollment" WHERE id LIKE 'pe_enr_%'`,
    prisma.$queryRaw<CountRow[]>`SELECT COUNT(*)::bigint AS n FROM "ProgramMember"`,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS n FROM "ProgramEnrollment" WHERE id LIKE 'pe_pm_%'`,
    prisma.$queryRaw<CountRow[]>`SELECT COUNT(*)::bigint AS n FROM "SynergyEvent"`,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS n FROM "PointsTransaction"
      WHERE "idempotencyKey" NOT LIKE 'reconciliation:phase2:%'`,
  ]);

  const deltas: DriftDelta[] = [
    {
      path: "submitDay",
      legacy: asCount(submissions),
      next: asCount(submissionAttempts),
      delta: asCount(submissions) - asCount(submissionAttempts),
    },
    {
      path: "verifyMission",
      legacy: asCount(missions),
      next: asCount(missionAttempts),
      delta: asCount(missions) - asCount(missionAttempts),
    },
    {
      path: "enrollment",
      legacy: asCount(enrollments) + asCount(members),
      next: asCount(challengePe) + asCount(programPe),
      delta:
        asCount(enrollments) +
        asCount(members) -
        (asCount(challengePe) + asCount(programPe)),
    },
    {
      path: "points",
      legacy: asCount(synergyEvents),
      next: asCount(pointsTx),
      delta: asCount(synergyEvents) - asCount(pointsTx),
    },
  ];

  const hasDrift = deltas.some((d) => d.delta !== 0);
  if (hasDrift) {
    logger.error("[078 dual-write] drift detected", { deltas });
  } else {
    logger.info("[078 dual-write] drift check clean", { deltas });
  }
  return { deltas, hasDrift };
}
