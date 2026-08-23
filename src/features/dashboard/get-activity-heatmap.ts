import { subMonths } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import {
  IST,
  addCalendarDaysToKey,
  parseCalendarKeyToUtcDate,
} from "@/lib/date-utils";
import { prisma } from "@/lib/db";

export type ActivityCell = {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
};

export type ActivityHeatmap = {
  cells: ActivityCell[];
  maxCount: number;
  totalActiveDays: number;
  weekTicks: boolean[];
};

export const HEATMAP_MONTHS = 4;

function getMondayOfWeekContaining(key: string): string {
  const isoDay = parseInt(
    formatInTimeZone(parseCalendarKeyToUtcDate(key), IST, "i"),
    10,
  );
  const daysFromMonday = isoDay - 1;
  return addCalendarDaysToKey(key, -daysFromMonday);
}

/** First day of the IST month that is (HEATMAP_MONTHS - 1) months before today. */
function getFourMonthAnchorKey(todayKey: string): string {
  const todayUtc = parseCalendarKeyToUtcDate(todayKey);
  const anchorMonth = subMonths(todayUtc, HEATMAP_MONTHS - 1);
  const [y, m] = formatInTimeZone(anchorMonth, IST, "yyyy-MM-dd").split("-");
  return `${y}-${m}-01`;
}

function countToLevel(count: number, maxCount: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (maxCount === 0) return 1;
  return Math.min(
    4,
    Math.max(1, Math.ceil((count / maxCount) * 4)),
  ) as 1 | 2 | 3 | 4;
}

export async function getActivityHeatmap(
  userId: string,
): Promise<ActivityHeatmap> {
  const submissions = await prisma.submission.findMany({
    where: { enrollment: { userId } },
    select: { submittedAt: true },
  });

  const countByDate = new Map<string, number>();
  for (const { submittedAt } of submissions) {
    const key = formatInTimeZone(submittedAt, IST, "yyyy-MM-dd");
    countByDate.set(key, (countByDate.get(key) ?? 0) + 1);
  }

  const totalActiveDays = countByDate.size;

  const todayKey = formatInTimeZone(new Date(), IST, "yyyy-MM-dd");
  const anchorKey = getFourMonthAnchorKey(todayKey);
  const gridStart = getMondayOfWeekContaining(anchorKey);

  const windowCounts: number[] = [];
  const cells: ActivityCell[] = [];

  let date = gridStart;
  while (date <= todayKey) {
    const count = countByDate.get(date) ?? 0;
    windowCounts.push(count);
    cells.push({ date, count, level: 0 });
    date = addCalendarDaysToKey(date, 1);
  }

  const maxCount = Math.max(0, ...windowCounts);

  for (let i = 0; i < cells.length; i++) {
    cells[i]!.level = countToLevel(cells[i]!.count, maxCount);
  }

  const currentWeekMonday = getMondayOfWeekContaining(todayKey);
  const weekTicks: boolean[] = [];
  for (let i = 0; i < 7; i++) {
    const weekDate = addCalendarDaysToKey(currentWeekMonday, i);
    weekTicks.push((countByDate.get(weekDate) ?? 0) > 0);
  }

  return { cells, maxCount, totalActiveDays, weekTicks };
}
