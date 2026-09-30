import type { Prisma } from "@prisma/client";
import { applyDeleteProgramMissionAttempt, applyProgramMissionAttemptChange } from "@/repositories/progress-writes";
import {
  applyProgramScoreChange,
  applyProgramUnlockChange,
} from "@/repositories/program-state";
import {
  missionSubmissionIdFromAttemptId,
  peIdForMember,
} from "@/repositories/ids";
import { formatInTimeZone } from "date-fns-tz";
import {
  addCalendarDaysToKey,
  parseCalendarKeyToUtcDate,
} from "@/lib/date-utils";
import {
  COMMIT_POINTS_PER_DAY,
  PROGRAM_MAX_COMMIT_POINTS,
  PROGRAM_MEMBER_START_DAY,
  PROGRAM_TOTAL_DAYS,
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
  await applyProgramScoreChange(tx, { memberId });
}

async function seedEarlyCommitDays(
  tx: Prisma.TransactionClient,
  memberId: string,
  anchor: { startedAt: Date },
): Promise<void> {
  // The learner's own 31-day window, not a shared cohort window (plan 157).
  const startKey = formatInTimeZone(anchor.startedAt, PROGRAM_TZ, "yyyy-MM-dd");
  const endKey = addCalendarDaysToKey(startKey, PROGRAM_TOTAL_DAYS - 1);
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
      return tx.programCommitDay.upsert({
        where: { memberId_date: { memberId, date: commitDate } },
        create: {
          memberId,
          programEnrollmentId: peIdForMember(memberId),
          date: commitDate,
          commitCount: nextCount,
        },
        update: { commitCount: nextCount },
      });
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

  await applyProgramScoreChange(tx, { memberId, commitPoints });
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
  const pe = await tx.programEnrollment.findUnique({
    where: { id: peIdForMember(memberId) },
    select: {
      startedAt: true,
      unlockFloorDay: true,
      missionPoints: true,
      cleanPassCount: true,
    },
  });
  if (!pe) return;
  const member = {
    id: memberId,
    highestUnlockedDay: pe.unlockFloorDay ?? 1,
    missionPoints: pe.missionPoints,
    cleanPassCount: pe.cleanPassCount,
    startedAt: pe.startedAt,
  };

  const existingPassed =
    WAIVED_DAYS.length === 0
      ? []
      : await tx.activityAttempt.findMany({
          where: {
            enrollmentId: peIdForMember(memberId),
            id: { startsWith: "aa_ms_" },
            passed: true,
            activity: { dayNumber: { in: WAIVED_DAYS } },
          },
          select: { activity: { select: { dayNumber: true } } },
        });
  const passedSet = new Set(
    existingPassed
      .map((s) => s.activity.dayNumber)
      .filter((n): n is number => n != null),
  );
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
      tx.activityAttempt.findMany({
        where: {
          enrollmentId: peIdForMember(memberId),
          id: { startsWith: "aa_ms_" },
          activity: { dayNumber: { in: missingDays } },
        },
        select: {
          attemptNumber: true,
          activity: { select: { dayNumber: true } },
        },
      }),
    ]);

    const pointsByDay = new Map(
      days.map((d) => [d.dayNumber, d.missionPoints]),
    );
    const maxAttemptByDay = new Map<number, number>();
    for (const row of existingAttempts) {
      const dayNumber = row.activity.dayNumber;
      if (dayNumber == null) continue;
      const prev = maxAttemptByDay.get(dayNumber) ?? 0;
      if (row.attemptNumber > prev) {
        maxAttemptByDay.set(dayNumber, row.attemptNumber);
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

    const dayIdByNumber = new Map(days.map((d) => [d.dayNumber, d.id]));
    for (const row of rows) {
      const programDayId = dayIdByNumber.get(row.dayNumber);
      if (!programDayId) continue;
      await applyProgramMissionAttemptChange(tx, {
        memberId: row.memberId,
        programDayId,
        dayNumber: row.dayNumber,
        attemptNumber: row.attemptNumber,
        payload: row.payload,
        verdict: row.verdict,
        passed: row.passed,
        pointsAwarded: row.pointsAwarded,
        createdAt: new Date(),
      });
    }
  }

  const passedRows = await tx.activityAttempt.findMany({
    where: {
      enrollmentId: peIdForMember(memberId),
      id: { startsWith: "aa_ms_" },
      passed: true,
    },
    select: {
      id: true,
      payload: true,
      pointsAwarded: true,
      activity: { select: { dayNumber: true } },
    },
  });
  const hasEarnedPass = passedRows.some((row) => !isStartDayWaiver(row.payload));
  const staleWaivers = passedRows.filter((row) => {
    if (!isStartDayWaiver(row.payload)) return false;
    if (hasEarnedPass) return false;
    const dayNumber = row.activity.dayNumber;
    if (dayNumber == null) return false;
    return !WAIVED_DAYS.includes(dayNumber);
  });

  if (staleWaivers.length > 0) {
    pointsRemoved = staleWaivers.reduce((sum, row) => sum + row.pointsAwarded, 0);
    cleanPassesRemoved = staleWaivers.length;
    for (const row of staleWaivers) {
      const legacyId = missionSubmissionIdFromAttemptId(row.id);
      if (!legacyId) continue;
      await applyDeleteProgramMissionAttempt(tx, legacyId);
    }
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

  if (needsUnlockUpdate) {
    await applyProgramUnlockChange(tx, {
      memberId,
      highestUnlockedDay: nextUnlocked,
    });
  }
  if (needsScoreUpdate) {
    await applyProgramScoreChange(tx, {
      memberId,
      missionPoints: nextMissionPoints,
      cleanPassCount: nextCleanPassCount,
    });
  }

  if (EARLY_COMMIT_DAY_COUNT > 0) {
    await seedEarlyCommitDays(tx, memberId, member);
  }

  await recomputeTotalScore(tx, memberId);
}
