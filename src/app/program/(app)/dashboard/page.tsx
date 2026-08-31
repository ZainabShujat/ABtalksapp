import { requireProgramMember } from "@/lib/program-auth";
import { getMemberDashboard } from "@/features/program/dashboard";
import { getMemberAtRiskStatus } from "@/features/program/commits";
import { getMemberProjectsSummary } from "@/features/program/projects";
import { getMemberRecommendation } from "@/features/program/recommendations";
import { ProgramDashboardView } from "@/components/program/program-dashboard-view";

export default async function ProgramDashboardPage() {
  const { member, cohort } = await requireProgramMember();
  const [data, atRisk, projects, aiRec] = await Promise.all([
    getMemberDashboard(member.id, cohort.id),
    getMemberAtRiskStatus(member.id, cohort.id),
    getMemberProjectsSummary(member.id),
    getMemberRecommendation(member.id),
  ]);

  if (!data) {
    return (
      <p className="text-sm text-[#9CA3AF]">Dashboard unavailable.</p>
    );
  }

  return (
    <ProgramDashboardView
      data={data}
      atRisk={atRisk}
      projects={projects}
      aiRec={aiRec}
    />
  );
}
