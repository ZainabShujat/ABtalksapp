import "server-only";
import { POWERBI_PROGRAM_SLUG } from "@/features/powerbi/constants";
import {
  deriveDayState,
  maxUnlockedDay,
  type PowerBiDayState,
} from "@/features/powerbi/progression";
import { isDayLockBypassEnabled } from "@/lib/feature-flags";
import type { PowerBiEnrollment } from "@/repositories/powerbi";
import { listPowerBiProgress } from "@/repositories/powerbi";
import {
  getDayShellForProgramSlug,
  type ProgramSlugDayShell,
} from "@/repositories/learning";

export async function getPowerBiDayShell(
  enrollment: PowerBiEnrollment,
  dayNumber: number,
): Promise<{ day: ProgramSlugDayShell; state: PowerBiDayState } | null> {
  const day = await getDayShellForProgramSlug(POWERBI_PROGRAM_SLUG, dayNumber);
  if (!day) return null;
  const progress = await listPowerBiProgress(enrollment.id);
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
