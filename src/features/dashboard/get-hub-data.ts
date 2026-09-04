import type { Domain } from "@prisma/client";
import { isDatabricksEnabled, isDsArchitectEnabled, isProgramEnabled } from "@/lib/feature-flags";
import { prisma } from "@/lib/db";
import { isUserRegistered } from "@/features/hackathon/registration-status";
import { resolveProgramMemberForUser } from "@/lib/program-auth";
import { getProfileSummary } from "@/repositories/candidate";
import { listChallengeEnrollments } from "@/repositories/learning";
import { listHubSubmissionTimes } from "@/repositories/progress";
import {
  getActivityHeatmap,
  type ActivityHeatmap,
} from "@/features/dashboard/get-activity-heatmap";
import type { ActivityStreak } from "@/features/dashboard/compute-activity-streak";

export type HubDataNoUser = {
  hasUser: false;
};

export type HubEnrollment = {
  id: string;
  domain: Domain;
  status: "ACTIVE" | "COMPLETED";
  challengeTitle: string;
  daysCompleted: number;
  currentStreak: number;
};

export type HubData = {
  hasUser: true;
  profile: { fullName: string; referralCode: string } | null;
  enrollments: HubEnrollment[];
  joinedDomains: Domain[];
  abandonedDomains: Domain[];
  hasProgramMembership: boolean;
  hasDatabricksAccess: boolean;
  hasDsArchitectAccess: boolean;
  isHackathonRegistered: boolean;
  heatmap: ActivityHeatmap;
  streak: ActivityStreak;
};

export async function getHubData(
  userId: string,
): Promise<HubData | HubDataNoUser> {
  const programEnabled = isProgramEnabled();

  const [
    user,
    rows,
    hasProgramMembership,
    isHackathonRegistered,
    heatmap,
    profile,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    }),
    listChallengeEnrollments(userId),
    programEnabled
      ? resolveProgramMemberForUser(userId).then((m) => m !== null)
      : Promise.resolve(false),
    isUserRegistered(userId),
    listHubSubmissionTimes(userId).then(getActivityHeatmap),
    getProfileSummary(userId),
  ]);

  if (!user) {
    return { hasUser: false };
  }

  const joined = rows.filter(
    (r) => r.status === "ACTIVE" || r.status === "COMPLETED",
  );

  // ACTIVE first, then COMPLETED; startedAt asc within each group.
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

  const joinedDomains = [...new Set(joined.map((r) => r.domain))];
  const abandonedDomains = [
    ...new Set(rows.filter((r) => r.status === "ABANDONED").map((r) => r.domain)),
  ];

  return {
    hasUser: true,
    profile,
    enrollments,
    joinedDomains,
    abandonedDomains,
    hasProgramMembership,
    hasDatabricksAccess: isDatabricksEnabled(),
    hasDsArchitectAccess: isDsArchitectEnabled(),
    isHackathonRegistered,
    heatmap,
    streak: heatmap.streak,
  };
}
