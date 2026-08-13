import { z } from "zod";

/** Boundary schemas for the General Interviewer Agent's Server Actions. */

export const interviewIdSchema = z.object({
  interviewId: z.string().min(1).max(64),
});

export const submitInterviewAnswerSchema = z.object({
  interviewId: z.string().min(1).max(64),
  questionId: z.string().min(1).max(32),
  answerText: z.string().trim().max(8000),
});

export type SubmitInterviewAnswerInput = z.infer<
  typeof submitInterviewAnswerSchema
>;
