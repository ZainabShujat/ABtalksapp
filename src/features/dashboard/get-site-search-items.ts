import { cache } from "react";
import { auth } from "@/auth";
import { listChallengeEnrollments } from "@/repositories/learning";
import { resolveProgramMemberForUser } from "@/lib/program-auth";
import {
  isClaudeEnabled,
  isDatabricksAiEnabled,
  isDatabricksEnabled,
  isDsArchitectEnabled,
  isLangchainEnabled,
  isPowerBiEnabled,
  isProgramEnabled,
  isSnowflakeEnabled,
} from "@/lib/feature-flags";
import { loadAvailableInterviews } from "@/features/dashboard/load-available-interviews";
import { listPublicEvents } from "@/repositories/workshop";
import {
  buildHubSearchIndex,
  type HubSearchItem,
} from "@/features/dashboard/hub-search-index";
import type { HubEnrollment } from "@/features/dashboard/get-hub-data";

async function guestCatalog(): Promise<HubSearchItem[]> {
  return buildHubSearchIndex({
    workshopEvents: await listPublicEvents(),
    enrollments: [],
    joinedDomains: [],
    abandonedDomains: [],
    hasProgramMembership: false,
    hasDatabricksAccess: isDatabricksEnabled(),
    hasDsArchitectAccess: isDsArchitectEnabled(),
    hasPowerBiAccess: isPowerBiEnabled(),
    hasSnowflakeAccess: isSnowflakeEnabled(),
    hasDatabricksAiAccess: isDatabricksAiEnabled(),
    hasLangchainAccess: isLangchainEnabled(),
    isAdmin: false,
    claudeEnabled: isClaudeEnabled(),
    programEnabled: isProgramEnabled(),
    mock: [],
    cohort: [],
  });
}

/**
 * Lean search catalog for the global header combobox.
 *
 * Skips heatmap/streak/profile from `getHubData`. Cached per request so the
 * root layout and the hub page do not double-fetch interviews.
 */
export const getSiteSearchItems = cache(async (): Promise<HubSearchItem[]> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return guestCatalog();

  const programEnabled = isProgramEnabled();
  const [rows, hasProgramMembership, interviews] = await Promise.all([
    listChallengeEnrollments(userId),
    programEnabled
      ? resolveProgramMemberForUser(userId).then((m) => m !== null)
      : Promise.resolve(false),
    loadAvailableInterviews(userId),
  ]);

  const joined = rows.filter(
    (r) => r.status === "ACTIVE" || r.status === "COMPLETED",
  );
  const enrollments: HubEnrollment[] = [
    ...joined.filter((r) => r.status === "ACTIVE"),
    ...joined.filter((r) => r.status === "COMPLETED"),
  ].map((r) => ({
    id: r.id,
    domain: r.domain,
    status: r.status as "ACTIVE" | "COMPLETED",
    challengeTitle: r.challengeTitle,
    daysCompleted: r.daysCompleted,
    currentStreak: r.currentStreak,
  }));

  return buildHubSearchIndex({
    workshopEvents: await listPublicEvents(),
    enrollments,
    joinedDomains: [...new Set(joined.map((r) => r.domain))],
    abandonedDomains: [
      ...new Set(
        rows.filter((r) => r.status === "ABANDONED").map((r) => r.domain),
      ),
    ],
    hasProgramMembership,
    hasDatabricksAccess: isDatabricksEnabled(),
    hasDsArchitectAccess: isDsArchitectEnabled(),
    hasPowerBiAccess: isPowerBiEnabled(),
    hasSnowflakeAccess: isSnowflakeEnabled(),
    hasDatabricksAiAccess: isDatabricksAiEnabled(),
    hasLangchainAccess: isLangchainEnabled(),
    isAdmin: session.user.isAdmin ?? false,
    claudeEnabled: isClaudeEnabled(),
    programEnabled,
    mock: interviews.mock,
    cohort: interviews.cohort,
  });
});
