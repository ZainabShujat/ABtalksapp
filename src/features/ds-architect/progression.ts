import "server-only";
import { AttemptLateness } from "@prisma/client";
import { differenceInCalendarDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import {
  addCalendarDaysToKey,
  parseCalendarKeyToUtcDate,
} from "@/lib/date-utils";
import {
  DS_ARCHITECT_TOTAL_DAYS,
  DS_ARCHITECT_TZ,
} from "@/features/ds-architect/constants";

export type DsArchitectDayState = "LOCKED" | "AVAILABLE" | "PASSED";

/** IST calendar key of the learner's Day 1. */
export function anchorKey(startedAt: Date): string {
  return formatInTimeZone(startedAt, DS_ARCHITECT_TZ, "yyyy-MM-dd");
}

/** IST key on which `dayNumber` unlocks: anchor + (dayNumber - 1). */
export function unlockKeyForDay(startedAt: Date, dayNumber: number): string {
  return addCalendarDaysToKey(anchorKey(startedAt), dayNumber - 1);
}

/** Uncapped elapsed day (1-based). Day 11+ is real and means "past the plan". */
export function elapsedDay(startedAt: Date, now = new Date()): number {
  const startKey = anchorKey(startedAt);
  const nowKey = formatInTimeZone(now, DS_ARCHITECT_TZ, "yyyy-MM-dd");
  const startUtc = parseCalendarKeyToUtcDate(startKey);
  const nowUtc = parseCalendarKeyToUtcDate(nowKey);
  const diff = differenceInCalendarDays(nowUtc, startUtc);
  return Math.max(1, diff + 1);
}

/** Display/unlock ceiling: min(10, elapsedDay). */
export function maxUnlockedDay(startedAt: Date, now = new Date()): number {
  return Math.min(DS_ARCHITECT_TOTAL_DAYS, elapsedDay(startedAt, now));
}

/** Calendar cap + sequential gate. No skip tokens on this track. */
export function deriveDayState(
  dayNumber: number,
  maxUnlocked: number,
  passedDays: Set<number>,
  bypassLocks: boolean,
): DsArchitectDayState {
  if (passedDays.has(dayNumber)) return "PASSED";
  if (bypassLocks) return "AVAILABLE";
  if (dayNumber > maxUnlocked) return "LOCKED";
  if (dayNumber > 1 && !passedDays.has(dayNumber - 1)) return "LOCKED";
  return "AVAILABLE";
}

/** ON_TIME when the pass lands on or before that day's own unlock key. */
export function latenessForPass(
  startedAt: Date,
  dayNumber: number,
  at: Date,
): AttemptLateness {
  const unlockKey = unlockKeyForDay(startedAt, dayNumber);
  const passKey = formatInTimeZone(at, DS_ARCHITECT_TZ, "yyyy-MM-dd");
  return passKey <= unlockKey
    ? AttemptLateness.ON_TIME
    : AttemptLateness.LATE;
}

/** max(0, min(10, elapsedDay) - highestPassedDay). Marked, never blocking. */
export function behindByDays(
  startedAt: Date,
  highestPassedDay: number,
  now = new Date(),
): number {
  return Math.max(0, maxUnlockedDay(startedAt, now) - highestPassedDay);
}

export function todayKey(now = new Date()): string {
  return formatInTimeZone(now, DS_ARCHITECT_TZ, "yyyy-MM-dd");
}

export function formatUnlockLabel(key: string): string {
  const utc = parseCalendarKeyToUtcDate(key);
  return formatInTimeZone(utc, "UTC", "d MMM");
}
