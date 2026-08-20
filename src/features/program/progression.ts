import "server-only";
import type { ProgramCohortStatus, ProgramMissionType } from "@prisma/client";
import { differenceInCalendarDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/db";
import { parseCalendarKeyToUtcDate } from "@/lib/date-utils";
import { isDayLockBypassEnabled } from "@/lib/feature-flags";
import {
  PROGRAM_HOLD_OPEN_COHORT_NAME,
  PROGRAM_MEMBER_START_DAY,
  PROGRAM_TOTAL_DAYS,
  PROGRAM_TZ,
} from "@/features/program/constants";

export type DayState = "LOCKED" | "AVAILABLE" | "PASSED" | "SKIPPED";

export type CurriculumModule = {
  number: number;
  title: string;
  subtitle: string;
  color: string;
  startDay: number;
  endDay: number;
};

export type CurriculumDay = {
  dayNumber: number;
  title: string;
  missionType: ProgramMissionType;
  isProjectDay: boolean;
  moduleNumber: number;
  state: DayState;
};

export function isSkippedPayload(payload: unknown): boolean {
  return (
    !!payload &&
    typeof payload === "object" &&
    (payload as { skipped?: unknown }).skipped === true
  );
}

/**
 * Calendar unlock ceiling from cohort pace + start-day offset.
 * Cohort calendar day 1 → content day PROGRAM_MEMBER_START_DAY.
 * Used for unlock only — not for behind-pace (see getBehindByDays).
 */
export function getCalendarDerivedMaxContentDay(
  cohortCalendarDay: number,
): number {
  return Math.min(
    PROGRAM_TOTAL_DAYS,
    PROGRAM_MEMBER_START_DAY - 1 + cohortCalendarDay,
  );
}

/** Effective unlock ceiling: calendar-derived, raised by admin `highestUnlockedDay`. */
export function getMaxContentDay(
  cohort: { startsAt: Date },
  highestUnlockedDay: number,
): number {
  const calendarDerived = getCalendarDerivedMaxContentDay(
    getCohortCalendarDay(cohort),
  );
  return Math.min(
    PROGRAM_TOTAL_DAYS,
    Math.max(calendarDerived, highestUnlockedDay),
  );
}

/**
 * Day availability: calendar cap + sequential (prev must be PASSED).
 * `maxContentDay` is the unlock ceiling (calendar + admin floor).
 */
export function deriveDayState(
  dayNumber: number,
  maxContentDay: number,
  passedDays: Set<number>,
  skippedDays: Set<number>,
  bypassLocks = false,
): DayState {
  if (passedDays.has(dayNumber)) return "PASSED";
  if (skippedDays.has(dayNumber)) return "SKIPPED";
  if (bypassLocks) return "AVAILABLE";
  if (dayNumber > maxContentDay) return "LOCKED";
  if (dayNumber > 1) {
    const prev = dayNumber - 1;
    if (!passedDays.has(prev)) return "LOCKED";
  }
  return "AVAILABLE";
}

/** PROGRAM_TZ calendar days since cohort `startsAt`, clamped 1..PROGRAM_TOTAL_DAYS. */
export function getCohortCalendarDay(cohort: { startsAt: Date }): number {
  const startKey = formatInTimeZone(cohort.startsAt, PROGRAM_TZ, "yyyy-MM-dd");
  const nowKey = formatInTimeZone(new Date(), PROGRAM_TZ, "yyyy-MM-dd");
  const startUtc = parseCalendarKeyToUtcDate(startKey);
  const nowUtc = parseCalendarKeyToUtcDate(nowKey);
  const diff = differenceInCalendarDays(nowUtc, startUtc);
  return Math.min(PROGRAM_TOTAL_DAYS, Math.max(1, diff + 1));
}

export function isCohortPastEndsAt(cohort: { endsAt: Date }): boolean {
  return new Date() > cohort.endsAt;
}

/** Frozen when endsAt has passed, except the live US cohort which waits for all Day 31 passes. */
export async function isCohortFrozen(cohort: {
  id: string;
  name: string;
  status: ProgramCohortStatus;
  endsAt: Date;
}): Promise<boolean> {
  if (
    cohort.name === PROGRAM_HOLD_OPEN_COHORT_NAME &&
    (cohort.status === "ENROLLING" || cohort.status === "ACTIVE")
  ) {
    const incomplete = await prisma.programMember.count({
      where: {
        cohortId: cohort.id,
        status: { in: ["ENROLLED", "COMPLETED"] },
        missionSubmissions: {
          none: { dayNumber: PROGRAM_TOTAL_DAYS, passed: true },
        },
      },
    });
    return incomplete === 0;
  }
  return isCohortPastEndsAt(cohort);
}

/** Highest day number the member has PASSED (0 if none). */
export function getMemberProgressDay(passedDays: Set<number>): number {
  let max = 0;
  for (const d of passedDays) max = Math.max(max, d);
  return max;
}

export type MissionHeatmapCell = { dayNumber: number; completed: boolean };

export async function getMissionHeatmap(
  memberId: string,
): Promise<MissionHeatmapCell[]> {
  const { days } = await getMemberDayStates(memberId);
  return days.map((d) => ({
    dayNumber: d.dayNumber,
    completed: d.state === "PASSED",
  }));
}

/**
 * How many days behind cohort calendar pace (Mission Control “Cohort day”).
 * Does not use the Day-4 unlock ceiling — that only gates availability.
 */
export function getBehindByDays(
  cohort: { startsAt: Date },
  progressDay: number,
): number {
  const expected = getCohortCalendarDay(cohort);
  return Math.max(0, expected - progressDay);
}

export function collectPassSkipSets(
  submissions: { dayNumber: number; passed: boolean; payload: unknown }[],
): { passedDays: Set<number>; skippedDays: Set<number> } {
  const passedDays = new Set<number>();
  const skippedDays = new Set<number>();
  for (const row of submissions) {
    if (row.passed) passedDays.add(row.dayNumber);
    else if (isSkippedPayload(row.payload)) skippedDays.add(row.dayNumber);
  }
  return { passedDays, skippedDays };
}

export async function getMemberDayStates(
  memberId: string,
): Promise<{ modules: CurriculumModule[]; days: CurriculumDay[] }> {
  const member = await prisma.programMember.findUnique({
    where: { id: memberId },
    select: {
      highestUnlockedDay: true,
      cohort: { select: { startsAt: true } },
    },
  });
  if (!member) {
    return { modules: [], days: [] };
  }

  const maxContentDay = getMaxContentDay(
    member.cohort,
    member.highestUnlockedDay,
  );

  const [modules, days, submissions] = await Promise.all([
    prisma.programModule.findMany({
      orderBy: { number: "asc" },
      select: {
        number: true,
        title: true,
        subtitle: true,
        color: true,
        startDay: true,
        endDay: true,
      },
    }),
    prisma.programDay.findMany({
      orderBy: { dayNumber: "asc" },
      select: {
        dayNumber: true,
        title: true,
        missionType: true,
        isProjectDay: true,
        module: { select: { number: true } },
      },
    }),
    prisma.programMissionSubmission.findMany({
      where: { memberId },
      select: { dayNumber: true, passed: true, payload: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const { passedDays, skippedDays } = collectPassSkipSets(submissions);

  const dayStates: CurriculumDay[] = days.map((d) => ({
    dayNumber: d.dayNumber,
    title: d.title,
    missionType: d.missionType,
    isProjectDay: d.isProjectDay,
    moduleNumber: d.module.number,
    state: deriveDayState(
      d.dayNumber,
      maxContentDay,
      passedDays,
      skippedDays,
      isDayLockBypassEnabled(),
    ),
  }));

  return { modules, days: dayStates };
}

/** Current module from the member's effective max content day. */
export async function getMemberCurrentModuleNumber(
  memberId: string,
): Promise<number> {
  const member = await prisma.programMember.findUnique({
    where: { id: memberId },
    select: {
      highestUnlockedDay: true,
      cohort: { select: { startsAt: true } },
    },
  });
  if (!member) return 1;
  const dayNumber = getMaxContentDay(
    member.cohort,
    member.highestUnlockedDay,
  );
  const day = await prisma.programDay.findUnique({
    where: { dayNumber },
    select: { module: { select: { number: true } } },
  });
  return day?.module.number ?? 1;
}
