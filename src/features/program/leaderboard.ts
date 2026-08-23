import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { programMember } from "@/repositories/legacy/program-member";

export type ProgramLeaderboardRow = {
  rank: number;
  memberId: string;
  fullName: string;
  company: string;
  jobRole: string;
  yearsExperience: number;
  missionPoints: number;
  conceptPoints: number;
  commitPoints: number;
  projectPoints: number;
  totalScore: number;
  cleanPassCount: number;
  cleanPassPct: number;
  isViewer: boolean;
};

async function fetchLeaderboard(cohortId: string): Promise<ProgramLeaderboardRow[]> {
  const members = await programMember.findMany({
    where: {
      cohortId,
      status: { in: ["ENROLLED", "COMPLETED"] },
    },
    orderBy: [
      { totalScore: "desc" },
      { projectPoints: "desc" },
      { missionPoints: "desc" },
      { enrolledAt: "asc" },
    ],
    select: {
      id: true,
      fullName: true,
      company: true,
      jobRole: true,
      yearsExperience: true,
      missionPoints: true,
      conceptPoints: true,
      commitPoints: true,
      projectPoints: true,
      totalScore: true,
      cleanPassCount: true,
    },
  });

  return members.map((m, index) => {
    const missionsPassed = Math.floor(m.missionPoints / 12);
    const cleanPassPct =
      missionsPassed > 0
        ? Math.round((m.cleanPassCount / missionsPassed) * 100)
        : 0;
    return {
      rank: index + 1,
      memberId: m.id,
      fullName: m.fullName,
      company: m.company,
      jobRole: m.jobRole,
      yearsExperience: m.yearsExperience,
      missionPoints: m.missionPoints,
      conceptPoints: m.conceptPoints,
      commitPoints: m.commitPoints,
      projectPoints: m.projectPoints,
      totalScore: m.totalScore,
      cleanPassCount: m.cleanPassCount,
      cleanPassPct,
      isViewer: false,
    };
  });
}

export async function getProgramLeaderboard(
  cohortId: string,
  viewerMemberId?: string,
): Promise<ProgramLeaderboardRow[]> {
  const cached = unstable_cache(
    () => fetchLeaderboard(cohortId),
    [`program-leaderboard-${cohortId}`],
    { revalidate: 300, tags: [`program-leaderboard-${cohortId}`] },
  );
  const rows = await cached();
  if (!viewerMemberId) return rows;
  return rows.map((r) => ({ ...r, isViewer: r.memberId === viewerMemberId }));
}

export async function getMemberRank(
  cohortId: string,
  memberId: string,
): Promise<number | null> {
  const rows = await getProgramLeaderboard(cohortId);
  const row = rows.find((r) => r.memberId === memberId);
  return row?.rank ?? null;
}
