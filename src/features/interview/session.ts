import "server-only";
import { buildCandidateContext } from "@/features/interview/candidate-context";
import { computeEligibility } from "@/features/interview/eligibility";
import { phraseQuestions } from "@/features/interview/question-generation";
import { loadPriorAttempts } from "@/features/interview/repository";
import { planQuestions } from "@/features/interview/question-rules";
import { buildRubricSnapshot } from "@/features/interview/rubric";
import type {
  CandidateContext,
  InterviewEligibility,
  InterviewPlan,
} from "@/features/interview/types";

/**
 * Builds a General Interview session from a student's existing platform context.
 *
 * Split in two on purpose: eligibility is cheap and LLM-free, so read surfaces
 * (the pre-interview screen) can check it on every page load without paying for
 * question phrasing that only a started interview needs.
 */

export type EligibilityResolution = {
  context: CandidateContext;
  eligibility: InterviewEligibility;
};

export type ResolveEligibilityResult =
  | { ok: true; data: EligibilityResolution }
  | { ok: false; message: string };

/**
 * Prior attempts are loaded here rather than accepted as an argument. Letting a
 * caller supply them would make it possible to pass an empty list and silently
 * bypass the retake rule — a wrong answer that looks like a working one.
 *
 * No LLM calls.
 */
export async function resolveEligibility(
  userId: string,
): Promise<ResolveEligibilityResult> {
  const [context, priorAttempts] = await Promise.all([
    buildCandidateContext(userId),
    loadPriorAttempts(userId),
  ]);

  if (!context) {
    return { ok: false, message: "Complete your profile before interviewing." };
  }

  return {
    ok: true,
    data: {
      context,
      eligibility: computeEligibility(
        context.challenge.completedSubmissionIds,
        priorAttempts,
      ),
    },
  };
}

function buildPlan(context: CandidateContext): InterviewPlan {
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

export type InterviewSession = {
  context: CandidateContext;
  eligibility: InterviewEligibility;
  plan: InterviewPlan;
  /** Frozen at session creation; consumed by the attempt on completion. */
  eligibleSubmissionIds: string[];
};

export type BuildSessionResult =
  | { ok: true; data: InterviewSession }
  | { ok: false; message: string };

/**
 * Full session build, including LLM question phrasing. Only called when an
 * interview is actually starting.
 */
export async function buildInterviewSession(
  userId: string,
): Promise<BuildSessionResult> {
  const resolved = await resolveEligibility(userId);
  if (!resolved.ok) return { ok: false, message: resolved.message };

  const { context, eligibility } = resolved.data;
  const basePlan = buildPlan(context);

  if (eligibility.state !== "ready") {
    return {
      ok: true,
      data: {
        context,
        eligibility,
        plan: basePlan,
        eligibleSubmissionIds: [],
      },
    };
  }

  const questions = await phraseQuestions(context, basePlan.questions);

  return {
    ok: true,
    data: {
      context,
      eligibility,
      plan: { ...basePlan, questions },
      eligibleSubmissionIds: eligibility.eligibleSubmissionIds,
    },
  };
}
