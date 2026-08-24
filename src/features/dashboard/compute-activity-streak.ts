import { formatInTimeZone } from "date-fns-tz";
import {
  IST,
  addCalendarDaysToKey,
  parseCalendarKeyToUtcDate,
} from "@/lib/date-utils";

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100] as const;

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type WeekDayStatus = "complete" | "future" | "today" | "broken" | "idle";

export type StreakCardState = "empty" | "broken" | "active";

export type WeekDayTick = {
  date: string;
  label: (typeof WEEKDAY_LABELS)[number];
  status: WeekDayStatus;
  isToday: boolean;
};

export type ActivityStreak = {
  currentStreak: number;
  longestStreak: number;
  totalActiveDays: number;
  nextMilestone: number;
  daysToMilestone: number;
  todayCompleted: boolean;
  state: StreakCardState;
  week: WeekDayTick[];
};

function getMondayOfWeekContaining(key: string): string {
  const isoDay = parseInt(
    formatInTimeZone(parseCalendarKeyToUtcDate(key), IST, "i"),
    10,
  );
  return addCalendarDaysToKey(key, -(isoDay - 1));
}

function nextMilestone(current: number): number {
  for (const m of STREAK_MILESTONES) {
    if (m > current) return m;
  }
  return STREAK_MILESTONES[STREAK_MILESTONES.length - 1]!;
}

function walkBack(active: Set<string>, fromKey: string): number {
  let count = 0;
  let cursor = fromKey;
  while (active.has(cursor)) {
    count += 1;
    cursor = addCalendarDaysToKey(cursor, -1);
  }
  return count;
}

function longestRun(sortedKeys: string[]): number {
  if (sortedKeys.length === 0) return 0;
  let longest = 1;
  let running = 1;
  for (let i = 1; i < sortedKeys.length; i++) {
    const prev = sortedKeys[i - 1]!;
    const cur = sortedKeys[i]!;
    if (cur === addCalendarDaysToKey(prev, 1)) {
      running += 1;
      if (running > longest) longest = running;
    } else {
      running = 1;
    }
  }
  return longest;
}

/**
 * Day after the most recent completed run that is not part of the current
 * (possibly grace-extended) streak. Null when there was never a prior run.
 */
function findBreakDate(
  active: Set<string>,
  todayKey: string,
  currentStreak: number,
): string | null {
  if (active.size === 0) return null;

  if (currentStreak > 0) {
    const todayActive = active.has(todayKey);
    const anchor = todayActive
      ? todayKey
      : addCalendarDaysToKey(todayKey, -1);
    const start = addCalendarDaysToKey(anchor, -(currentStreak - 1));
    const beforeStart = addCalendarDaysToKey(start, -1);
    for (const key of active) {
      if (key <= beforeStart) return beforeStart;
    }
    return null;
  }

  let lastActive: string | null = null;
  for (const key of active) {
    if (lastActive === null || key > lastActive) lastActive = key;
  }
  if (lastActive === null) return null;
  const breakDay = addCalendarDaysToKey(lastActive, 1);
  return breakDay <= todayKey ? breakDay : null;
}

export function computeActivityStreak(
  countByDate: Map<string, number>,
  todayKey: string,
): ActivityStreak {
  const active = new Set<string>();
  for (const [key, count] of countByDate) {
    if (count > 0 && key <= todayKey) active.add(key);
  }

  const totalActiveDays = active.size;
  const todayCompleted = active.has(todayKey);
  const yesterdayKey = addCalendarDaysToKey(todayKey, -1);

  let currentStreak = 0;
  if (todayCompleted) {
    currentStreak = walkBack(active, todayKey);
  } else if (active.has(yesterdayKey)) {
    currentStreak = walkBack(active, yesterdayKey);
  }

  const sorted = [...active].sort();
  const longestStreak = longestRun(sorted);

  const milestone = nextMilestone(currentStreak);
  const daysToMilestone = Math.max(0, milestone - currentStreak);

  const state: StreakCardState =
    totalActiveDays === 0
      ? "empty"
      : currentStreak === 0
        ? "broken"
        : "active";

  const breakDate = findBreakDate(active, todayKey, currentStreak);
  const weekMonday = getMondayOfWeekContaining(todayKey);
  const week: WeekDayTick[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addCalendarDaysToKey(weekMonday, i);
    const label = WEEKDAY_LABELS[i]!;
    let status: WeekDayStatus;
    if (date > todayKey) {
      status = "future";
    } else if (active.has(date)) {
      status = "complete";
    } else if (date === breakDate) {
      status = "broken";
    } else if (date === todayKey) {
      status = "today";
    } else {
      status = "idle";
    }
    week.push({ date, label, status, isToday: date === todayKey });
  }

  return {
    currentStreak,
    longestStreak,
    totalActiveDays,
    nextMilestone: milestone,
    daysToMilestone,
    todayCompleted,
    state,
    week,
  };
}
