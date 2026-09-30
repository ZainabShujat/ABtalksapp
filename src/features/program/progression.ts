import "server-only";
import type { ProgramCohortStatus, ProgramMissionType } from "@prisma/client";
import { differenceInCalendarDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import {
  addCalendarDaysToKey,
  parseCalendarKeyToUtcDate,
} from "@/lib/date-utils";
import { isDayLockBypassEnabled } from "@/lib/feature-flags";
import { findAiCohortMembershipByMemberId } from "@/repositories/program-state";
import {
  listProgramModules,
  listProgramDayCatalog,
} from "@/repositories/learning";
import {
  getProgramUnlockFloor,
  listProgramMissionProgress,
} from "@/repositories/progress";
import {
  PROGRAM_MEMBER_START_DAY,
  PROGRAM_TOTAL_DAYS,
  PROGRAM_TZ,
} from "@/features/program/constants";

/**
 * The learner's own Day-1 anchor (`ProgramEnrollment.startedAt`).
 *
 * Every AI-cohort day boundary derives from this, not from a shared cohort
 * `startsAt` (plan 157). The track is rolling: people join on any day, so a
 * cohort-wide calendar either gives a late joiner no pacing at all (when the
 * cohort started long ago and the day clamp pins them at 31) or locks them out
 * of days they should already have (when it started recently).
 */
export type ProgramAnchor = { startedAt: Date };

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

export function isWaivedPayload(payload: unknown): boolean {
  return (
    !!payload &&
    typeof payload === "object" &&
    (payload as { waived?: unknown }).waived === true
  );
}

/**
 * Calendar unlock ceiling from the learner's pace + start-day offset.
 * Member calendar day 1 → content day PROGRAM_MEMBER_START_DAY.
 * Used for unlock only — not for behind-pace (see getBehindByDays).
 */
export function getCalendarDerivedMaxContentDay(
  memberCalendarDay: number,
): number {
  return Math.min(
    PROGRAM_TOTAL_DAYS,
    PROGRAM_MEMBER_START_DAY - 1 + memberCalendarDay,
  );
}

/** PROGRAM_TZ calendar key (`yyyy-MM-dd`) on which `dayNumber` becomes unlockable. */
export function getContentDayUnlockKey(
  anchor: ProgramAnchor,
  dayNumber: number,
): string {
  const startKey = formatInTimeZone(anchor.startedAt, PROGRAM_TZ, "yyyy-MM-dd");
  const offset = dayNumber - PROGRAM_MEMBER_START_DAY;
  return addCalendarDaysToKey(startKey, Math.max(0, offset));
}

/**
 * Old enroll bootstrap wrote highestUnlockedDay = 4. After START_DAY moved
 * to 1, that floor would still unlock Days 1–4 on calendar day 1. Drop it
 * unless an admin raised the floor past 4.
 */
function effectiveUnlockFloor(highestUnlockedDay: number): number {
  if (PROGRAM_MEMBER_START_DAY <= 1 && highestUnlockedDay <= 4) {
    return PROGRAM_MEMBER_START_DAY;
  }
  return highestUnlockedDay;
}

/** Effective unlock ceiling: calendar-derived, raised by admin `highestUnlockedDay`. */
export function getMaxContentDay(
  anchor: ProgramAnchor,
  highestUnlockedDay: number,
): number {
  const calendarDerived = getCalendarDerivedMaxContentDay(
    getMemberCalendarDay(anchor),
  );
  return Math.min(
    PROGRAM_TOTAL_DAYS,
    Math.max(calendarDerived, effectiveUnlockFloor(highestUnlockedDay)),
  );
}

/**
 * Day availability: calendar cap + sequential (prev must be PASSED).
 * `maxContentDay` is the unlock ceiling (the learner's calendar + admin floor).
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

/** PROGRAM_TZ calendar days since the learner's `startedAt`, clamped 1..PROGRAM_TOTAL_DAYS. */
export function getMemberCalendarDay(anchor: ProgramAnchor): number {
  const startKey = formatInTimeZone(anchor.startedAt, PROGRAM_TZ, "yyyy-MM-dd");
  const nowKey = formatInTimeZone(new Date(), PROGRAM_TZ, "yyyy-MM-dd");
  const startUtc = parseCalendarKeyToUtcDate(startKey);
  const nowUtc = parseCalendarKeyToUtcDate(nowKey);
  const diff = differenceInCalendarDays(nowUtc, startUtc);
  return Math.min(PROGRAM_TOTAL_DAYS, Math.max(1, diff + 1));
}

/**
 * A cohort freezes only when an admin archives or completes it.
 *
 * Never on a date. This track is rolling (plan 157): every member runs their own
 * 31-day calendar from `startedAt`, so a shared end date cuts late joiners off
 * mid-programme — which is exactly what happened to the open cohort after
 * 2026-09-02, and what `PROGRAM_HOLD_OPEN_COHORT_NAME` used to paper over for
 * one cohort by matching its literal name.
 */
export function isCohortFrozen(cohort: {
  status: ProgramCohortStatus;
}): boolean {
  return cohort.status === "ARCHIVED" || cohort.status === "COMPLETED";
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
 * How many days behind the learner's own calendar pace (Mission Control “Day”).
 * Does not use the Day-4 unlock ceiling — that only gates availability.
 */
export function getBehindByDays(
  anchor: ProgramAnchor,
  progressDay: number,
): number {
  const expected = getMemberCalendarDay(anchor);
  return Math.max(0, expected - progressDay);
}

export function collectPassSkipSets(
  submissions: { dayNumber: number; passed: boolean; payload: unknown }[],
): { passedDays: Set<number>; skippedDays: Set<number> } {
  const passedDays = new Set<number>();
  const skippedDays = new Set<number>();
  const hasEarnedPass = submissions.some(
    (row) => row.passed && !isWaivedPayload(row.payload),
  );
  const ignoreStartWaivers =
    PROGRAM_MEMBER_START_DAY <= 1 && !hasEarnedPass;
  for (const row of submissions) {
    if (row.passed) {
      if (ignoreStartWaivers && isWaivedPayload(row.payload)) continue;
      passedDays.add(row.dayNumber);
    } else if (isSkippedPayload(row.payload)) {
      skippedDays.add(row.dayNumber);
    }
  }
  return { passedDays, skippedDays };
}

export async function getMemberDayStates(
  memberId: string,
): Promise<{ modules: CurriculumModule[]; days: CurriculumDay[] }> {
  const member = await findAiCohortMembershipByMemberId(memberId);
  if (!member) {
    return { modules: [], days: [] };
  }

  const [modules, days, submissions, unlockFloor] = await Promise.all([
    listProgramModules(),
    listProgramDayCatalog(),
    listProgramMissionProgress(memberId),
    getProgramUnlockFloor(memberId, member.highestUnlockedDay),
  ]);

  const maxContentDay = getMaxContentDay(member, unlockFloor);

  const { passedDays, skippedDays } = collectPassSkipSets(submissions);

  const dayStates: CurriculumDay[] = days.map((d) => ({
    dayNumber: d.dayNumber,
    title: d.title,
    missionType: d.missionType,
    isProjectDay: d.isProjectDay,
    moduleNumber: d.moduleNumber,
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
  const member = await findAiCohortMembershipByMemberId(memberId);
  if (!member) return 1;
  const unlockFloor = await getProgramUnlockFloor(
    memberId,
    member.highestUnlockedDay,
  );
  const dayNumber = getMaxContentDay(member, unlockFloor);
  const days = await listProgramDayCatalog();
  const day = days.find((d) => d.dayNumber === dayNumber);
  return day?.moduleNumber ?? 1;
}
