import "server-only";
import { DS_ARCHITECT_PROGRAM_SLUG } from "@/features/ds-architect/constants";
import {
  deriveDayState,
  maxUnlockedDay,
  type DsArchitectDayState,
} from "@/features/ds-architect/progression";
import { isDayLockBypassEnabled } from "@/lib/feature-flags";
import type { DsArchitectEnrollment } from "@/repositories/ds-architect";
import { listDsArchitectProgress } from "@/repositories/ds-architect";
import {
  getDayShellForProgramSlug,
  type ProgramSlugDayShell,
} from "@/repositories/learning";

export async function getDsArchitectDayShell(
  enrollment: DsArchitectEnrollment,
  dayNumber: number,
): Promise<{ day: ProgramSlugDayShell; state: DsArchitectDayState } | null> {
  const day = await getDayShellForProgramSlug(
    DS_ARCHITECT_PROGRAM_SLUG,
    dayNumber,
  );
  if (!day) return null;
  const progress = await listDsArchitectProgress(enrollment.id);
  const passedDays = new Set(
    progress.filter((p) => p.passed).map((p) => p.dayNumber),
  );
  const state = deriveDayState(
    dayNumber,
    maxUnlockedDay(enrollment.startedAt),
    passedDays,
    isDayLockBypassEnabled(),
  );
  return { day, state };
}
