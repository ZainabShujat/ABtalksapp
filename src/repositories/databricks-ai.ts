import "server-only";
import {
  AttemptLateness,
  AttemptStatus,
  CohortStatus,
  DayActivitySource,
  EnrollmentStatusV2,
  EvaluatorType,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  DATABRICKS_AI_COHORT_SLUG,
  DATABRICKS_AI_MAX_MISSION_POINTS,
  DATABRICKS_AI_TOTAL_DAYS,
} from "@/features/databricks-ai/constants";
import {
  deriveDayState,
  maxUnlockedDay,
  todayKey,
} from "@/features/databricks-ai/progression";
import { addCalendarDaysToKey } from "@/lib/date-utils";
import { isDayLockBypassEnabled } from "@/lib/feature-flags";

const DBAI_DAY_ACTIVITY_PREFIX = "act_dbai_day_";

export type DatabricksAiEnrollment = {
  id: string;
  userId: string;
  cohortId: string;
  status: EnrollmentStatusV2;
  startedAt: Date;
  githubRepoUrl: string | null;
  completedAt: Date | null;
};

export type DatabricksAiAttemptRow = {
  id: string;
  activityId: string;
  dayNumber: number;
  attemptNumber: number;
  passed: boolean;
  lateness: AttemptLateness;
  pointsAwarded: number;
  createdAt: Date;
  submittedAt: Date | null;
  verdict: unknown;
};

export async function getDatabricksAiCohort(): Promise<{
  id: string;
  status: CohortStatus;
  timezone: string;
} | null> {
  const row = await prisma.cohort.findUnique({
    where: { slug: DATABRICKS_AI_COHORT_SLUG },
    select: { id: true, status: true, timezone: true },
  });
  return row;
}

export async function findDatabricksAiEnrollment(
  userId: string,
): Promise<DatabricksAiEnrollment | null> {
  const cohort = await getDatabricksAiCohort();
  if (!cohort) return null;
  const row = await prisma.programEnrollment.findUnique({
    where: { userId_cohortId: { userId, cohortId: cohort.id } },
    select: {
      id: true,
      userId: true,
      cohortId: true,
      status: true,
      startedAt: true,
      githubRepoUrl: true,
      completedAt: true,
    },
  });
  return row;
}

export async function createDatabricksAiEnrollmentRow(
  tx: Prisma.TransactionClient,
  input: { userId: string; cohortId: string; githubRepoUrl: string },
): Promise<{ id: string; startedAt: Date }> {
  const row = await tx.programEnrollment.upsert({
    where: {
      userId_cohortId: { userId: input.userId, cohortId: input.cohortId },
    },
    create: {
      userId: input.userId,
      cohortId: input.cohortId,
      status: EnrollmentStatusV2.ACTIVE,
      startedAt: new Date(),
      enrolledAt: new Date(),
      githubRepoUrl: input.githubRepoUrl,
    },
    update: {
      status: EnrollmentStatusV2.ACTIVE,
      githubRepoUrl: input.githubRepoUrl,
    },
    select: { id: true, startedAt: true },
  });
  return row;
}

export async function listDatabricksAiProgress(
  enrollmentId: string,
): Promise<{ dayNumber: number; passed: boolean; lateness: AttemptLateness }[]> {
  const rows = await prisma.activityAttempt.findMany({
    where: {
      enrollmentId,
      passed: true,
      activity: { id: { startsWith: DBAI_DAY_ACTIVITY_PREFIX } },
    },
    orderBy: { submittedAt: "asc" },
    select: {
      lateness: true,
      passed: true,
      activity: { select: { dayNumber: true } },
    },
  });
  const byDay = new Map<
    number,
    { dayNumber: number; passed: boolean; lateness: AttemptLateness }
  >();
  for (const row of rows) {
    const dayNumber = row.activity.dayNumber;
    if (dayNumber == null) continue;
    if (byDay.has(dayNumber)) continue;
    byDay.set(dayNumber, {
      dayNumber,
      passed: row.passed,
      lateness: row.lateness,
    });
  }
  return [...byDay.values()].sort((a, b) => a.dayNumber - b.dayNumber);
}

export async function listDatabricksAiAttemptsForDay(
  enrollmentId: string,
  dayNumber: number,
): Promise<DatabricksAiAttemptRow[]> {
  const rows = await prisma.activityAttempt.findMany({
    where: {
      enrollmentId,
      activity: {
        dayNumber,
        id: { startsWith: DBAI_DAY_ACTIVITY_PREFIX },
      },
    },
    orderBy: { attemptNumber: "asc" },
    select: {
      id: true,
      activityId: true,
      attemptNumber: true,
      passed: true,
      lateness: true,
      pointsAwarded: true,
      createdAt: true,
      submittedAt: true,
      activity: { select: { dayNumber: true } },
      evaluations: {
        where: { isAuthoritative: true },
        take: 1,
        select: { detailJson: true },
      },
    },
  });
  return rows.flatMap((row) => {
    const dn = row.activity.dayNumber;
    if (dn == null) return [];
    return [
      {
        id: row.id,
        activityId: row.activityId,
        dayNumber: dn,
        attemptNumber: row.attemptNumber,
        passed: row.passed,
        lateness: row.lateness,
        pointsAwarded: row.pointsAwarded,
        createdAt: row.createdAt,
        submittedAt: row.submittedAt,
        verdict: row.evaluations[0]?.detailJson ?? null,
      },
    ];
  });
}

export async function countDatabricksAiAttemptsForDay(
  enrollmentId: string,
  dayNumber: number,
): Promise<number> {
  return prisma.activityAttempt.count({
    where: {
      enrollmentId,
      activity: {
        dayNumber,
        id: { startsWith: DBAI_DAY_ACTIVITY_PREFIX },
      },
    },
  });
}

export async function listRecentDatabricksAiAttempts(
  enrollmentId: string,
  take: number,
): Promise<DatabricksAiAttemptRow[]> {
  const rows = await prisma.activityAttempt.findMany({
    where: {
      enrollmentId,
      // Only cleared days belong in VIEW STATS. A day the learner never
      // passed shows no row at all.
      passed: true,
      activity: { id: { startsWith: DBAI_DAY_ACTIVITY_PREFIX } },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      activityId: true,
      attemptNumber: true,
      passed: true,
      lateness: true,
      pointsAwarded: true,
      createdAt: true,
      submittedAt: true,
      activity: { select: { dayNumber: true } },
      evaluations: {
        where: { isAuthoritative: true },
        take: 1,
        select: { detailJson: true },
      },
    },
  });
  // One row per day: newest first, so the first sighting of a day is the
  // one to keep. A learner who passes, then re-runs and passes again, has
  // two passing attempts on one day — without this they appear twice.
  const seen = new Set<number>();
  const out: DatabricksAiAttemptRow[] = [];
  for (const row of rows) {
    const dn = row.activity.dayNumber;
    if (dn == null || seen.has(dn)) continue;
    seen.add(dn);
    out.push({
      id: row.id,
      activityId: row.activityId,
      dayNumber: dn,
      attemptNumber: row.attemptNumber,
      passed: row.passed,
      lateness: row.lateness,
      pointsAwarded: row.pointsAwarded,
      createdAt: row.createdAt,
      submittedAt: row.submittedAt,
      verdict: row.evaluations[0]?.detailJson ?? null,
    });
    if (out.length === take) break;
  }
  return out;
}

export async function hasPassedDatabricksAiActivity(
  enrollmentId: string,
  activityId: string,
): Promise<boolean> {
  const row = await prisma.activityAttempt.findFirst({
    where: { enrollmentId, activityId, passed: true },
    select: { id: true },
  });
  return row !== null;
}

export async function getLatestDatabricksAiAttemptAt(
  enrollmentId: string,
  dayNumber: number,
): Promise<Date | null> {
  const row = await prisma.activityAttempt.findFirst({
    where: {
      enrollmentId,
      activity: {
        dayNumber,
        id: { startsWith: DBAI_DAY_ACTIVITY_PREFIX },
      },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

export async function recordDatabricksAiAttempt(
  tx: Prisma.TransactionClient,
  input: {
    enrollmentId: string;
    activityId: string;
    attemptNumber: number;
    lateness: AttemptLateness;
    payload: Prisma.InputJsonValue;
    passed: boolean;
    pointsAwarded: number;
    verdict: Prisma.InputJsonValue;
    firstPass: boolean;
    activityDate: Date;
  },
): Promise<{ id: string; createdAt: Date }> {
  const attempt = await tx.activityAttempt.create({
    data: {
      enrollmentId: input.enrollmentId,
      activityId: input.activityId,
      attemptNumber: input.attemptNumber,
      status: AttemptStatus.EVALUATED,
      lateness: input.lateness,
      payload: input.payload,
      passed: input.passed,
      pointsAwarded: input.pointsAwarded,
      submittedAt: new Date(),
    },
    select: { id: true, createdAt: true },
  });
  await tx.activityEvaluation.create({
    data: {
      attemptId: attempt.id,
      evaluatorType: EvaluatorType.AUTO,
      passed: input.passed,
      detailJson: input.verdict,
      isAuthoritative: true,
    },
  });
  if (input.firstPass) {
    await tx.enrollmentDayActivity.upsert({
      where: {
        enrollmentId_activityDate_source: {
          enrollmentId: input.enrollmentId,
          activityDate: input.activityDate,
          source: DayActivitySource.SUBMISSION,
        },
      },
      create: {
        enrollmentId: input.enrollmentId,
        activityDate: input.activityDate,
        source: DayActivitySource.SUBMISSION,
        activityCount: 1,
        pointsEarned: input.pointsAwarded,
      },
      update: {
        activityCount: { increment: 1 },
        pointsEarned: { increment: input.pointsAwarded },
      },
    });
  }
  return attempt;
}

export async function markDatabricksAiEnrollmentCompleted(
  tx: Prisma.TransactionClient,
  enrollmentId: string,
): Promise<void> {
  await tx.programEnrollment.update({
    where: { id: enrollmentId },
    data: {
      status: EnrollmentStatusV2.COMPLETED,
      completedAt: new Date(),
    },
  });
}

export async function getDatabricksAiEnrollmentProgress(
  enrollmentId: string,
): Promise<{
  completedActivities: number;
  pointsEarned: number;
  currentStreak: number;
} | null> {
  const row = await prisma.enrollmentProgress.findUnique({
    where: { enrollmentId },
    select: {
      completedActivities: true,
      pointsEarned: true,
      currentStreak: true,
    },
  });
  return row;
}

function consecutiveStreaks(
  dateKeys: string[],
  today: string,
  yesterdayKey: string,
): { current: number; longest: number } {
  const unique = [...new Set(dateKeys)].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const key of unique) {
    if (prev === null) {
      run = 1;
    } else {
      const expected = addOneDay(prev);
      run = key === expected ? run + 1 : 1;
    }
    longest = Math.max(longest, run);
    prev = key;
  }

  const set = new Set(unique);
  let current = 0;
  if (set.has(today) || set.has(yesterdayKey)) {
    let cursor = set.has(today) ? today : yesterdayKey;
    while (set.has(cursor)) {
      current += 1;
      cursor = addNegOneDay(cursor);
    }
  }
  return { current, longest };
}

function addOneDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

function addNegOneDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.toISOString().slice(0, 10);
}

export async function recomputeDatabricksAiProgress(
  tx: Prisma.TransactionClient,
  enrollmentId: string,
): Promise<void> {
  const enrollment = await tx.programEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { cohortId: true, startedAt: true },
  });
  if (!enrollment) return;

  const passedAttempts = await tx.activityAttempt.findMany({
    where: {
      enrollmentId,
      passed: true,
      activity: { id: { startsWith: DBAI_DAY_ACTIVITY_PREFIX } },
    },
    select: {
      pointsAwarded: true,
      activity: { select: { id: true, dayNumber: true } },
    },
    orderBy: { submittedAt: "asc" },
  });
  const passedByDay = new Map<number, { activityId: string; points: number }>();
  let pointsEarned = 0;
  for (const row of passedAttempts) {
    const dayNumber = row.activity.dayNumber;
    if (dayNumber == null) continue;
    if (passedByDay.has(dayNumber)) continue;
    passedByDay.set(dayNumber, {
      activityId: row.activity.id,
      points: row.pointsAwarded,
    });
    pointsEarned += row.pointsAwarded;
  }
  const passedDays = new Set(passedByDay.keys());
  const completedActivities = passedDays.size;
  const unlockedThroughPosition =
    completedActivities === 0 ? 0 : Math.max(...passedDays);

  const activities = await tx.activity.findMany({
    where: { id: { startsWith: DBAI_DAY_ACTIVITY_PREFIX } },
    orderBy: { dayNumber: "asc" },
    select: { id: true, dayNumber: true },
  });
  const maxUnlocked = maxUnlockedDay(enrollment.startedAt);
  const bypass = isDayLockBypassEnabled();
  let currentActivityId: string | null = null;
  let nextActivityId: string | null = null;
  for (const activity of activities) {
    if (activity.dayNumber == null) continue;
    const state = deriveDayState(
      activity.dayNumber,
      maxUnlocked,
      passedDays,
      bypass,
    );
    if (state === "AVAILABLE" && currentActivityId === null) {
      currentActivityId = activity.id;
    }
    if (state === "LOCKED" && nextActivityId === null) {
      nextActivityId = activity.id;
    }
  }

  const dayRows = await tx.enrollmentDayActivity.findMany({
    where: { enrollmentId, source: DayActivitySource.SUBMISSION },
    select: { activityDate: true },
    orderBy: { activityDate: "asc" },
  });
  const istToday = todayKey();
  const dateKeys = dayRows.map((r) => r.activityDate.toISOString().slice(0, 10));
  const { current, longest } = consecutiveStreaks(
    dateKeys,
    istToday,
    addCalendarDaysToKey(istToday, -1),
  );
  const percentCompleteBp = Math.round(
    (completedActivities / DATABRICKS_AI_TOTAL_DAYS) * 10000,
  );
  const now = new Date();
  await tx.enrollmentProgress.upsert({
    where: { enrollmentId },
    create: {
      enrollmentId,
      cohortId: enrollment.cohortId,
      completedActivities,
      totalActivities: DATABRICKS_AI_TOTAL_DAYS,
      percentCompleteBp,
      pointsEarned,
      pointsPossible: DATABRICKS_AI_MAX_MISSION_POINTS,
      currentStreak: current,
      longestStreak: longest,
      lastActivityAt: now,
      currentActivityId,
      nextActivityId,
      unlockedThroughPosition,
      recomputedAt: now,
    },
    update: {
      completedActivities,
      totalActivities: DATABRICKS_AI_TOTAL_DAYS,
      percentCompleteBp,
      pointsEarned,
      pointsPossible: DATABRICKS_AI_MAX_MISSION_POINTS,
      currentStreak: current,
      longestStreak: longest,
      lastActivityAt: now,
      currentActivityId,
      nextActivityId,
      unlockedThroughPosition,
      recomputedAt: now,
    },
  });
}
