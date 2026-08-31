import "server-only";
import { DATABRICKS_PROGRAM_SLUG } from "@/features/databricks/constants";
import {
  deriveDayState,
  maxUnlockedDay,
  type DatabricksDayState,
} from "@/features/databricks/progression";
import { isDayLockBypassEnabled } from "@/lib/feature-flags";
import type { DatabricksEnrollment } from "@/repositories/databricks";
import { listDatabricksProgress } from "@/repositories/databricks";
import {
  getDayShellForProgramSlug,
  type ProgramSlugDayShell,
} from "@/repositories/learning";

export async function getDatabricksDayShell(
  enrollment: DatabricksEnrollment,
  dayNumber: number,
): Promise<{ day: ProgramSlugDayShell; state: DatabricksDayState } | null> {
  const day = await getDayShellForProgramSlug(
    DATABRICKS_PROGRAM_SLUG,
    dayNumber,
  );
  if (!day) return null;
  const progress = await listDatabricksProgress(enrollment.id);
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
