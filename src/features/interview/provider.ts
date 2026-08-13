import "server-only";
import type {
  InterviewEligibility,
  InterviewScores,
} from "@/features/interview/types";

/**
 * The seam between the interview UI and its storage.
 *
 * The UI talks only to this interface, so the in-memory demo provider and the
 * real Prisma-backed service are interchangeable without touching a component.
 * Everything above this line is real: question planning, turn routing, evidence
 * evaluation, scoring, and the retake rule all run the production code paths in
 * both modes. Only persistence differs.
 */

export type ProviderResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

/** What the client is allowed to know about a question. */
export type ClientQuestion = {
  id: string;
  order: number;
  text: string;
  totalQuestions: number;
};

export type LatestResult = {
  attemptNumber: number | null;
  overallScore: number | null;
  conceptualScore: number | null;
  practicalScore: number | null;
  problemSolvingScore: number | null;
  technicalDepthScore: number | null;
  communicationScore: number | null;
  summary: string | null;
  evaluatedAt: Date | null;
};

export type InterviewOverview = {
  candidateName: string;
  eligibility: InterviewEligibility;
  activeInterviewId: string | null;
  totalCompletedDays: number;
  latestResult: LatestResult | null;
};

export type StartInterviewData = {
  interviewId: string;
  question: ClientQuestion;
};

export type AnswerTurnData = {
  /** True when the same question stays open with a follow-up probe. */
  isFollowUp: boolean;
  prompt: string | null;
  question: ClientQuestion | null;
  finished: boolean;
};

export type FinishInterviewData = {
  attemptNumber: number;
  scores: InterviewScores;
};

export type InterviewProvider = {
  readonly mode: "mock" | "prisma";
  getOverview(candidateId: string): Promise<ProviderResult<InterviewOverview>>;
  start(candidateId: string): Promise<ProviderResult<StartInterviewData>>;
  answer(
    candidateId: string,
    interviewId: string,
    questionId: string,
    answerText: string,
  ): Promise<ProviderResult<AnswerTurnData>>;
  finish(
    candidateId: string,
    interviewId: string,
  ): Promise<ProviderResult<FinishInterviewData>>;
  abandon(
    candidateId: string,
    interviewId: string,
  ): Promise<ProviderResult<null>>;
};

/**
 * Demo mode is opt-in via INTERVIEW_DEMO=1 and never the default — a mock that
 * switched on by itself would be a production hazard. With it unset, the real
 * Prisma provider is used and a missing database fails loudly rather than
 * silently serving fabricated results.
 */
export function isDemoMode(): boolean {
  return process.env.INTERVIEW_DEMO === "1";
}

export async function getInterviewProvider(): Promise<InterviewProvider> {
  if (isDemoMode()) {
    const { mockInterviewProvider } = await import(
      "@/features/interview/mock/mock-provider"
    );
    return mockInterviewProvider;
  }
  const { prismaInterviewProvider } = await import(
    "@/features/interview/prisma-provider"
  );
  return prismaInterviewProvider;
}

/**
 * The candidate this request acts for.
 *
 * In demo mode this resolves to a fixed seeded id without touching NextAuth,
 * so the journey runs with no database at all. In real mode it is the signed-in
 * user and nothing else.
 */
export async function resolveCandidateId(): Promise<string | null> {
  if (isDemoMode()) {
    const { DEMO_CANDIDATE_ID } = await import(
      "@/features/interview/mock/seed"
    );
    return DEMO_CANDIDATE_ID;
  }
  const { auth } = await import("@/auth");
  const session = await auth();
  return session?.user?.id ?? null;
}
