import "server-only";

import {
  MAX_PLATFORM_DEADLINE_DAYS,
  assessmentDraftSchema,
  createAndSendPlatformSchema,
  type AssessmentDraftInput,
  type AssessmentEndReason,
} from "@/lib/validations/assessment";
import type {
  AssessmentQuestionRow,
  ContentInput,
} from "@/features/recruiter-assessments/service";
import {
  closeAttemptsPastDeadline,
  type AttemptStore,
} from "@/features/assessment-attempts/service";

/**
 * Plan 166 — platform assessments: built by a platform admin on
 * /admin/assessments and sent to an audience (every candidate profile,
 * 60-Day Challenge domains, workshop registrants) with a deadline.
 *
 * They are RecruiterAssessment rows with source = PLATFORM and no
 * organization, so the candidate engine (assessment-attempts) runs them
 * unchanged. Every recruiter read filters on organizationId, which a platform
 * row never has.
 *
 * Callers are requireAdmin-gated server actions and admin pages. This module
 * does no authorization of its own.
 */

export type ChallengeDomain = "AI" | "DS" | "SE" | "CLAUDE";

export type PlatformAudience = {
  all: boolean;
  domains: ChallengeDomain[];
  workshopEventIds: string[];
};

export type PlatformStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export type PlatformAssessmentRow = {
  id: string;
  title: string;
  subheading: string | null;
  instructions: string | null;
  status: PlatformStatus;
  durationMinutes: number | null;
  passMarkPercent: number;
  strictMode: boolean;
  cameraRequired: boolean;
  deadlineAt: Date | null;
  audience: PlatformAudience;
  publishedAt: Date | null;
  updatedAt: Date;
  createdByLabel: string;
  questions: AssessmentQuestionRow[];
};

export type PlatformListRow = {
  id: string;
  title: string;
  status: PlatformStatus;
  deadlineAt: Date | null;
  audience: PlatformAudience;
  questionCount: number;
  sent: number;
  submitted: number;
  updatedAt: Date;
  createdByLabel: string;
};

export type PlatformAttemptRow = {
  assignmentId: string;
  candidateUserId: string;
  name: string;
  email: string;
  status: "ASSIGNED" | "STARTED" | "SUBMITTED";
  startedAt: Date | null;
  submittedAt: Date | null;
  scorePercent: number | null;
  passed: boolean | null;
  endReason: AssessmentEndReason | null;
};

export type PlatformSummary = {
  sent: number;
  started: number;
  submitted: number;
  /** Never started, and the deadline has passed. */
  missed: number;
  passed: number;
  failed: number;
};

export type AudienceOptions = {
  allCount: number;
  domains: { domain: ChallengeDomain; label: string; count: number }[];
  workshops: { eventId: string; label: string; count: number }[];
};

export type PublishInput = {
  assessmentId: string;
  actorUserId: string;
  deadlineAt: Date;
  audience: PlatformAudience;
  candidateUserIds: string[];
  at: Date;
};

export type PlatformStore = {
  create(createdByUserId: string, input: ContentInput): Promise<{ id: string }>;
  /** DRAFT-guarded. False when the row is missing or no longer a draft. */
  replaceDraftContent(
    assessmentId: string,
    input: ContentInput,
  ): Promise<boolean>;
  find(assessmentId: string): Promise<PlatformAssessmentRow | null>;
  list(): Promise<PlatformListRow[]>;
  /** DRAFT-guarded. A published assessment holds candidates' results. */
  deleteDraft(assessmentId: string): Promise<boolean>;
  /** The distinct user ids the audience covers right now (the send snapshot). */
  resolveAudience(audience: PlatformAudience): Promise<string[]>;
  /**
   * DRAFT → PUBLISHED, one assignment per user, and the audit row — one
   * transaction. `published: false` when the DRAFT guard matched nothing.
   */
  publishAndAssign(
    input: PublishInput,
  ): Promise<{ published: boolean; assigned: number }>;
  summarize(assessmentId: string, now: Date): Promise<PlatformSummary>;
  listAttempts(
    assessmentId: string,
    page: { skip: number; take: number },
  ): Promise<PlatformAttemptRow[]>;
  audienceOptions(): Promise<AudienceOptions>;
};

type Code = "NOT_FOUND" | "INVALID" | "CONFLICT";
type Result<T> =
  { ok: true; data: T } | { ok: false; code: Code; message: string };

const OK = <T>(data: T): Result<T> => ({ ok: true, data });
const FAIL = (code: Code, message: string): Result<never> => ({
  ok: false,
  code,
  message,
});

/** A deadline closer than this is refused — nobody could reasonably take it. */
export const MIN_DEADLINE_LEAD_MS = 15 * 60_000;
/** Sanity cap on one send (a snapshot bigger than this is a mistake). */
export const MAX_PLATFORM_RECIPIENTS = 50_000;

export const DOMAIN_LABELS: Record<ChallengeDomain, string> = {
  AI: "AI",
  DS: "Data Science",
  SE: "Software Engineering",
  CLAUDE: "Claude",
};

function toContent(input: AssessmentDraftInput): ContentInput {
  return {
    title: input.title,
    subheading: input.subheading ?? null,
    instructions: input.instructions ?? null,
    durationMinutes: input.durationMinutes,
    passMarkPercent: input.passMarkPercent,
    cameraRequired: input.cameraRequired,
    // Shortlist provenance is a recruiter concept; platform drafts carry none.
    shortlistRefs: [],
    questions: input.questions,
  };
}

/** Plain-language audience, e.g. "All candidates" or "AI, DS + 2 workshops". */
export function describeAudience(audience: PlatformAudience): string {
  if (audience.all) return "All candidates";
  const parts: string[] = [];
  if (audience.domains.length > 0) {
    parts.push(
      `Challenge: ${audience.domains.map((d) => DOMAIN_LABELS[d]).join(", ")}`,
    );
  }
  const w = audience.workshopEventIds.length;
  if (w > 0) parts.push(`${w} workshop${w === 1 ? "" : "s"}`);
  return parts.join(" + ") || "—";
}

export async function savePlatformDraft(
  store: PlatformStore,
  adminUserId: string,
  input: unknown,
): Promise<Result<{ id: string }>> {
  const parsed = assessmentDraftSchema.safeParse(input);
  if (!parsed.success) {
    return FAIL(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid assessment",
    );
  }
  return saveParsedDraft(store, adminUserId, parsed.data);
}

async function saveParsedDraft(
  store: PlatformStore,
  adminUserId: string,
  draft: AssessmentDraftInput,
): Promise<Result<{ id: string }>> {
  const content = toContent(draft);
  if (!draft.assessmentId) {
    return OK(await store.create(adminUserId, content));
  }
  const existing = await store.find(draft.assessmentId);
  if (!existing) return FAIL("NOT_FOUND", "Assessment not found");
  if (existing.status !== "DRAFT") {
    return FAIL(
      "CONFLICT",
      "This assessment has already been sent and can no longer be edited.",
    );
  }
  const replaced = await store.replaceDraftContent(draft.assessmentId, content);
  if (!replaced) {
    return FAIL(
      "CONFLICT",
      "This assessment has already been sent and can no longer be edited.",
    );
  }
  return OK({ id: draft.assessmentId });
}

export async function deletePlatformDraft(
  store: PlatformStore,
  assessmentId: string,
): Promise<Result<{ id: string }>> {
  const row = await store.find(assessmentId);
  if (!row) return FAIL("NOT_FOUND", "Assessment not found");
  if (row.status !== "DRAFT") {
    return FAIL(
      "CONFLICT",
      "Sent assessments can't be deleted — they hold candidates' results.",
    );
  }
  const removed = await store.deleteDraft(assessmentId);
  if (!removed)
    return FAIL("CONFLICT", "This assessment is no longer a draft.");
  return OK({ id: assessmentId });
}

export type SendOutcome =
  | { ok: true; data: { id: string; assigned: number } }
  | { ok: false; code: Code; message: string; assessmentId: string | null };

/**
 * Save the draft, then publish it and assign it to everyone the audience
 * covers at this moment (snapshot — later joiners do not receive it).
 *
 * Nothing is written until the input, the deadline and the audience have all
 * been checked. If the publish step fails after the draft was saved, the
 * draft's id comes back so the builder's retry updates it instead of creating
 * a second one.
 */
export async function createPublishAndSend(
  store: PlatformStore,
  adminUserId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<SendOutcome> {
  const parsed = createAndSendPlatformSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID",
      message: parsed.error.issues[0]?.message ?? "Invalid assessment",
      assessmentId: null,
    };
  }
  const { draft, audience } = parsed.data;
  const fail = (
    code: Code,
    message: string,
    assessmentId: string | null = null,
  ): SendOutcome => ({
    ok: false,
    code,
    message,
    assessmentId,
  });

  const deadlineAt = new Date(parsed.data.deadlineAt);
  if (deadlineAt.getTime() < now.getTime() + MIN_DEADLINE_LEAD_MS) {
    return fail("INVALID", "Set a deadline at least 15 minutes from now.");
  }
  if (
    deadlineAt.getTime() >
    now.getTime() + MAX_PLATFORM_DEADLINE_DAYS * 86_400_000
  ) {
    return fail("INVALID", "Set a deadline within the next year.");
  }
  // The pass mark is a share of auto-gradeable points — same rule as recruiters.
  const gradeable = draft.questions.some(
    (q) => q.type === "MULTIPLE_CHOICE" && q.points > 0,
  );
  if (!gradeable) {
    return fail(
      "INVALID",
      "Add at least one multiple-choice question worth points — the pass mark is measured on those.",
    );
  }

  const candidateUserIds = await store.resolveAudience(audience);
  if (candidateUserIds.length === 0) {
    return fail(
      "INVALID",
      "Nobody is in this audience yet. Pick a different group.",
    );
  }
  if (candidateUserIds.length > MAX_PLATFORM_RECIPIENTS) {
    return fail(
      "INVALID",
      `This audience has more than ${MAX_PLATFORM_RECIPIENTS.toLocaleString("en-IN")} people. Narrow it down.`,
    );
  }

  const saved = await saveParsedDraft(store, adminUserId, draft);
  if (!saved.ok) return fail(saved.code, saved.message);
  const id = saved.data.id;

  const out = await store.publishAndAssign({
    assessmentId: id,
    actorUserId: adminUserId,
    deadlineAt,
    audience,
    candidateUserIds,
    at: now,
  });
  if (!out.published) {
    return fail("CONFLICT", "This assessment has already been sent.", id);
  }
  return { ok: true, data: { id, assigned: out.assigned } };
}

export const MONITOR_PAGE_SIZE = 50;

export type PlatformMonitor = {
  assessment: PlatformAssessmentRow;
  summary: PlatformSummary;
  attempts: PlatformAttemptRow[];
  page: number;
  pageCount: number;
  /** STARTED attempts this load closed because the deadline had passed. */
  closedNow: number;
};

/**
 * The admin's view of one sent assessment. Attempts left STARTED past the
 * deadline are closed first (graded on their saved answers), so the counts and
 * scores are final once the deadline has passed.
 */
export async function getPlatformMonitor(
  store: PlatformStore,
  attempts: AttemptStore,
  assessmentId: string,
  page: number,
  now: Date = new Date(),
): Promise<Result<PlatformMonitor>> {
  const row = await store.find(assessmentId);
  if (!row) return FAIL("NOT_FOUND", "Assessment not found");

  const closedNow =
    row.status === "PUBLISHED" && row.deadlineAt && row.deadlineAt <= now
      ? await closeAttemptsPastDeadline(attempts, assessmentId, now)
      : 0;

  const summary = await store.summarize(assessmentId, now);
  const pageCount = Math.max(1, Math.ceil(summary.sent / MONITOR_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const list = await store.listAttempts(assessmentId, {
    skip: (safePage - 1) * MONITOR_PAGE_SIZE,
    take: MONITOR_PAGE_SIZE,
  });
  return OK({
    assessment: row,
    summary,
    attempts: list,
    page: safePage,
    pageCount,
    closedNow,
  });
}
