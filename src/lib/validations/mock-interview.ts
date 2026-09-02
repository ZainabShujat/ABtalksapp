import { z } from "zod";
import { ASSESSMENT_REPORT_VERSION } from "@/features/interview/platform/report-assembly";

/**
 * Zod at every interview-platform boundary.
 *
 * Note what is NOT here and never will be: a plan, a runtime state, a rubric, a
 * score, a question index, a capability list, or a domain configuration. Those
 * are all server-derived, and accepting any of them from a client would let a
 * candidate choose which questions they face or what their answers are worth.
 *
 * The complete set of things a client may send:
 *   - a domain slug (validated as a slug, then re-resolved against the registry)
 *   - an attempt id (scoped to the user in the WHERE clause)
 *   - a question id (checked against the question the server has open)
 *   - answer text, and — when a workspace eventually produces them — artifacts
 */

/* ------------------------------------------------------ action boundaries */

/**
 * A domain slug as sent by a route param or a form field.
 *
 * Deliberately a pattern rather than an enum built from the registry. The
 * registry is the authority on which domains exist and which are startable, and
 * `getStartableDomain` re-checks every time; encoding the list here as well
 * would mean two places to update and a chance for them to disagree. This just
 * rejects anything that is not slug-shaped, which is what stops a path
 * traversal or an injection reaching the lookup.
 */
export const domainSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "Unknown interview.");

export const attemptIdSchema = z.object({
  attemptId: z.string().min(1).max(64),
});

export const startMockInterviewSchema = z.object({
  domainSlug: domainSlugSchema,
});

/**
 * A workspace artifact.
 *
 * Accepted by the schema but never produced in Phase 1 — no workspace exists
 * yet. It is validated now so that when one does, the boundary is already
 * bounded rather than being widened under time pressure.
 */
export const turnArtifactSchema = z.object({
  kind: z.enum(["CODE", "DIAGRAM", "FILE"]),
  mime: z.string().min(1).max(128),
  content: z.string().max(64_000),
  meta: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
});

export const submitMockAnswerSchema = z.object({
  attemptId: z.string().min(1).max(64),
  questionId: z.string().min(1).max(128),
  /**
   * The spoken transcript, or the typed emergency fallback.
   *
   * Empty is allowed: the room submits a no-response marker when a candidate
   * says nothing, and rejecting it here would leave that turn unrecordable.
   */
  answerText: z.string().max(8000),
  artifacts: z.array(turnArtifactSchema).max(8).optional(),
});

export const submitMockInterruptionSchema = z.object({
  attemptId: z.string().min(1).max(64),
  utterance: z.string().min(1).max(8000),
  interruptedText: z.string().max(8000).default(""),
  interruptedChars: z.number().int().min(0).default(0),
  speechGeneration: z.number().int().min(0).default(0),
});

export type SubmitMockInterruptionInput = z.infer<
  typeof submitMockInterruptionSchema
>;

/* -------------------------------------------------------- report document */

/**
 * The stored assessment document.
 *
 * Validated on WRITE and on READ. Both directions on purpose: the write side
 * stops a malformed document ever reaching the column, and the read side stops
 * a row written against an older shape rendering half a page after a deploy.
 *
 * Deliberately NOT reusing `interviewReportSchema`: that schema requires a
 * `milestone` block with `scopeFrom`/`scopeTo` bounded to `min(1).max(31)`,
 * which is a cohort day range. A platform report has no days, so it could never
 * satisfy it — this is the concrete blocker plan 103 identified.
 *
 * `passthrough` on the analytical sub-objects is intentional. Those shapes come
 * from `report-analysis.ts`, which the cohort owns and may extend; re-declaring
 * every field here would mean this file silently rejecting valid documents the
 * next time that module grows a property. What matters at this boundary is that
 * the document has the right SHAPE and the fields the renderer depends on.
 */
const narrativeItemSchema = z.object({
  text: z.string().max(2000),
  evidenceRefs: z.array(z.string().max(128)).max(40),
});

const improvementItemSchema = narrativeItemSchema.extend({
  suggestedSections: z.array(z.string().max(128)).max(40),
});

export const assessmentReportSchema = z.object({
  version: z.literal(ASSESSMENT_REPORT_VERSION),
  generatedAt: z.string().min(1),

  candidate: z.object({ name: z.string().max(200) }),

  coverage: z.object({
    domainSlug: domainSlugSchema,
    domainLabel: z.string().max(200),
    packId: z.string().max(128),
    packVersion: z.number().int().min(1),
    rubricId: z.string().max(128),
    sections: z
      .array(z.object({ id: z.string().max(128), label: z.string().max(200) }))
      .max(40),
    attemptNumber: z.number().int().min(1),
  }),

  overall: z.object({
    score: z.number().int().min(0).max(100),
    scoreOutOfTen: z.number().min(0).max(10),
    readiness: z.string().max(80),
    tier: z.string().max(40),
    durationSec: z.number().int().min(0).max(86_400),
    questionsAsked: z.number().int().min(0),
    questionsAnswered: z.number().int().min(0),
    followUpsAsked: z.number().int().min(0),
    escalationsEarned: z.number().int().min(0),
    redirectsIssued: z.number().int().min(0),
  }),

  sections: z
    .array(
      z
        .object({
          sectionId: z.string().max(128),
          label: z.string().max(200),
          score: z.number().int().min(0).max(100).nullable(),
        })
        .passthrough(),
    )
    .max(40),

  competencies: z
    .array(
      z
        .object({
          competencyId: z.string().max(128),
          label: z.string().max(200),
          weight: z.number().min(0).max(100),
          score: z.number().int().min(0).max(100),
          evidenceRefs: z.array(z.string().max(128)).max(80),
        })
        .passthrough(),
    )
    .max(40),

  questionAssessments: z
    .array(z.object({ questionId: z.string().max(128) }).passthrough())
    .max(100),

  skills: z
    .array(
      z
        .object({ skill: z.string().max(500), level: z.string().max(40) })
        .passthrough(),
    )
    .max(400),

  strengths: z.array(narrativeItemSchema).max(20),
  improvements: z.array(improvementItemSchema).max(20),
  expectedButNotDemonstrated: z
    .array(z.object({ skill: z.string().max(500) }).passthrough())
    .max(400),

  agentInsights: z
    .array(z.object({ label: z.string().max(200) }).passthrough())
    .max(40),
  transcriptExcerpts: z
    .array(z.object({ questionId: z.string().max(128) }).passthrough())
    .max(40),

  evidence: z
    .array(
      z
        .object({
          questionId: z.string().max(128),
          sectionId: z.string().max(128),
          answered: z.boolean(),
        })
        .passthrough(),
    )
    .max(100),

  summary: z.string().max(4000),
  recommendation: z.string().max(2000),

  assessmentStatus: z
    .object({
      status: z.enum(["NORMAL", "PARTIALLY_DEGRADED", "DEGRADED"]),
      note: z.string().max(2000),
    })
    .passthrough(),

  narrativeDegraded: z.boolean(),
});

export type ParsedAssessmentReport = z.infer<typeof assessmentReportSchema>;
