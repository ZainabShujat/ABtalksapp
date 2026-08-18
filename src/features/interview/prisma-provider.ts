import "server-only";
import {
  abandonCohortInterview,
  finishCohortInterview,
  getCohortInterviewOverview,
  recordCohortAnswer,
  resumeCohortInterview,
  startCohortInterview,
} from "@/features/interview/service";
import type { InterviewBlueprintKey } from "@/features/interview/cohort/blueprint";
import type { ProviderResult } from "@/features/interview/provider";
import type {
  AnswerTurnData,
  CohortInterviewOverview,
  FinishInterviewData,
  StartInterviewData,
} from "@/features/interview/service";

/**
 * The production provider: a thin, explicitly-typed surface over `service.ts`.
 *
 * Every method takes `memberId` as its first argument and that value only ever
 * comes from `resolveInterviewMemberId()`. Keeping the shape uniform is what
 * makes the "no method can act for another member" property checkable by
 * reading this file alone.
 */
export const cohortInterviewProvider = {
  mode: "prisma" as const,

  getOverview(
    memberId: string,
    blueprint: InterviewBlueprintKey,
  ): Promise<ProviderResult<CohortInterviewOverview>> {
    return getCohortInterviewOverview(memberId, blueprint);
  },

  start(
    memberId: string,
    blueprint: InterviewBlueprintKey,
  ): Promise<ProviderResult<StartInterviewData>> {
    return startCohortInterview(memberId, blueprint);
  },

  resume(
    memberId: string,
    interviewId: string,
  ): Promise<ProviderResult<StartInterviewData>> {
    return resumeCohortInterview(memberId, interviewId);
  },

  answer(
    memberId: string,
    interviewId: string,
    questionId: string,
    answerText: string,
  ): Promise<ProviderResult<AnswerTurnData>> {
    return recordCohortAnswer(memberId, interviewId, questionId, answerText);
  },

  finish(
    memberId: string,
    interviewId: string,
  ): Promise<ProviderResult<FinishInterviewData>> {
    return finishCohortInterview(memberId, interviewId);
  },

  abandon(
    memberId: string,
    interviewId: string,
  ): Promise<ProviderResult<null>> {
    return abandonCohortInterview(memberId, interviewId);
  },
};

export type InterviewProvider = typeof cohortInterviewProvider;

/** Kept as a function so call sites need not change when this gains config. */
export function getInterviewProvider(): InterviewProvider {
  return cohortInterviewProvider;
}
