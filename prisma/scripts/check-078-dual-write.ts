/**
 * Phase 4 dual-write probe against the current DATABASE_URL (child only).
 * Sets ENABLE_DUAL_WRITE in-process; does not change .env.
 * PHASE2_SAMPLE=1 limits to the representative slice; otherwise uses any rows.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

process.env.ENABLE_DUAL_WRITE = "true";

import { Prisma, PrismaClient } from "@prisma/client";
import { PointsSourceType } from "@prisma/client";
import {
  SAMPLE_DAY_CAP,
  assertChildBranch,
  isSampleMode,
  resolveSampleUserIds,
} from "./migrate-078-shared";
import {
  dualWriteChallengeEnrollment,
  dualWriteMissionAttempt,
  dualWritePoints,
  dualWriteSubmissionAttempt,
} from "../../src/repositories/dual-write";

const prisma = new PrismaClient();
const PROBE_KEY = isSampleMode()
  ? "dual-write-probe:phase4-sample"
  : "dual-write-probe:phase4-rehearsal";

async function main() {
  assertChildBranch();
  const sample = await resolveSampleUserIds(prisma);
  const userIds = sample;
  const userWhere = userIds ? { userId: { in: userIds } } : {};
  const memberUserWhere = userIds ? { member: { userId: { in: userIds } } } : {};
  const dayFilter = isSampleMode() ? { lte: SAMPLE_DAY_CAP } : undefined;

  const enrollment = await prisma.enrollment.findFirst({
    where: userWhere,
    select: {
      id: true,
      userId: true,
      domain: true,
      status: true,
      startedAt: true,
      completedAt: true,
    },
  });
  if (!enrollment) throw new Error("No Enrollment available for dual-write probe");

  const submission = await prisma.submission.findFirst({
    where: { ...userWhere, ...(dayFilter ? { dayNumber: dayFilter } : {}) },
    select: {
      id: true,
      enrollmentId: true,
      dailyTaskId: true,
      githubUrl: true,
      linkedinUrl: true,
      status: true,
      submittedAt: true,
    },
  });
  const mission = await prisma.programMissionSubmission.findFirst({
    where: {
      ...memberUserWhere,
      ...(dayFilter ? { dayNumber: dayFilter } : {}),
    },
    select: {
      id: true,
      memberId: true,
      dayNumber: true,
      attemptNumber: true,
      payload: true,
      verdict: true,
      passed: true,
      pointsAwarded: true,
      createdAt: true,
    },
  });
  const day =
    mission &&
    (await prisma.programDay.findUnique({
      where: { dayNumber: mission.dayNumber },
      select: { id: true },
    }));
  const spendUser = await prisma.user.findFirst({
    where: userIds ? { id: { in: userIds } } : { id: enrollment.userId },
    select: { id: true, synergyPoints: true },
  });
  if (!spendUser) throw new Error("No User available for dual-write probe");

  const txOpts = { maxWait: 10_000, timeout: 20_000 } as const;

  await prisma.$transaction(async (tx) => {
    await dualWriteChallengeEnrollment(tx, enrollment);
  }, txOpts);

  if (submission) {
    await prisma.$transaction(async (tx) => {
      await dualWriteSubmissionAttempt(tx, {
        id: submission.id,
        enrollmentId: submission.enrollmentId,
        dailyTaskId: submission.dailyTaskId,
        githubUrl: submission.githubUrl,
        linkedinUrl: submission.linkedinUrl,
        status: submission.status,
        submittedAt: submission.submittedAt,
        pointsAwarded: 0,
      });
    }, txOpts);
  }

  if (mission && day) {
    await prisma.$transaction(async (tx) => {
      await dualWriteMissionAttempt(tx, {
        id: mission.id,
        memberId: mission.memberId,
        programDayId: day.id,
        attemptNumber: mission.attemptNumber,
        payload: (mission.payload ?? {}) as Prisma.InputJsonValue,
        verdict: (mission.verdict ?? []) as Prisma.InputJsonValue,
        passed: mission.passed,
        pointsAwarded: mission.pointsAwarded,
        createdAt: mission.createdAt,
      });
    }, txOpts);
  }

  await prisma.$transaction(async (tx) => {
    await dualWritePoints(tx, {
      userId: spendUser.id,
      amount: -1,
      sourceType: PointsSourceType.REDEMPTION,
      sourceId: "probe",
      idempotencyKey: PROBE_KEY,
      reason: "phase4 dual-write probe spend",
    });
    await dualWritePoints(tx, {
      userId: spendUser.id,
      amount: 1,
      sourceType: PointsSourceType.REDEMPTION_REFUND,
      sourceId: "probe",
      idempotencyKey: `${PROBE_KEY}:refund`,
      reason: "phase4 dual-write probe refund",
    });
  }, txOpts);

  const pe = await prisma.programEnrollment.findUnique({
    where: { id: `pe_enr_${enrollment.id}` },
    select: { id: true, status: true },
  });
  if (!pe) throw new Error("dual-write enrollment missing ProgramEnrollment");

  const attempt = submission
    ? await prisma.activityAttempt.findUnique({
        where: { id: `aa_sub_${submission.id}` },
        select: { id: true },
      })
    : null;
  if (submission && !attempt) throw new Error("dual-write submission missing ActivityAttempt");

  const ms = mission
    ? await prisma.activityAttempt.findUnique({
        where: { id: `aa_ms_${mission.id}` },
        select: { id: true },
      })
    : null;
  if (mission && day && !ms) throw new Error("dual-write mission missing ActivityAttempt");

  const spend = await prisma.pointsTransaction.findUnique({
    where: { idempotencyKey: PROBE_KEY },
    select: { id: true, amount: true },
  });
  const refund = await prisma.pointsTransaction.findUnique({
    where: { idempotencyKey: `${PROBE_KEY}:refund` },
    select: { id: true, amount: true },
  });
  if (!spend || spend.amount !== -1) throw new Error("dual-write spend missing");
  if (!refund || refund.amount !== 1) throw new Error("dual-write refund missing");

  await prisma.pointsTransaction.deleteMany({
    where: { idempotencyKey: { in: [PROBE_KEY, `${PROBE_KEY}:refund`] } },
  });

  console.log(
    JSON.stringify({
      ok: true,
      enrollment: pe.id,
      submission: attempt?.id ?? null,
      mission: ms?.id ?? null,
      pointsProbeCleaned: true,
    }),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
