import { z } from "zod";
import type { AssessmentAttemptEventType } from "@prisma/client"; // type-only: erased from the client bundle

export const MAX_PARAGRAPH_WORDS = 250;

const optionSchema = z.object({
  body: z.string().trim().min(1, "Give this option a name").max(300),
  isCorrect: z.boolean().default(false),
});

const baseQuestion = z.object({
  title: z.string().trim().min(1, "Write the question").max(2000),
  helpText: z.string().trim().max(1000).optional().nullable(),
  isRequired: z.boolean().default(true),
  points: z.number().int().min(0).max(100).default(1),
});

const mcqSchema = baseQuestion
  .extend({
    type: z.literal("MULTIPLE_CHOICE"),
    allowMultipleCorrect: z.boolean().default(false),
    options: z.array(optionSchema).min(2, "Add at least two options").max(12),
  })
  .strict();

const paragraphSchema = baseQuestion
  .extend({
    type: z.literal("PARAGRAPH"),
    maxWords: z.number().int().min(10).max(1000).default(MAX_PARAGRAPH_WORDS),
  })
  .strict();

const fileUploadSchema = baseQuestion
  .extend({
    type: z.literal("FILE_UPLOAD"),
    uploadDestinationUrl: z
      .string()
      .trim()
      .url("Enter the full link where the file should be uploaded"),
  })
  .strict();

export const assessmentQuestionSchema = z.discriminatedUnion("type", [
  mcqSchema,
  paragraphSchema,
  fileUploadSchema,
]);

export const assessmentDraftSchema = z
  .object({
    assessmentId: z.string().min(1).optional(), // present = update
    title: z.string().trim().min(1, "Give the assessment a title").max(200),
    subheading: z.string().trim().max(300).optional().nullable(),
    instructions: z.string().trim().max(5000).optional().nullable(),
    durationMinutes: z.number().int().min(1).max(480).nullable().default(null),
    passMarkPercent: z.number().int().min(0).max(100).default(60),
    cameraRequired: z.boolean().default(false),
    shortlistRefs: z.array(z.string().max(64)).max(500).default([]),
    questions: z
      .array(assessmentQuestionSchema)
      .min(1, "Add at least one question")
      .max(100),
  })
  .superRefine((draft, ctx) => {
    draft.questions.forEach((q, qi) => {
      if (q.type !== "MULTIPLE_CHOICE") return;
      const correctCount = q.options.filter((o) => o.isCorrect).length;
      if (correctCount < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Mark at least one option as correct",
          path: ["questions", qi, "options"],
        });
      }
      if (!q.allowMultipleCorrect && correctCount !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Pick exactly one correct option",
          path: ["questions", qi, "options"],
        });
      }
    });
  });

export type AssessmentDraftInput = z.infer<typeof assessmentDraftSchema>;
export type AssessmentQuestionInput = z.infer<typeof assessmentQuestionSchema>;

/** One assign call notifies at most this many people (sequential sends). */
export const MAX_ASSIGN_PER_CALL = 25;

export const publishAssessmentSchema = z.object({
  assessmentId: z.string().min(1),
});

/**
 * Which project's Shortlist the refs were picked from (plan 133 D-4).
 *
 * Absent or null means off-project, which is the legacy saved list — the same
 * thing the header shows there. It only ever narrows the pool: a project the
 * sender does not own resolves to nothing, so it cannot be used to reach
 * another recruiter's shortlist.
 */
const shortlistProjectId = z.string().trim().min(1).max(64).nullish();

export const assignAssessmentSchema = z.object({
  assessmentId: z.string().min(1),
  projectId: shortlistProjectId,
  candidateRefs: z
    .array(z.string().trim().min(3).max(200))
    .min(1, "Pick at least one candidate")
    .max(
      MAX_ASSIGN_PER_CALL,
      `Assign at most ${MAX_ASSIGN_PER_CALL} candidates at a time`,
    ),
});

export type AssignAssessmentInput = z.infer<typeof assignAssessmentSchema>;

/** Plan 131 — the builder's Create: save, publish and send in one step. */
export const createAndSendSchema = z.object({
  draft: assessmentDraftSchema,
  projectId: shortlistProjectId,
  candidateRefs: assignAssessmentSchema.shape.candidateRefs,
});

export type CreateAndSendInput = z.infer<typeof createAndSendSchema>;

/** Direct publish from templates: preset ids + refs only, no client draft. */
export const createAndSendFromPresetsSchema = z.object({
  presetIds: z.array(z.string().min(1)).min(1, "Select at least one template"),
  projectId: shortlistProjectId,
  candidateRefs: assignAssessmentSchema.shape.candidateRefs,
});

export type CreateAndSendFromPresetsInput = z.infer<
  typeof createAndSendFromPresetsSchema
>;

// ---------------------------------------------------------------------------
// Plan 166 — platform (admin-authored) assessments.
// ---------------------------------------------------------------------------

export const PLATFORM_AUDIENCE_DOMAINS = ["AI", "DS", "SE", "CLAUDE"] as const;

/** Who a platform assessment goes to. `all` = every candidate profile. */
export const platformAudienceSchema = z
  .object({
    all: z.boolean().default(false),
    domains: z.array(z.enum(PLATFORM_AUDIENCE_DOMAINS)).max(4).default([]),
    workshopEventIds: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  })
  .refine((a) => a.all || a.domains.length > 0 || a.workshopEventIds.length > 0, {
    message: "Pick who this assessment goes to",
  });

export type PlatformAudienceInput = z.infer<typeof platformAudienceSchema>;

/** Latest a deadline may be set, from now. */
export const MAX_PLATFORM_DEADLINE_DAYS = 365;

export const createAndSendPlatformSchema = z.object({
  draft: assessmentDraftSchema,
  audience: platformAudienceSchema,
  /** ISO timestamp. Checked against the server clock in the service. */
  deadlineAt: z.string().datetime({ offset: true, message: "Set a deadline" }),
});

export type CreateAndSendPlatformInput = z.infer<typeof createAndSendPlatformSchema>;

// ---------------------------------------------------------------------------
// T-218 (plan 129) — candidate answers. Shared by the candidate screen and the
// server so the two can never disagree about what counts as an answer.
// ---------------------------------------------------------------------------

/** Longest paragraph answer stored, in characters. The word cap is per question
 *  and is enforced at submit, so nothing a candidate types is ever refused. */
export const MAX_ANSWER_CHARS = 20_000;
export const MAX_ANSWER_URL_CHARS = 2_000;

/** One definition, so the screen's counter and the server's cap agree. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** http(s) only. Zod 4's .url() also accepts javascript: and data: URLs. */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export const answerPayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("choice"),
      selectedOptionIds: z.array(z.string().min(1).max(64)).max(12),
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      // NOT trimmed: the answer is restored exactly as it was typed.
      text: z.string().max(MAX_ANSWER_CHARS),
    })
    .strict(),
  z
    .object({
      kind: z.literal("file"),
      fileUrl: z.union([
        z.literal(""),
        z
          .string()
          .trim()
          .max(MAX_ANSWER_URL_CHARS)
          .refine(isHttpUrl, "Paste a full link starting with https://"),
      ]),
    })
    .strict(),
]);
export type AnswerPayload = z.infer<typeof answerPayloadSchema>;

export const attemptActionSchema = z.object({
  assignmentId: z.string().min(1).max(64),
});

/** How an attempt closed. Mirrors the Prisma enum AssessmentEndReason. */
export const ASSESSMENT_END_REASONS = [
  "SUBMITTED",
  "ENDED_EARLY",
  "TIME_UP",
  "TAB_SWITCH_LIMIT",
  "FULLSCREEN_LIMIT",
  "LEFT_PAGE",
  "DEADLINE",
] as const;
export type AssessmentEndReason = (typeof ASSESSMENT_END_REASONS)[number];

/** Strict mode: this many tab switches, or fullscreen exits, ends the attempt. */
export const STRIKE_LIMIT = 3;

/** The reasons a candidate's own screen may close an attempt with. */
export const endAttemptSchema = attemptActionSchema.extend({
  reason: z.enum(["ENDED_EARLY", "TAB_SWITCH_LIMIT", "FULLSCREEN_LIMIT"]),
});

export const saveAnswerSchema = attemptActionSchema.extend({
  questionId: z.string().min(1).max(64),
  answer: answerPayloadSchema,
});

/** Whether an answer satisfies a required question. Shared by the screen's
 *  "N required left" hint and the server's submit check. */
export function isAnswerComplete(
  type: "MULTIPLE_CHOICE" | "PARAGRAPH" | "FILE_UPLOAD",
  answer: AnswerPayload | undefined,
): boolean {
  if (!answer) return false;
  if (type === "MULTIPLE_CHOICE") {
    return answer.kind === "choice" && answer.selectedOptionIds.length > 0;
  }
  if (type === "PARAGRAPH") {
    return answer.kind === "text" && answer.text.trim().length > 0;
  }
  return answer.kind === "file" && isHttpUrl(answer.fileUrl);
}

/** The refusal copy for an incomplete submission. The server returns it and the
 *  screen shows it before the click, in the same words. */
export function incompleteMessage(
  missingRequired: number,
  overLimit: number,
): string {
  const q = `${missingRequired} required question${missingRequired === 1 ? "" : "s"}`;
  const a = `${overLimit} answer${overLimit === 1 ? "" : "s"}`;
  if (missingRequired > 0 && overLimit > 0) {
    return `Answer the ${q} left and shorten ${a} over the word limit before submitting.`;
  }
  if (missingRequired > 0) return `Answer the ${q} left before submitting.`;
  return `Shorten ${a} over the word limit before submitting.`;
}

/** T-219 — everything a strict attempt's page may report. Mirrors the Prisma
 *  enum; assessment-attempts.test.ts asserts the two lists are equal. */
export const ATTEMPT_EVENT_TYPES = [
  "SESSION_STARTED",
  "PAGE_LEFT",
  "FULLSCREEN_ENTERED",
  "FULLSCREEN_EXITED",
  "VISIBILITY_HIDDEN",
  "VISIBILITY_VISIBLE",
  "WINDOW_BLURRED",
  "WINDOW_FOCUSED",
  "COPY_BLOCKED",
  "CUT_BLOCKED",
  "PASTE_BLOCKED",
  "DROP_BLOCKED",
  "LINK_PASTED",
  "UPLOAD_LINK_OPENED",
  "CAMERA_ON",
  "CAMERA_OFF",
] as const satisfies readonly AssessmentAttemptEventType[];
export type AttemptEventType = (typeof ATTEMPT_EVENT_TYPES)[number];

export const CLIPBOARD_EVENT_TYPES = [
  "COPY_BLOCKED",
  "CUT_BLOCKED",
  "PASTE_BLOCKED",
  "DROP_BLOCKED",
] as const satisfies readonly AttemptEventType[];
/** Require a FILE_UPLOAD questionId of the same assessment. */
export const FILE_LINK_EVENT_TYPES = [
  "LINK_PASTED",
  "UPLOAD_LINK_OPENED",
] as const satisfies readonly AttemptEventType[];
export const CAMERA_EVENT_TYPES = [
  "CAMERA_ON",
  "CAMERA_OFF",
] as const satisfies readonly AttemptEventType[];

export const MAX_EVENTS_PER_BATCH = 50;
export const MAX_EVENTS_PER_ATTEMPT = 1_000;
export const MAX_SESSIONS_PER_ATTEMPT = 50;
export const MAX_EVENT_BODY_BYTES = 64_000;

export const attemptEventSchema = z
  .object({
    seq: z.number().int().min(0).max(1_000_000),
    type: z.enum(ATTEMPT_EVENT_TYPES),
    /** Epoch ms, the device clock at the moment it happened. */
    occurredAt: z.number().int().positive(),
    questionId: z.string().min(1).max(64).optional(),
    count: z.number().int().min(1).max(1_000).optional(),
  })
  .strict();

export const attemptEventBatchSchema = z
  .object({
    sessionId: z.string().uuid(),
    /** Epoch ms, the device clock when THIS transmission was made (re-stamped on retry). */
    sentAt: z.number().int().positive(),
    events: z.array(attemptEventSchema).max(MAX_EVENTS_PER_BATCH),
  })
  .strict();
export type AttemptEventBatch = z.infer<typeof attemptEventBatchSchema>;

