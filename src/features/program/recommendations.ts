import "server-only";
import { prisma } from "@/lib/db";
import { askClaudeJson } from "@/lib/anthropic";
import { PROGRAM_TOTAL_DAYS } from "@/features/program/constants";
import { getCohortCalendarDay } from "@/features/program/progression";
import { getMemberAtRiskStatus } from "@/features/program/commits";
import { programMember } from "@/repositories/legacy/program-member";

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
  const members = await programMember.findMany({
    where: {
      cohortId,
      status: { in: ["ENROLLED", "COMPLETED"] },
    },
    select: {
      id: true,
      fullName: true,
      jobRole: true,
      company: true,
      missionPoints: true,
      conceptPoints: true,
      commitPoints: true,
      projectPoints: true,
      totalScore: true,
      cleanPassCount: true,
      skipTokensUsed: true,
      highestUnlockedDay: true,
      aiRecommendationAt: true,
      cohort: { select: { startsAt: true, endsAt: true } },
      projects: {
        where: { status: "GRADED" },
        select: { moduleNumber: true, adminScore: true, aiScore: true },
      },
      commitDays: {
        where: { commitCount: { gt: 0 } },
        select: { date: true },
      },
    },
  });

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

    const calendarDay = getCohortCalendarDay(member.cohort);
    const expectedDay = calendarDay;
    const atRisk = await getMemberAtRiskStatus(member.id, cohortId);
    const behindBy = atRisk.behindBy;
    const missionsPassed = Math.floor(member.missionPoints / 12);
    const cleanPassPct =
      missionsPassed > 0
        ? Math.round((member.cleanPassCount / missionsPassed) * 100)
        : 0;

    const projectSummary = member.projects
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
        `Commit days logged: ${member.commitDays.length}`,
      ].join("\n"),
      maxTokens: 512,
    });

    if (!ai.ok || typeof ai.data.recommendation !== "string") {
      failed += 1;
      await sleep(GAP_MS);
      continue;
    }

    await programMember.update({
      where: { id: member.id },
      data: {
        aiRecommendation: ai.data.recommendation.trim(),
        aiRecommendationAt: new Date(),
      },
    });

    generated += 1;
    await sleep(GAP_MS);
  }

  return { generated, skipped, failed };
}

export async function getMemberRecommendation(
  memberId: string,
): Promise<{ recommendation: string | null; generatedAt: string | null }> {
  const member = await programMember.findUnique({
    where: { id: memberId },
    select: { aiRecommendation: true, aiRecommendationAt: true },
  });
  return {
    recommendation: member?.aiRecommendation ?? null,
    generatedAt: member?.aiRecommendationAt?.toISOString() ?? null,
  };
}
