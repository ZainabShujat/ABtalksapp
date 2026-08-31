import { requireProgramMember } from "@/lib/program-auth";
import { getMemberDashboard } from "@/features/program/dashboard";
import { getMemberAtRiskStatus } from "@/features/program/commits";
import { getMemberProjectsSummary } from "@/features/program/projects";
import { getMemberRecommendation } from "@/features/program/recommendations";
import { getInterviewDashboardCard } from "@/features/program/interview";
import { getCohortInterviewState } from "@/features/interview/cohort-eligibility";
import { toProgramMemberId } from "@/features/interview/provider";
import { ProgramDashboardView } from "@/components/program/program-dashboard-view";

export default async function ProgramDashboardPage() {
  const { member, cohort, userId } = await requireProgramMember();
  
  const { prisma } = await import("@/lib/db");
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const isIshaan = user?.email === "demo-day31@abtalks.dev";

  const [data, atRisk, projects, aiRec, interviewCard, cohortInterviewState] =
    await Promise.all([
      getMemberDashboard(member.id, cohort.id),
      getMemberAtRiskStatus(member.id, cohort.id),
      getMemberProjectsSummary(member.id),
      getMemberRecommendation(member.id),
      getInterviewDashboardCard(member.id),
      // Server-authoritative: unlocks are derived from the member's actual
      // PASSED mission days (1..15 / 1..31), never from a client-side count.
      getCohortInterviewState(toProgramMemberId(member.id)),
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
      interviewCard={interviewCard}
      cohortInterviewState={cohortInterviewState}
      isIshaan={isIshaan}
    />
  );
}
