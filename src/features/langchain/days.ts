import "server-only";
import { LANGCHAIN_PROGRAM_SLUG } from "@/features/langchain/constants";
import {
  deriveDayState,
  maxUnlockedDay,
  type LangchainDayState,
} from "@/features/langchain/progression";
import { isDayLockBypassEnabled } from "@/lib/feature-flags";
import type { LangchainEnrollment } from "@/repositories/langchain";
import { listLangchainProgress } from "@/repositories/langchain";
import {
  getDayShellForProgramSlug,
  type ProgramSlugDayShell,
} from "@/repositories/learning";

export async function getLangchainDayShell(
  enrollment: LangchainEnrollment,
  dayNumber: number,
): Promise<{ day: ProgramSlugDayShell; state: LangchainDayState } | null> {
  const day = await getDayShellForProgramSlug(
    LANGCHAIN_PROGRAM_SLUG,
    dayNumber,
  );
  if (!day) return null;
  const progress = await listLangchainProgress(enrollment.id);
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
