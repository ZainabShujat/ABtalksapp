import type { Prisma } from "@prisma/client";
import {
  dualWriteCommitDay,
  dualWriteDeleteMissionAttempt,
  dualWriteMissionAttempt,
} from "@/repositories/dual-write";
import { formatInTimeZone } from "date-fns-tz";
import {
  addCalendarDaysToKey,
  parseCalendarKeyToUtcDate,
} from "@/lib/date-utils";
import {
  COMMIT_POINTS_PER_DAY,
  PROGRAM_MAX_COMMIT_POINTS,
  PROGRAM_MEMBER_START_DAY,
  PROGRAM_TZ,
} from "./constants";

const WAIVED_DAYS = Array.from(
  { length: Math.max(0, PROGRAM_MEMBER_START_DAY - 1) },
  (_, i) => i + 1,
);

const EARLY_COMMIT_DAY_COUNT = PROGRAM_MEMBER_START_DAY - 1;

async function recomputeTotalScore(
  tx: Prisma.TransactionClient,
  memberId: string,
): Promise<void> {
  const member = await tx.programMember.findUnique({
    where: { id: memberId },
    select: {
      missionPoints: true,
      conceptPoints: true,
      commitPoints: true,
      projectPoints: true,
    },
  });
  if (!member) return;
  await tx.programMember.update({
    where: { id: memberId },
    data: {
      totalScore:
        member.missionPoints +
        member.conceptPoints +
        member.commitPoints +
        member.projectPoints,
    },
  });
}

async function seedEarlyCommitDays(
  tx: Prisma.TransactionClient,
  memberId: string,
  cohort: { startsAt: Date; endsAt: Date },
): Promise<void> {
  const startKey = formatInTimeZone(cohort.startsAt, PROGRAM_TZ, "yyyy-MM-dd");
  const endKey = formatInTimeZone(cohort.endsAt, PROGRAM_TZ, "yyyy-MM-dd");
  const startDate = parseCalendarKeyToUtcDate(startKey);
  const endDate = parseCalendarKeyToUtcDate(endKey);

  const dateKeys: string[] = [];
  for (let i = 0; i < EARLY_COMMIT_DAY_COUNT; i++) {
    const dateKey = addCalendarDaysToKey(startKey, i);
    if (dateKey >= startKey && dateKey <= endKey) {
      dateKeys.push(dateKey);
    }
  }

  const commitDates = dateKeys.map((k) => parseCalendarKeyToUtcDate(k));
  const existingRows = await tx.programCommitDay.findMany({
    where: {
      memberId,
      date: { in: commitDates },
    },
    select: { date: true, commitCount: true },
  });
  const existingByIso = new Map(
    existingRows.map((r) => [r.date.toISOString(), r.commitCount]),
  );

  await Promise.all(
    dateKeys.map((dateKey) => {
      const commitDate = parseCalendarKeyToUtcDate(dateKey);
      const existing = existingByIso.get(commitDate.toISOString()) ?? 0;
      const nextCount = Math.max(existing, 1);
      return tx.programCommitDay
        .upsert({
          where: { memberId_date: { memberId, date: commitDate } },
          create: {
            memberId,
            date: commitDate,
            commitCount: nextCount,
          },
          update: { commitCount: nextCount },
        })
        .then((row) =>
          dualWriteCommitDay(tx, {
            id: row.id,
            memberId,
            date: row.date,
            commitCount: row.commitCount,
          }),
        );
    }),
  );

  const qualifyingDays = await tx.programCommitDay.count({
    where: {
      memberId,
      commitCount: { gt: 0 },
      date: { gte: startDate, lte: endDate },
    },
  });

  const commitPoints = Math.min(
    PROGRAM_MAX_COMMIT_POINTS,
    qualifyingDays * COMMIT_POINTS_PER_DAY,
  );

  await tx.programMember.update({
    where: { id: memberId },
    data: { commitPoints },
  });
}

function isStartDayWaiver(payload: unknown): boolean {
  return (
    !!payload &&
    typeof payload === "object" &&
    (payload as { waived?: unknown }).waived === true &&
    (payload as { reason?: unknown }).reason === "cohort_start_day"
  );
}

/**
 * Idempotent: waive days 1..(START-1) as PASSED, unlock START day,
 * award mission points only for newly created waived rows,
 * retract unused start-day waivers when START_DAY is 1,
 * and seed commit activity for waived calendar days (none when START_DAY is 1).
 *
 * Uses batched queries (no per-day round-trips) so Neon pooler
 * interactive transactions do not hit P2028 timeouts.
 */
export async function bootstrapMemberStartDay(
  tx: Prisma.TransactionClient,
  memberId: string,
): Promise<void> {
  const member = await tx.programMember.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      highestUnlockedDay: true,
      missionPoints: true,
      cleanPassCount: true,
      cohort: { select: { startsAt: true, endsAt: true } },
    },
  });
  if (!member) return;

  const existingPassed =
    WAIVED_DAYS.length === 0
      ? []
      : await tx.programMissionSubmission.findMany({
          where: {
            memberId,
            dayNumber: { in: WAIVED_DAYS },
            passed: true,
          },
          select: { dayNumber: true },
        });
  const passedSet = new Set(existingPassed.map((s) => s.dayNumber));
  const missingDays = WAIVED_DAYS.filter((d) => !passedSet.has(d));

  let pointsAdded = 0;
  let cleanPassesAdded = 0;
  let pointsRemoved = 0;
  let cleanPassesRemoved = 0;

  if (missingDays.length > 0) {
    const [days, existingAttempts] = await Promise.all([
      tx.programDay.findMany({
        where: { dayNumber: { in: missingDays } },
        select: { id: true, dayNumber: true, missionPoints: true },
      }),
      tx.programMissionSubmission.findMany({
        where: { memberId, dayNumber: { in: missingDays } },
        select: { dayNumber: true, attemptNumber: true },
      }),
    ]);

    const pointsByDay = new Map(
      days.map((d) => [d.dayNumber, d.missionPoints]),
    );
    const maxAttemptByDay = new Map<number, number>();
    for (const row of existingAttempts) {
      const prev = maxAttemptByDay.get(row.dayNumber) ?? 0;
      if (row.attemptNumber > prev) {
        maxAttemptByDay.set(row.dayNumber, row.attemptNumber);
      }
    }

    const rows = missingDays.map((dayNumber) => {
      const missionPoints = pointsByDay.get(dayNumber) ?? 0;
      const priorAttempts = maxAttemptByDay.get(dayNumber) ?? 0;
      pointsAdded += missionPoints;
      if (priorAttempts === 0) cleanPassesAdded += 1;
      return {
        memberId,
        dayNumber,
        attemptNumber: priorAttempts + 1,
        passed: true,
        pointsAwarded: missionPoints,
        payload: {
          waived: true,
          reason: "cohort_start_day",
        },
        verdict: [
          {
            check: "waived",
            passed: true,
            detail: "Marked complete at enrollment",
          },
        ],
      };
    });

    await tx.programMissionSubmission.createMany({ data: rows });
    const created = await tx.programMissionSubmission.findMany({
      where: { memberId, dayNumber: { in: missingDays } },
      select: {
        id: true,
        dayNumber: true,
        attemptNumber: true,
        payload: true,
        verdict: true,
        passed: true,
        pointsAwarded: true,
        createdAt: true,
      },
    });
    const dayIdByNumber = new Map(days.map((d) => [d.dayNumber, d.id]));
    for (const row of created) {
      const programDayId = dayIdByNumber.get(row.dayNumber);
      if (!programDayId) continue;
      await dualWriteMissionAttempt(tx, {
        id: row.id,
        memberId,
        programDayId,
        attemptNumber: row.attemptNumber,
        payload: row.payload as Prisma.InputJsonValue,
        verdict: row.verdict as Prisma.InputJsonValue,
        passed: row.passed,
        pointsAwarded: row.pointsAwarded,
        createdAt: row.createdAt,
      });
    }
  }

  const passedRows = await tx.programMissionSubmission.findMany({
    where: { memberId, passed: true },
    select: {
      id: true,
      dayNumber: true,
      payload: true,
      pointsAwarded: true,
    },
  });
  const hasEarnedPass = passedRows.some((row) => !isStartDayWaiver(row.payload));
  const staleWaivers = passedRows.filter((row) => {
    if (!isStartDayWaiver(row.payload)) return false;
    if (hasEarnedPass) return false;
    return !WAIVED_DAYS.includes(row.dayNumber);
  });

  if (staleWaivers.length > 0) {
    pointsRemoved = staleWaivers.reduce((sum, row) => sum + row.pointsAwarded, 0);
    cleanPassesRemoved = staleWaivers.length;
    for (const row of staleWaivers) {
      await dualWriteDeleteMissionAttempt(tx, row.id);
    }
    await tx.programMissionSubmission.deleteMany({
      where: { id: { in: staleWaivers.map((row) => row.id) } },
    });
  }

  const nextUnlocked =
    hasEarnedPass || member.highestUnlockedDay > 4
      ? Math.max(member.highestUnlockedDay, PROGRAM_MEMBER_START_DAY)
      : PROGRAM_MEMBER_START_DAY;

  const needsUnlockUpdate = nextUnlocked !== member.highestUnlockedDay;
  const nextMissionPoints = Math.max(
    0,
    member.missionPoints + pointsAdded - pointsRemoved,
  );
  const nextCleanPassCount = Math.max(
    0,
    member.cleanPassCount + cleanPassesAdded - cleanPassesRemoved,
  );
  const needsScoreUpdate =
    nextMissionPoints !== member.missionPoints ||
    nextCleanPassCount !== member.cleanPassCount;

  if (needsUnlockUpdate || needsScoreUpdate) {
    await tx.programMember.update({
      where: { id: memberId },
      data: {
        highestUnlockedDay: nextUnlocked,
        ...(needsScoreUpdate
          ? {
              missionPoints: nextMissionPoints,
              cleanPassCount: nextCleanPassCount,
            }
          : {}),
      },
    });
  }

  if (EARLY_COMMIT_DAY_COUNT > 0) {
    await seedEarlyCommitDays(tx, memberId, member.cohort);
  }

  await recomputeTotalScore(tx, memberId);
}
