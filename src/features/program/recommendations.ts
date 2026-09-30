import "server-only";
import { prisma } from "@/lib/db";
import { askClaudeJson } from "@/lib/anthropic";
import { PROGRAM_TOTAL_DAYS } from "@/features/program/constants";
import { getMemberCalendarDay } from "@/features/program/progression";
import { getMemberAtRiskStatus } from "@/features/program/commits";
import {
  applyProgramRecommendationChange,
  findAiCohortMembershipByMemberId,
  listAiCohortMemberships,
} from "@/repositories/program-state";
import { peIdForMember } from "@/repositories/ids";
import { ProgramMemberStatus } from "@prisma/client";

const RECOMMENDATION_TTL_DAYS = 7;
const GAP_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type RecommendationResponse = { recommendation: string };

export async function generateRecommendations(cohortId: string): Promise<{
  generated: number;
  skipped: number;
  failed: number;
}> {
  const members = await listAiCohortMemberships({
    programCohortId: cohortId,
    statuses: [ProgramMemberStatus.ENROLLED, ProgramMemberStatus.COMPLETED],
  });
  const peIds = members.map((m) => peIdForMember(m.id));
  const [projects, commitDays] = peIds.length
    ? await Promise.all([
        prisma.programProject.findMany({
          where: {
            programEnrollmentId: { in: peIds },
            status: "GRADED",
          },
          select: {
            programEnrollmentId: true,
            moduleNumber: true,
            adminScore: true,
            aiScore: true,
          },
        }),
        prisma.programCommitDay.findMany({
          where: {
            programEnrollmentId: { in: peIds },
            commitCount: { gt: 0 },
          },
          select: { programEnrollmentId: true, date: true },
        }),
      ])
    : [[], []];
  const projectsByMember = new Map<string, typeof projects>();
  for (const p of projects) {
    const memberId = p.programEnrollmentId.startsWith("pe_pm_")
      ? p.programEnrollmentId.slice("pe_pm_".length)
      : p.programEnrollmentId;
    const list = projectsByMember.get(memberId) ?? [];
    list.push(p);
    projectsByMember.set(memberId, list);
  }
  const commitsByMember = new Map<string, number>();
  for (const c of commitDays) {
    const memberId = c.programEnrollmentId.startsWith("pe_pm_")
      ? c.programEnrollmentId.slice("pe_pm_".length)
      : c.programEnrollmentId;
    commitsByMember.set(memberId, (commitsByMember.get(memberId) ?? 0) + 1);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RECOMMENDATION_TTL_DAYS);

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const member of members) {
    if (member.aiRecommendationAt && member.aiRecommendationAt > cutoff) {
      skipped += 1;
      continue;
    }

    const calendarDay = getMemberCalendarDay(member);
    const expectedDay = calendarDay;
    const atRisk = await getMemberAtRiskStatus(member.id);
    const behindBy = atRisk.behindBy;
    const missionsPassed = Math.floor(member.missionPoints / 12);
    const cleanPassPct =
      missionsPassed > 0
        ? Math.round((member.cleanPassCount / missionsPassed) * 100)
        : 0;

    const projectSummary = (projectsByMember.get(member.id) ?? [])
      .map(
        (p) =>
          `M${p.moduleNumber}:${p.adminScore ?? p.aiScore ?? 0}/100`,
      )
      .join(", ");

    const ai = await askClaudeJson<RecommendationResponse>({
      system:
        "Write recruiter-readable recommendations for B2B program candidates. Reply JSON only: {\"recommendation\":\"...\"}. 2-3 sentences, concrete, no fluff.",
      user: [
        `Name: ${member.fullName}`,
        `Role: ${member.jobRole} @ ${member.company}`,
        `Scores — missions:${member.missionPoints} concept:${member.conceptPoints} commits:${member.commitPoints} projects:${member.projectPoints} total:${member.totalScore}`,
        `Progress: day ${member.highestUnlockedDay}/${PROGRAM_TOTAL_DAYS}, cohort content day ${expectedDay}, behind by ${behindBy}`,
        `Clean pass rate: ${cleanPassPct}%, skip tokens used: ${member.skipTokensUsed}`,
        `Project grades: ${projectSummary || "none yet"}`,
        `At-risk flags: ${atRisk.reasons.join(", ") || "none"}`,
        `Commit days logged: ${commitsByMember.get(member.id) ?? 0}`,
      ].join("\n"),
      maxTokens: 512,
    });

    if (!ai.ok || typeof ai.data.recommendation !== "string") {
      failed += 1;
      await sleep(GAP_MS);
      continue;
    }

    await applyProgramRecommendationChange(prisma, {
      memberId: member.id,
      aiRecommendation: ai.data.recommendation.trim(),
    });

    generated += 1;
    await sleep(GAP_MS);
  }

  return { generated, skipped, failed };
}

export async function getMemberRecommendation(
  memberId: string,
): Promise<{ recommendation: string | null; generatedAt: string | null }> {
  const member = await findAiCohortMembershipByMemberId(memberId);
  if (!member) {
    return { recommendation: null, generatedAt: null };
  }
  return {
    recommendation: member.aiRecommendation ?? null,
    generatedAt: member.aiRecommendationAt?.toISOString() ?? null,
  };
}
