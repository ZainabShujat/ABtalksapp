import "server-only";
import { prisma } from "@/lib/db";
import { formatInTimeZone } from "date-fns-tz";
import {
  getBehindByDays,
  getCohortCalendarDay,
  getContentDayUnlockKey,
  getMaxContentDay,
  getMemberDayStates,
  getMemberProgressDay,
  isWaivedPayload,
  type CurriculumDay,
  type CurriculumModule,
  type MissionHeatmapCell,
} from "@/features/program/progression";
import { getMemberRank } from "@/features/program/leaderboard";
import type { VerdictLine } from "@/features/program/verify-mission";
import { parseCalendarKeyToUtcDate } from "@/lib/date-utils";
import { programMember } from "@/repositories/legacy/program-member";
import { getProgramDayShell } from "@/repositories/learning";
import {
  getProgramUnlockFloor,
  listProgramMissionProgress,
  listProgramRecentMissionAttempts,
} from "@/repositories/progress";

export type MemberDashboard = {
  totalScore: number;
  rank: number | null;
  memberDay: number;
  cohortDay: number;
  behindBy: number;
  cleanPassCount: number;
  scoreBreakdown: {
    missionPoints: number;
    conceptPoints: number;
    commitPoints: number;
    projectPoints: number;
  };
  currentDay: {
    dayNumber: number;
    title: string;
    missionType: string;
    moduleColor: string;
  } | null;
  moduleProgress: {
    number: number;
    title: string;
    color: string;
    passed: number;
    total: number;
  }[];
  recentVerdicts: {
    dayNumber: number;
    passed: boolean;
    checks: VerdictLine[];
    createdAt: string;
  }[];
  missionHeatmap: MissionHeatmapCell[];
  /** All 8 modules, ordered by number. */
  modules: CurriculumModule[];
  /** All 31 days with their per-member state, ordered by dayNumber. */
  days: CurriculumDay[];
  /** True when at least one non-waived day has been passed. */
  hasStarted: boolean;
  /** Lowest LOCKED day number, or null when nothing is locked. */
  nextLockedDay: number | null;
  /** Passed days counting leftover start waivers that still count as PASSED. */
  clearedCount: number;
  /** Passed days the member actually completed. */
  earnedCount: number;
  /** Start-waiver days that still count toward clearedCount. */
  waivedCount: number;
  /** `d MMM` unlock date when nextLockedDay is calendar-gated; otherwise null. */
  nextUnlockDateLabel: string | null;
};

function parseVerdict(json: unknown): VerdictLine[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (v): v is VerdictLine =>
      !!v &&
      typeof v === "object" &&
      typeof (v as VerdictLine).check === "string" &&
      typeof (v as VerdictLine).passed === "boolean",
  );
}

export async function getMemberDashboard(
  memberId: string,
  cohortId: string,
): Promise<MemberDashboard | null> {
  const [member, cohort, { modules, days }, rank, recentRuns, passedRows] =
    await Promise.all([
      programMember.findUnique({
        where: { id: memberId },
        select: {
          totalScore: true,
          missionPoints: true,
          conceptPoints: true,
          commitPoints: true,
          projectPoints: true,
          cleanPassCount: true,
          highestUnlockedDay: true,
        },
      }),
      prisma.programCohort.findUnique({
        where: { id: cohortId },
        select: { startsAt: true },
      }),
      getMemberDayStates(memberId),
      getMemberRank(cohortId, memberId),
      listProgramRecentMissionAttempts(memberId, 5),
      listProgramMissionProgress(memberId).then((rows) =>
        rows.filter((r) => r.passed),
      ),
    ]);

  if (!member || !cohort) return null;

  const cohortDay = getCohortCalendarDay(cohort);
  const passedDays = new Set(
    days.filter((d) => d.state === "PASSED").map((d) => d.dayNumber),
  );
  const progressDay = getMemberProgressDay(passedDays);
  const memberDay = progressDay;
  const behindBy = getBehindByDays(cohort, progressDay);

  const missionHeatmap: MissionHeatmapCell[] = days.map((d) => ({
    dayNumber: d.dayNumber,
    completed: d.state === "PASSED",
  }));

  const hasStarted = passedRows.some((r) => !isWaivedPayload(r.payload));
  const nextLockedDay =
    days.find((d) => d.state === "LOCKED")?.dayNumber ?? null;
  const clearedCount = passedDays.size;
  const waivedDaySet = new Set(
    passedRows
      .filter((r) => isWaivedPayload(r.payload))
      .map((r) => r.dayNumber),
  );
  const waivedCount = [...waivedDaySet].filter((d) => passedDays.has(d)).length;
  const earnedCount = clearedCount - waivedCount;
  const unlockFloor = await getProgramUnlockFloor(
    memberId,
    member.highestUnlockedDay,
  );
  const maxContentDay = getMaxContentDay(cohort, unlockFloor);
  const nextUnlockDateLabel =
    nextLockedDay !== null && nextLockedDay > maxContentDay
      ? formatInTimeZone(
          parseCalendarKeyToUtcDate(
            getContentDayUnlockKey(cohort, nextLockedDay),
          ),
          "UTC",
          "d MMM",
        )
      : null;

  const availableDay = days.find((d) => d.state === "AVAILABLE");
  let currentDay: MemberDashboard["currentDay"] = null;
  if (availableDay) {
    const dayRow = await getProgramDayShell(availableDay.dayNumber);
    if (dayRow) {
      currentDay = {
        dayNumber: dayRow.dayNumber,
        title: dayRow.title,
        missionType: dayRow.missionType,
        moduleColor: dayRow.module.color,
      };
    }
  }

  const moduleProgress = modules.map((mod) => {
    const modDays = days.filter((d) => d.moduleNumber === mod.number);
    const passed = modDays.filter((d) => passedDays.has(d.dayNumber)).length;
    return {
      number: mod.number,
      title: mod.title,
      color: mod.color,
      passed,
      total: modDays.length,
    };
  });

  const recentVerdicts = recentRuns
    .filter(
      (r) =>
        !(
          r.payload &&
          typeof r.payload === "object" &&
          (r.payload as { skipped?: unknown }).skipped === true
        ),
    )
    .map((r) => ({
      dayNumber: r.dayNumber,
      passed: r.passed,
      checks: parseVerdict(r.verdict),
      createdAt: r.createdAt.toISOString(),
    }));

  return {
    totalScore: member.totalScore,
    rank,
    memberDay,
    cohortDay,
    behindBy,
    cleanPassCount: member.cleanPassCount,
    scoreBreakdown: {
      missionPoints: member.missionPoints,
      conceptPoints: member.conceptPoints,
      commitPoints: member.commitPoints,
      projectPoints: member.projectPoints,
    },
    currentDay,
    moduleProgress,
    recentVerdicts,
    missionHeatmap,
    modules,
    days,
    hasStarted,
    nextLockedDay,
    clearedCount,
    earnedCount,
    waivedCount,
    nextUnlockDateLabel,
  };
}
