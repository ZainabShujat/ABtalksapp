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
 * The persisted report document (version 2).
 *
 * Validated on WRITE and on READ. Reading is not paranoia: `InterviewReport.report`
 * is a JSON column, so the only thing between a schema change and a page
 * crashing on a two-month-old row is this parse. A row that fails is surfaced
 * as "report unavailable", never as a half-rendered report.
 */

const scoreSchema = z.number().int().min(0).max(100);
const tenSchema = z.number().min(0).max(10);
const tierSchema = z.enum(["NONE", "CLAIMED", "EXPLAINED", "DEMONSTRATED"]);
const refs = z.array(z.string().max(64)).max(40);
const items = z.array(z.string().max(400)).max(60);

const narrativeItemSchema = z.object({
  text: z.string().min(1).max(600),
  evidenceRefs: z.array(z.string().min(1).max(64)).min(1).max(12),
});

const improvementItemSchema = narrativeItemSchema.extend({
  suggestedDays: z.array(z.number().int().min(1).max(31)).max(31),
});

const skillSchema = z.object({
  skill: z.string().max(400),
  level: z.enum([
    "STRONG",
    "DEVELOPING",
    "WEAK",
    "NOT_DEMONSTRATED",
    "NOT_ASSESSED",
  ]),
  evidenceRefs: refs,
  note: z.string().max(300),
});

const probeSchema = z.object({
  level: z.number().int().min(1).max(5),
  mode: z.string().max(40),
  question: z.string().max(1000),
  answerExcerpt: z.string().max(600),
  expected: items,
  demonstrated: items,
  missing: items,
  cleared: z.boolean(),
  outcome: z.string().max(600),
});

const questionAssessmentSchema = z.object({
  questionId: z.string().max(64),
  order: z.number().int().min(1).max(60),
  question: z.string().max(1000),
  askedAs: z.string().max(1400),
  mode: z.string().max(40),
  competency: z.string().max(40),
  moduleNumber: z.number().int().min(1).max(8).nullable(),
  moduleTitle: z.string().max(200).nullable(),
  sourceDays: z.array(z.number().int().min(1).max(31)).max(10),
  skillsTested: items,
  score: scoreSchema,
  scoreOutOfTen: tenSchema,
  answered: z.boolean(),
  expected: items,
  demonstrated: items,
  partiallyDemonstrated: items,
  missing: items,
  answerExcerpt: z.string().max(600),
  whyThisScore: z.string().max(1200),
  probes: z.array(probeSchema).max(4),
  followUpCount: z.number().int().min(0).max(20),
  depthReached: z.number().int().min(1).max(5),
  judged: z.boolean(),
  strength: z.enum([
    "STRONG",
    "PARTIAL",
    "WEAK",
    "OFF_TOPIC",
    "UNANSWERED",
    "NOT_JUDGED",
  ]),
});

export const interviewReportSchema = z.object({
  version: z.literal(2),
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
    scoreOutOfTen: tenSchema,
    readiness: z.enum([
      "Strong",
      "Promising",
      "Developing",
      "Needs significant improvement",
    ]),
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
      // Null is a first-class value: "not assessed" is never a zero.
      score: scoreSchema.nullable(),
      scoreOutOfTen: tenSchema.nullable(),
      assessed: z.boolean(),
      questionsAsked: z.number().int().min(0),
      questionsAnswered: z.number().int().min(0),
      competencies: z.array(z.string().max(40)).max(10),
      evidenceRefs: refs,
      strengths: items,
      weaknesses: z.array(z.string().max(1000)).max(20),
      missingSkills: items,
      note: z.string().max(300),
    }),
  ),

  competencies: z.array(
    z.object({
      competency: z.string().max(40),
      label: z.string().max(120),
      weight: z.number().int().min(0).max(100),
      score: scoreSchema,
      scoreOutOfTen: tenSchema,
      tier: z.string().max(40),
      evidenceRefs: refs,
      justification: z.string().max(400),
      strengths: items,
      weaknesses: z.array(z.string().max(1000)).max(20),
      missingEvidence: items,
    }),
  ),

  questionAssessments: z.array(questionAssessmentSchema).max(40),
  skills: z.array(skillSchema).max(120),
  strengths: z.array(narrativeItemSchema).max(8),
  improvements: z.array(improvementItemSchema).max(8),
  expectedButNotDemonstrated: z.array(skillSchema).max(120),

  agentInsights: z
    .array(
      z.object({
        label: z.string().max(120),
        detail: z.string().max(1000),
        evidenceRefs: refs,
      }),
    )
    .max(12),

  transcriptExcerpts: z
    .array(
      z.object({
        questionId: z.string().max(64),
        reason: z.string().max(120),
        question: z.string().max(1000),
        answer: z.string().max(600),
      }),
    )
    .max(8),

  beyondMilestone: z.array(
    z.object({
      questionId: z.string().max(64),
      sourceDays: z.array(z.number().int().min(1).max(31)).max(10),
      question: z.string().max(1000),
      answerExcerpt: z.string().max(600),
      matched: items,
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
      matched: items,
      missing: items,
      score: scoreSchema,
      depthReached: z.number().int().min(1).max(5),
      answered: z.boolean(),
    }),
  ),

  summary: z.string().max(2000),
  recommendation: z.string().max(1000),

  assessmentStatus: z.object({
    status: z.enum(["NORMAL", "PARTIALLY_DEGRADED", "DEGRADED"]),
    degradedTurns: z.number().int().min(0),
    totalTurns: z.number().int().min(0),
    unjudgedQuestions: z.number().int().min(0),
    answeredQuestions: z.number().int().min(0),
    narrativeDegraded: z.boolean(),
    note: z.string().max(600),
  }),

  narrativeDegraded: z.boolean(),
});

export type InterviewReportInput = z.infer<typeof interviewReportSchema>;
