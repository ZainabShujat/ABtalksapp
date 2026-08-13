import "server-only";
import { INTERVIEW_QUESTION_COUNT } from "@/features/interview/constants";
import { computeEligibility } from "@/features/interview/eligibility";
import {
  beginInterview,
  finalizeInterview,
  submitAnswer,
} from "@/features/interview/orchestrator";
import { phraseQuestions } from "@/features/interview/question-generation";
import { planQuestions } from "@/features/interview/question-rules";
import { buildRubricSnapshot } from "@/features/interview/rubric";
import { createInitialState } from "@/features/interview/state";
import {
  buildDemoCandidateContext,
  DEMO_CANDIDATE_ID,
  DEMO_CANDIDATE_NAME,
} from "@/features/interview/mock/seed";
import type {
  AnswerTurnData,
  ClientQuestion,
  FinishInterviewData,
  InterviewOverview,
  InterviewProvider,
  LatestResult,
  ProviderResult,
  StartInterviewData,
} from "@/features/interview/provider";
import type { PriorAttempt } from "@/features/interview/eligibility";
import type {
  InterviewPlan,
  InterviewState,
  InterviewStatus,
  PlannedQuestion,
} from "@/features/interview/types";

/**
 * In-memory interview provider for the demo.
 *
 * ONLY persistence is mocked. Question planning (`planQuestions`), phrasing
 * (`phraseQuestions`), turn routing (`submitAnswer` → `advanceTurn`), evidence
 * evaluation, scoring and the retake rule are the production implementations,
 * unchanged. Swapping this for `prismaInterviewProvider` changes where rows live
 * and nothing else.
 *
 * Rows live on `globalThis` so they survive Next's dev-server hot reloads, the
 * same trick `lib/db.ts` uses for the Prisma client. Restarting the server
 * resets the demo, which is the intent.
 */

type MockAttempt = {
  id: string;
  candidateId: string;
  attemptNumber: number | null;
  status: InterviewStatus;
  plan: InterviewPlan;
  state: InterviewState;
  eligibleSubmissionIds: string[];
  consumedSubmissionIds: string[];
  startedAt: Date | null;
  result: LatestResult | null;
};

type MockStore = {
  attempts: Map<string, MockAttempt>;
  seq: number;
};

const globalForMock = globalThis as unknown as {
  __abtalksInterviewMock?: MockStore;
};

function store(): MockStore {
  if (!globalForMock.__abtalksInterviewMock) {
    globalForMock.__abtalksInterviewMock = { attempts: new Map(), seq: 0 };
  }
  return globalForMock.__abtalksInterviewMock;
}

function attemptsFor(candidateId: string): MockAttempt[] {
  return [...store().attempts.values()].filter(
    (a) => a.candidateId === candidateId,
  );
}

function toPriorAttempts(candidateId: string): PriorAttempt[] {
  return attemptsFor(candidateId).map((a) => ({
    attemptNumber: a.attemptNumber ?? 0,
    status: a.status,
    consumedSubmissionIds: a.consumedSubmissionIds,
    startedAt: a.startedAt,
  }));
}

function toClientQuestion(question: PlannedQuestion): ClientQuestion {
  return {
    id: question.id,
    order: question.order,
    text: question.text,
    totalQuestions: INTERVIEW_QUESTION_COUNT,
  };
}

function activeAttempt(candidateId: string): MockAttempt | undefined {
  return attemptsFor(candidateId).find((a) => a.status === "IN_PROGRESS");
}

function buildPlan(): InterviewPlan {
  const context = buildDemoCandidateContext();
  const questions = planQuestions(context);
  const challengeSourced = questions.filter(
    (q) => q.sourceRef.source === "CHALLENGE_TASK",
  ).length;
  const resumeSourced = questions.filter(
    (q) => q.sourceRef.source === "RESUME_CLAIM",
  ).length;

  return {
    questions,
    rubricSnapshot: buildRubricSnapshot(),
    contextSummary: {
      totalCompletedDays: context.challenge.totalCompletedDays,
      challengeSourcedQuestions: challengeSourced,
      resumeSourcedQuestions: resumeSourced,
      genericQuestions: questions.length - challengeSourced - resumeSourced,
      hasStructuredResume: context.resume.hasStructuredResume,
    },
  };
}

export const mockInterviewProvider: InterviewProvider = {
  mode: "mock",

  async getOverview(
    candidateId: string,
  ): Promise<ProviderResult<InterviewOverview>> {
    const context = buildDemoCandidateContext();
    const eligibility = computeEligibility(
      context.challenge.completedSubmissionIds,
      toPriorAttempts(candidateId),
    );

    const completed = attemptsFor(candidateId)
      .filter((a) => a.status === "COMPLETED")
      .sort((a, b) => (b.attemptNumber ?? 0) - (a.attemptNumber ?? 0));

    return {
      ok: true,
      data: {
        candidateName: DEMO_CANDIDATE_NAME,
        eligibility,
        activeInterviewId: activeAttempt(candidateId)?.id ?? null,
        totalCompletedDays: context.challenge.totalCompletedDays,
        latestResult: completed[0]?.result ?? null,
      },
    };
  },

  async start(
    candidateId: string,
  ): Promise<ProviderResult<StartInterviewData>> {
    if (activeAttempt(candidateId)) {
      return { ok: false, message: "You already have an interview in progress." };
    }

    const context = buildDemoCandidateContext();
    const eligibility = computeEligibility(
      context.challenge.completedSubmissionIds,
      toPriorAttempts(candidateId),
    );

    if (eligibility.state !== "ready") {
      return {
        ok: false,
        message:
          eligibility.state === "locked" || eligibility.state === "retake_locked"
            ? eligibility.reason
            : "You already have an interview in progress.",
      };
    }

    const base = buildPlan();
    // Real LLM phrasing when a key is configured; deterministic templates when
    // not. Either way this is the production code path.
    const questions = await phraseQuestions(context, base.questions);
    const plan: InterviewPlan = { ...base, questions };

    const opened = beginInterview(plan, createInitialState());
    if (!opened.ok) return { ok: false, message: opened.message };

    const first = opened.data.nextQuestion;
    if (!first) return { ok: false, message: "Could not start this interview." };

    const s = store();
    s.seq += 1;
    const id = `mock-interview-${s.seq}`;
    s.attempts.set(id, {
      id,
      candidateId,
      attemptNumber: null,
      status: "IN_PROGRESS",
      plan,
      state: opened.data.state,
      eligibleSubmissionIds: eligibility.eligibleSubmissionIds,
      consumedSubmissionIds: [],
      startedAt: new Date(),
      result: null,
    });

    return {
      ok: true,
      data: { interviewId: id, question: toClientQuestion(first) },
    };
  },

  async answer(
    candidateId: string,
    interviewId: string,
    questionId: string,
    answerText: string,
  ): Promise<ProviderResult<AnswerTurnData>> {
    const attempt = store().attempts.get(interviewId);
    if (
      !attempt ||
      attempt.candidateId !== candidateId ||
      attempt.status !== "IN_PROGRESS"
    ) {
      return { ok: false, message: "This interview is no longer in progress." };
    }

    const turn = await submitAnswer(
      attempt.plan,
      attempt.state,
      questionId,
      answerText,
    );
    if (!turn.ok) return turn;

    attempt.state = turn.data.state;

    return {
      ok: true,
      data: {
        isFollowUp: turn.data.action === "FOLLOW_UP",
        prompt: turn.data.nextPrompt,
        question: turn.data.nextQuestion
          ? toClientQuestion(turn.data.nextQuestion)
          : null,
        finished: turn.data.finished,
      },
    };
  },

  async finish(
    candidateId: string,
    interviewId: string,
  ): Promise<ProviderResult<FinishInterviewData>> {
    const attempt = store().attempts.get(interviewId);
    if (
      !attempt ||
      attempt.candidateId !== candidateId ||
      attempt.status !== "IN_PROGRESS"
    ) {
      return { ok: false, message: "This interview is no longer in progress." };
    }

    const durationSec = attempt.startedAt
      ? Math.round((Date.now() - attempt.startedAt.getTime()) / 1000)
      : 0;

    // The demo runs far faster than a real interview; the minimum-duration floor
    // is a production guard, not a demo one, so credit the planned length here.
    const answered = Object.keys(attempt.state.evidenceByQuestionId).length;
    const effectiveDuration = Math.max(durationSec, answered >= 1 ? 600 : 0);

    const finalized = await finalizeInterview(
      attempt.plan,
      attempt.state,
      effectiveDuration,
    );

    if (!finalized.ok) {
      attempt.status = "INVALID";
      return { ok: false, message: finalized.message };
    }

    const priorNumbers = attemptsFor(candidateId)
      .map((a) => a.attemptNumber ?? 0)
      .reduce((max, n) => Math.max(max, n), 0);
    const attemptNumber = priorNumbers + 1;
    const { scores } = finalized.data;

    attempt.status = "COMPLETED";
    attempt.attemptNumber = attemptNumber;
    attempt.state = finalized.data.state;
    // Consumption happens here and only here, mirroring the Prisma transaction.
    attempt.consumedSubmissionIds = attempt.eligibleSubmissionIds;
    attempt.result = {
      attemptNumber,
      overallScore: scores.overallScore,
      conceptualScore:
        scores.perCompetency.find((c) => c.competency === "CONCEPTUAL")?.score ??
        null,
      practicalScore:
        scores.perCompetency.find((c) => c.competency === "PRACTICAL")?.score ??
        null,
      problemSolvingScore:
        scores.perCompetency.find((c) => c.competency === "PROBLEM_SOLVING")
          ?.score ?? null,
      technicalDepthScore:
        scores.perCompetency.find((c) => c.competency === "TECHNICAL_DEPTH")
          ?.score ?? null,
      communicationScore:
        scores.perCompetency.find((c) => c.competency === "COMMUNICATION")
          ?.score ?? null,
      summary: scores.summary || null,
      evaluatedAt: new Date(),
    };

    return { ok: true, data: { attemptNumber, scores } };
  },

  async abandon(
    candidateId: string,
    interviewId: string,
  ): Promise<ProviderResult<null>> {
    const attempt = store().attempts.get(interviewId);
    if (
      !attempt ||
      attempt.candidateId !== candidateId ||
      attempt.status !== "IN_PROGRESS"
    ) {
      return { ok: false, message: "No interview in progress." };
    }
    // Consumes nothing — same invariant as the Prisma provider.
    attempt.status = "ABANDONED";
    return { ok: true, data: null };
  },
};

export { DEMO_CANDIDATE_ID };
