import { z } from "zod";
import { INTERVIEW_BLUEPRINTS } from "@/features/interview/cohort/blueprint";

/**
 * Boundary schemas for the AI Cohort interview's Server Actions.
 *
 * Note what is NOT here and never will be: blueprint scope, question index,
 * evidence, scores, eligibility, duration. Those are server-derived. A schema
 * that accepted them would be a schema that let a client set them.
 */

/** The blueprint enum, as sent by a route param or a form field. */
export const interviewBlueprintSchema = z.enum(INTERVIEW_BLUEPRINTS);

export const startInterviewSchema = z.object({
  blueprint: interviewBlueprintSchema,
});

export const interviewIdSchema = z.object({
  interviewId: z.string().min(1).max(64),
});

export const submitInterviewAnswerSchema = z.object({
  interviewId: z.string().min(1).max(64),
  /**
   * Which question the CLIENT believes it is answering. Checked against the
   * question the server has open; a mismatch is rejected rather than accepted,
   * so this cannot be used to redirect an answer onto a different question.
   */
  questionId: z.string().min(1).max(64),
  answerText: z.string().trim().max(8000),
});

export type StartInterviewInput = z.infer<typeof startInterviewSchema>;
export type SubmitInterviewAnswerInput = z.infer<
  typeof submitInterviewAnswerSchema
>;
