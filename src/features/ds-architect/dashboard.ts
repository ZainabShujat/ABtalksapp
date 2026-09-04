import "server-only";
import {
  AttemptLateness,
  EnrollmentStatusV2,
  type ProgramMissionType,
} from "@prisma/client";
import {
  DS_ARCHITECT_MAX_MISSION_POINTS,
  DS_ARCHITECT_PROGRAM_SLUG,
  DS_ARCHITECT_TOTAL_DAYS,
} from "@/features/ds-architect/constants";
import {
  behindByDays,
  deriveDayState,
  elapsedDay,
  formatUnlockLabel,
  maxUnlockedDay,
  unlockKeyForDay,
  type DsArchitectDayState,
} from "@/features/ds-architect/progression";
import { isDayLockBypassEnabled } from "@/lib/feature-flags";
import type { VerdictLine } from "@/features/program/verify-mission";
import type { CurriculumModule } from "@/features/program/progression";
import {
  getDsArchitectEnrollmentProgress,
  listDsArchitectProgress,
  listRecentDsArchitectAttempts,
  type DsArchitectEnrollment,
} from "@/repositories/ds-architect";
import { listCurriculumForProgramSlug } from "@/repositories/learning";

export type DsArchitectDashboard = {
  modules: CurriculumModule[];
  days: {
    dayNumber: number;
    title: string;
    missionType: ProgramMissionType;
    isProjectDay: boolean;
    moduleNumber: number;
    state: DsArchitectDayState;
    late: boolean;
  }[];
  currentDay: {
    dayNumber: number;
    title: string;
    missionType: ProgramMissionType;
  } | null;
  nextLockedDay: number | null;
  nextUnlockDateLabel: string | null;
  clearedCount: number;
  totalDays: 10;
  missionPoints: number;
  maxMissionPoints: 175;
  currentStreak: number;
  memberDay: number;
  elapsedDay: number;
  behindBy: number;
  lateDayCount: number;
  isComplete: boolean;
  completedLate: boolean;
  recentVerdicts: {
    dayNumber: number;
    passed: boolean;
    checks: VerdictLine[];
    createdAt: string;
  }[];
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

export async function getDsArchitectDashboard(
  enrollment: DsArchitectEnrollment,
): Promise<DsArchitectDashboard> {
  const [catalog, progress, cached, recent] = await Promise.all([
    listCurriculumForProgramSlug(DS_ARCHITECT_PROGRAM_SLUG),
    listDsArchitectProgress(enrollment.id),
    getDsArchitectEnrollmentProgress(enrollment.id),
    listRecentDsArchitectAttempts(enrollment.id, 8),
  ]);

  const passedDays = new Set(
    progress.filter((p) => p.passed).map((p) => p.dayNumber),
  );
  const lateDays = new Set(
    progress
      .filter((p) => p.passed && p.lateness === AttemptLateness.LATE)
      .map((p) => p.dayNumber),
  );
  const maxUnlocked = maxUnlockedDay(enrollment.startedAt);
  const bypass = isDayLockBypassEnabled();
  const memberDay = passedDays.size === 0 ? 0 : Math.max(...passedDays);

  const days = catalog.days.map((d) => ({
    dayNumber: d.dayNumber,
    title: d.title,
    missionType: d.missionType,
    isProjectDay: d.isProjectDay,
    moduleNumber: d.moduleNumber,
    state: deriveDayState(d.dayNumber, maxUnlocked, passedDays, bypass),
    late: lateDays.has(d.dayNumber),
  }));

  const current = days.find((d) => d.state === "AVAILABLE") ?? null;
  const nextLocked = days.find((d) => d.state === "LOCKED") ?? null;
  const isComplete = enrollment.status === EnrollmentStatusV2.COMPLETED;
  const lastDay = progress.find((p) => p.dayNumber === DS_ARCHITECT_TOTAL_DAYS);

  return {
    modules: catalog.modules,
    days,
    currentDay: current
      ? {
          dayNumber: current.dayNumber,
          title: current.title,
          missionType: current.missionType,
        }
      : null,
    nextLockedDay: nextLocked?.dayNumber ?? null,
    nextUnlockDateLabel: nextLocked
      ? formatUnlockLabel(
          unlockKeyForDay(enrollment.startedAt, nextLocked.dayNumber),
        )
      : null,
    clearedCount: passedDays.size,
    totalDays: DS_ARCHITECT_TOTAL_DAYS,
    missionPoints: cached?.pointsEarned ?? 0,
    maxMissionPoints: DS_ARCHITECT_MAX_MISSION_POINTS,
    currentStreak: cached?.currentStreak ?? 0,
    memberDay,
    elapsedDay: elapsedDay(enrollment.startedAt),
    behindBy: behindByDays(enrollment.startedAt, memberDay),
    lateDayCount: lateDays.size,
    isComplete,
    completedLate:
      isComplete && lastDay?.lateness === AttemptLateness.LATE,
    recentVerdicts: recent.map((r) => ({
      dayNumber: r.dayNumber,
      passed: r.passed,
      checks: parseVerdict(r.verdict),
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
