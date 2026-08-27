import { SubmissionStatus, type Prisma } from "@prisma/client";

export function computeTrackStreakFromOnTimeDays(
  onTimeDays: Set<number>,
  endDay: number,
): { currentStreak: number; longestStreak: number } {
  const cappedEnd = Math.max(1, Math.min(endDay, 60));

  let streakAnchor = cappedEnd;
  if (!onTimeDays.has(streakAnchor) && streakAnchor > 1) {
    streakAnchor -= 1;
  }

  let currentStreak = 0;
  for (let day = streakAnchor; day >= 1; day--) {
    if (onTimeDays.has(day)) {
      currentStreak += 1;
      continue;
    }
    break;
  }

  let longestStreak = 0;
  let running = 0;
  for (let day = 1; day <= cappedEnd; day++) {
    if (onTimeDays.has(day)) {
      running += 1;
      if (running > longestStreak) longestStreak = running;
      continue;
    }
    running = 0;
  }

  return { currentStreak, longestStreak };
}

export async function computeStreakStats(
  tx: Prisma.TransactionClient,
  input: {
    enrollmentId: string;
    endDay: number;
  },
): Promise<{ currentStreak: number; longestStreak: number }> {
  const submissions = await tx.submission.findMany({
    where: {
      enrollmentId: input.enrollmentId,
      dayNumber: { gte: 1, lte: Math.max(1, Math.min(input.endDay, 60)) },
      status: SubmissionStatus.ON_TIME,
    },
    select: { dayNumber: true },
  });
  return computeTrackStreakFromOnTimeDays(
    new Set<number>(submissions.map((s) => s.dayNumber)),
    input.endDay,
  );
}
