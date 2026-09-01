import { requireProgramMember } from "@/lib/program-auth";
import { getProgramLeaderboard } from "@/features/program/leaderboard";
import { ProgramLeaderboardView } from "@/components/program/program-leaderboard-view";

export default async function ProgramLeaderboardPage() {
  const { member, cohort } = await requireProgramMember();
  const rows = await getProgramLeaderboard(cohort.id, member.id);

  return <ProgramLeaderboardView rows={rows} />;
}
