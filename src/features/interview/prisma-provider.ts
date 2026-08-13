import "server-only";
import { prisma } from "@/lib/db";
import {
  abandonInterview,
  finishInterview,
  getInterviewOverview,
  recordAnswer,
  startInterviewForUser,
} from "@/features/interview/service";
import type { InterviewProvider } from "@/features/interview/provider";

/**
 * The production provider. A thin adapter over `service.ts` so the real flow and
 * the demo satisfy one interface — the UI cannot tell them apart.
 */
export const prismaInterviewProvider: InterviewProvider = {
  mode: "prisma",

  async getOverview(candidateId) {
    const overview = await getInterviewOverview(candidateId);
    if (!overview.ok) return overview;

    const profile = await prisma.studentProfile.findUnique({
      where: { userId: candidateId },
      select: { fullName: true },
    });

    return {
      ok: true,
      data: {
        candidateName: profile?.fullName ?? "there",
        eligibility: overview.data.eligibility,
        activeInterviewId: overview.data.activeInterviewId,
        totalCompletedDays: overview.data.totalCompletedDays,
        latestResult: overview.data.latestResult ?? null,
      },
    };
  },

  start: (candidateId) => startInterviewForUser(candidateId),

  answer: (candidateId, interviewId, questionId, answerText) =>
    recordAnswer(candidateId, interviewId, questionId, answerText),

  finish: (candidateId, interviewId) =>
    finishInterview(candidateId, interviewId),

  abandon: (candidateId, interviewId) =>
    abandonInterview(candidateId, interviewId),
};
