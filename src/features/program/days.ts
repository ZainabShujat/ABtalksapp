import "server-only";
import type { ProgramLanguage, ProgramMissionType, Prisma } from "@prisma/client";
import {
  collectPassSkipSets,
  deriveDayState,
  getMaxContentDay,
  type DayState,
} from "@/features/program/progression";
import { isDayLockBypassEnabled } from "@/lib/feature-flags";
import { programMember } from "@/repositories/legacy/program-member";
import { getProgramDayShell } from "@/repositories/learning";
import {
  getProgramUnlockFloor,
  listProgramMissionProgress,
} from "@/repositories/progress";

export type { DayState } from "@/features/program/progression";

export type DayVideo = {
  id: string;
  order: number;
  title: string;
  youtubeId: string;
  durationMin: number | null;
};

// NOTE: missionSpec is deliberately excluded from every select in this file
// (roadmap §9.8 — it is server-only and must never reach the client).
export type DayShell = {
  id: string;
  dayNumber: number;
  title: string;
  missionType: ProgramMissionType;
  briefMd: string;
  assetsJson: Prisma.JsonValue | null;
  starterCode: string | null;
  language: ProgramLanguage | null;
  objectives: string[];
  tools: string[];
  estimatedMin: number;
  missionPoints: number;
  isProjectDay: boolean;
  module: { number: number; title: string; color: string };
  videos: DayVideo[];
};

export type DayShellResult = { day: DayShell; state: DayState };

export async function getDayShell(
  memberId: string,
  dayNumber: number,
): Promise<DayShellResult | null> {
  const day = await getProgramDayShell(dayNumber);
  if (!day) return null;

  const member = await programMember.findUnique({
    where: { id: memberId },
    select: {
      highestUnlockedDay: true,
      cohort: { select: { startsAt: true } },
    },
  });
  if (!member) return null;

  const [submissions, unlockFloor] = await Promise.all([
    listProgramMissionProgress(memberId),
    getProgramUnlockFloor(memberId, member.highestUnlockedDay),
  ]);

  const { passedDays, skippedDays } = collectPassSkipSets(submissions);
  const maxContentDay = getMaxContentDay(member.cohort, unlockFloor);

  const state = deriveDayState(
    dayNumber,
    maxContentDay,
    passedDays,
    skippedDays,
    isDayLockBypassEnabled(),
  );

  return { day, state };
}
