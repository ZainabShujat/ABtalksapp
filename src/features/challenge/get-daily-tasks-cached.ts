import { unstable_cache } from "next/cache";
import { isNewLearningRepoEnabled } from "@/lib/feature-flags";
import {
  listCachedDailyTasks,
  listDailyTasks,
} from "@/repositories/learning";

export type CachedDailyTask = {
  id: string;
  dayNumber: number;
  problemStatement: string;
  learningObjectives: string[];
  resources: string[];
  tags: string[];
  difficulty: string;
  estimatedMinutes: number;
};

/**
 * All 60 days of immutable task body content for a challenge, cached indefinitely
 * (seeded content; only changes on reseed). Titles are fetched live via
 * `getDailyTaskTitlesLive`. Keyed + tagged by challengeId so a content reseed can
 * bust it via `revalidateTag('daily-tasks:<challengeId>')`.
 */
export function getDailyTasksCached(
  challengeId: string,
): Promise<CachedDailyTask[]> {
  const learningOn = isNewLearningRepoEnabled();
  return unstable_cache(
    async (): Promise<CachedDailyTask[]> => {
      return listCachedDailyTasks(challengeId);
    },
    ["daily-tasks", challengeId, learningOn ? "new" : "legacy"],
    { tags: [`daily-tasks:${challengeId}`], revalidate: false },
  )();
}

export async function getDailyTaskTitlesLive(
  challengeId: string,
): Promise<Map<number, string>> {
  const rows = await listDailyTasks(challengeId);
  return new Map(rows.map((r) => [r.dayNumber, r.title]));
}
