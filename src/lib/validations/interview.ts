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

/* -------------------------------------------------------------- the report */

/**
 * The persisted report document.
 *
 * Validated on WRITE and on READ. Reading is not paranoia: `InterviewReport.report`
 * is a JSON column, so the only thing standing between a schema change and a
 * page crashing on a two-month-old row is this parse. A row that fails is
 * surfaced as "report unavailable", never as a half-rendered report.
 */

const narrativeItemSchema = z.object({
  text: z.string().min(1).max(600),
  evidenceRefs: z.array(z.string().min(1).max(64)).min(1).max(12),
});

const improvementItemSchema = narrativeItemSchema.extend({
  suggestedDays: z.array(z.number().int().min(1).max(31)).max(31),
});

const tierSchema = z.enum(["NONE", "CLAIMED", "EXPLAINED", "DEMONSTRATED"]);
const scoreSchema = z.number().int().min(0).max(100);

export const interviewReportSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),

  candidate: z.object({
    name: z.string().max(200),
    cohort: z.string().max(200),
    jobRole: z.string().max(200),
    company: z.string().max(200),
  }),

  milestone: z.object({
    blueprint: interviewBlueprintSchema,
    label: z.string().max(200),
    scopeFrom: z.number().int().min(1).max(31),
    scopeTo: z.number().int().min(1).max(31),
    progressDay: z.number().int().min(0).max(31).nullable(),
    bankVersion: z.string().max(40),
  }),

  overall: z.object({
    score: scoreSchema,
    tier: tierSchema,
    durationSec: z.number().int().min(0),
    questionsAsked: z.number().int().min(0),
    questionsAnswered: z.number().int().min(0),
    followUpsAsked: z.number().int().min(0),
    escalationsEarned: z.number().int().min(0),
    redirectsIssued: z.number().int().min(0),
  }),

  modules: z.array(
    z.object({
      moduleNumber: z.number().int().min(1).max(8),
      title: z.string().max(200),
      subtitle: z.string().max(300),
      dayRange: z.object({
        from: z.number().int().min(1).max(31),
        to: z.number().int().min(1).max(31),
      }),
      // Null is a first-class value: "not assessed" is not a zero.
      score: scoreSchema.nullable(),
      tier: tierSchema.nullable(),
      questionsAsked: z.number().int().min(0),
      questionsAnswered: z.number().int().min(0),
      evidenceRefs: z.array(z.string().max(64)).max(40),
      note: z.string().max(300),
    }),
  ),

  competencies: z.array(
    z.object({
      competency: z.enum([
        "CONCEPTUAL",
        "PRACTICAL",
        "PROBLEM_SOLVING",
        "TECHNICAL_DEPTH",
        "COMMUNICATION",
      ]),
      label: z.string().max(120),
      weight: z.number().int().min(0).max(100),
      score: scoreSchema,
      tier: tierSchema,
      evidenceRefs: z.array(z.string().max(64)).max(40),
      justification: z.string().max(400),
    }),
  ),

  strengths: z.array(narrativeItemSchema).max(8),
  improvements: z.array(improvementItemSchema).max(8),

  skills: z.object({
    demonstrated: z.array(z.string().max(300)).max(80),
    partial: z.array(z.string().max(300)).max(80),
    notShown: z.array(z.string().max(300)).max(80),
  }),

  beyondMilestone: z.array(
    z.object({
      questionId: z.string().max(64),
      sourceDays: z.array(z.number().int().min(1).max(31)).max(10),
      question: z.string().max(1000),
      answerExcerpt: z.string().max(600),
      matched: z.array(z.string().max(300)).max(20),
      note: z.string().max(300),
    }),
  ),

  evidence: z.array(
    z.object({
      questionId: z.string().max(64),
      tier: z.enum(["CORE", "EXTENSION"]),
      question: z.string().max(1000),
      mode: z.string().max(40),
      competency: z.string().max(40),
      moduleNumber: z.number().int().min(1).max(8).nullable(),
      sourceDays: z.array(z.number().int().min(1).max(31)).max(10),
      answerExcerpt: z.string().max(600),
      matched: z.array(z.string().max(300)).max(20),
      missing: z.array(z.string().max(300)).max(20),
      score: scoreSchema,
      depthReached: z.number().int().min(1).max(3),
      answered: z.boolean(),
    }),
  ),

  summary: z.string().max(2000),
  recommendation: z.string().max(1000),
  narrativeDegraded: z.boolean(),
});

export type InterviewReportInput = z.infer<typeof interviewReportSchema>;
