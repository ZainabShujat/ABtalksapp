import "server-only";

import type {
  AssessmentDraftInput,
  AssessmentEndReason,
  AssessmentQuestionInput,
} from "@/lib/validations/assessment";
import {
  assessmentDraftSchema,
  assignAssessmentSchema,
  createAndSendFromPresetsSchema,
  createAndSendSchema,
} from "@/lib/validations/assessment";
import {
  summarizeAttemptActivity,
  type ActivityEvent,
  type ActivitySummary,
} from "@/features/assessment-attempts/activity";
import {
  buildContentFromPresets,
  getAssessmentPreset,
} from "./presets";

export type Scope = { organizationId: string; createdByUserId: string };

export type AssessmentOptionRow = {
  id: string;
  position: number;
  body: string;
  isCorrect: boolean;
};

export type AssessmentQuestionRow = {
  id: string;
  position: number;
  type: "MULTIPLE_CHOICE" | "PARAGRAPH" | "FILE_UPLOAD";
  title: string;
  helpText: string | null;
  isRequired: boolean;
  points: number;
  allowMultipleCorrect: boolean;
  maxWords: number | null;
  uploadDestinationUrl: string | null;
  sectionId: string | null;
  options: AssessmentOptionRow[];
};

export type AssessmentRow = {
  id: string;
  organizationId: string;
  createdByUserId: string;
  title: string;
  subheading: string | null;
  instructions: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  durationMinutes: number | null;
  passMarkPercent: number;
  strictMode: boolean;
  cameraRequired: boolean;
  shortlistRefs: string[];
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  questions: AssessmentQuestionRow[];
};

/** What `store.listOwned` returns — the list row before result counts. */
export type AssessmentListStoreRow = {
  id: string;
  title: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  durationMinutes: number | null;
  passMarkPercent: number;
  questionCount: number;
  updatedAt: Date;
};

export type AssignmentStatus = "ASSIGNED" | "STARTED" | "SUBMITTED";

export type AssignableCandidate = {
  candidateRef: string;
  candidateUserId: string;
  label: string;
  jobRole: string;
};

/**
 * Which Shortlist the sendable pool is drawn from — the same scope the header
 * uses (`scopePodRows`), so the checkboxes can never list someone the recruiter
 * is not looking at.
 *
 * `projectId` set: that project's shortlisted candidates alone. Absent or null:
 * the legacy saved list, which belongs to no project. Never a union of both,
 * and never a union of projects.
 */
export type AssignablePoolScope = {
  projectId?: string | null;
};

export type AssignmentRow = {
  id: string;
  candidateUserId: string;
  candidateRef: string;
  label: string;
  status: AssignmentStatus;
  assignedAt: Date;
  startedAt: Date | null;
  submittedAt: Date | null;
  scorePercent: number | null;
  passed: boolean | null;
  /** How the attempt closed; null while open. */
  endReason: AssessmentEndReason | null;
};

/** The strict-mode limits that end an attempt: shown to the recruiter as a penalty. */
export function isPenalty(reason: AssessmentEndReason | null): boolean {
  return reason === "TAB_SWITCH_LIMIT" || reason === "FULLSCREEN_LIMIT";
}

/** Factual, one line: why an attempt closed. Null for a normal Submit / open. */
export function endReasonCopy(reason: AssessmentEndReason | null): string | null {
  switch (reason) {
    case "TAB_SWITCH_LIMIT":
      return "Auto-ended: switched tabs 3 times";
    case "FULLSCREEN_LIMIT":
      return "Auto-ended: left fullscreen 3 times";
    case "ENDED_EARLY":
      return "Candidate ended the test early";
    case "TIME_UP":
      return "Time ran out";
    case "LEFT_PAGE":
      return "Ended when the candidate left the page";
    case "DEADLINE":
      // Plan 166 — platform assessments only; recruiter ones have no deadline.
      return "Auto-submitted at the deadline";
    default:
      return null;
  }
}

export type ResultCounts = { students: number; passed: number; failed: number };

export type AssessmentListRow = AssessmentListStoreRow & {
  /** Null for DRAFT — nothing can have been assigned yet. */
  results: ResultCounts | null;
};

/** A Shortlisted candidate as the assign panel sees it — no user id. */
export type MonitorCandidate = {
  candidateRef: string;
  label: string;
  jobRole: string;
  alreadyAssigned: boolean;
};

export type AssessmentMonitor = {
  assessment: {
    id: string;
    title: string;
    status: AssessmentRow["status"];
    durationMinutes: number | null;
    passMarkPercent: number;
    questionCount: number;
    publishedAt: Date | null;
    strictMode: boolean;
    cameraRequired: boolean;
  };
  summary: {
    assigned: number;
    started: number;
    completed: number;
    passed: number;
    failed: number;
    penalties: number;
  };
  assignments: AssignmentRow[];
  candidates: MonitorCandidate[];
  activityCounts: Record<string, number>;
};

export type AssessmentNotifier = {
  assigned(input: {
    recipientUserId: string;
    assessmentId: string;
    assignmentId: string;
  }): Promise<{ ok: boolean; deduplicated: boolean }>;
};

export type ContentInput = {
  title: string;
  subheading: string | null;
  instructions: string | null;
  durationMinutes: number | null;
  passMarkPercent: number;
  cameraRequired: boolean;
  shortlistRefs: string[];
  questions: AssessmentQuestionInput[];
};

export type CreateInput = ContentInput;

export type AttemptActivityRow = {
  assignmentId: string;
  label: string; // listUserDisplayNames || refPublicId — same as the monitor
  status: AssignmentStatus;
  assignedAt: Date;
  startedAt: Date | null;
  submittedAt: Date | null;
  endReason: AssessmentEndReason | null;
  assessment: { title: string; strictMode: boolean; cameraRequired: boolean };
  questionNumbers: Record<string, number>; // question id → 1-based position
  sessions: { clientSessionId: string; firstSeenAt: Date; lastSeenAt: Date }[];
  events: ActivityEvent[]; // from activity.ts
};

export type AssessmentStore = {
  create(scope: Scope, input: CreateInput): Promise<{ id: string }>;
  replaceContent(
    assessmentId: string,
    scope: Scope,
    input: ContentInput,
  ): Promise<void>;
  findOwned(assessmentId: string, scope: Scope): Promise<AssessmentRow | null>;
  listOwned(scope: Scope): Promise<AssessmentListStoreRow[]>;
  delete(assessmentId: string, scope: Scope): Promise<boolean>;
  /** DRAFT → PUBLISHED in one guarded write. False when nothing moved. */
  publish(assessmentId: string, scope: Scope, at: Date): Promise<boolean>;
  /** The recruiter's live Shortlist for ONE scope, searchable candidates only. */
  listAssignableCandidates(
    recruiterUserId: string,
    options?: AssignablePoolScope,
  ): Promise<AssignableCandidate[]>;
  upsertAssignments(
    assessmentId: string,
    rows: { candidateUserId: string; candidateRef: string }[],
  ): Promise<{ id: string; candidateUserId: string; created: boolean }[]>;
  listAssignments(assessmentId: string, scope: Scope): Promise<AssignmentRow[]>;
  countResults(
    scope: Scope,
    assessmentIds: string[],
  ): Promise<Map<string, ResultCounts>>;
  countActivityEvents(assessmentId: string, scope: Scope): Promise<Record<string, number>>;
  findAttemptActivity(
    assessmentId: string,
    assignmentId: string,
    scope: Scope,
  ): Promise<AttemptActivityRow | null>;
};

/** T-218 builds this route. Agreed here so notifications sent before it
 *  lands point at the right place. */
export function candidateAssessmentHref(assignmentId: string): string {
  return `/assessments/${assignmentId}`;
}

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: "NOT_FOUND" | "INVALID" | "CONFLICT"; message: string };

const OK = <T>(data: T): Result<T> => ({ ok: true, data });
const NOT_FOUND = (msg: string): Result<never> => ({
  ok: false,
  code: "NOT_FOUND",
  message: msg,
});
const INVALID = (msg: string): Result<never> => ({
  ok: false,
  code: "INVALID",
  message: msg,
});
const CONFLICT = (msg: string): Result<never> => ({
  ok: false,
  code: "CONFLICT",
  message: msg,
});

function toContent(input: AssessmentDraftInput): ContentInput {
  return {
    title: input.title,
    subheading: input.subheading ?? null,
    instructions: input.instructions ?? null,
    durationMinutes: input.durationMinutes,
    passMarkPercent: input.passMarkPercent,
    cameraRequired: input.cameraRequired,
    shortlistRefs: input.shortlistRefs,
    questions: input.questions,
  };
}

export async function createAssessment(
  store: AssessmentStore,
  scope: Scope,
  input: unknown,
): Promise<Result<{ id: string }>> {
  const parsed = assessmentDraftSchema.safeParse(input);
  if (!parsed.success) {
    return INVALID(parsed.error.issues[0]?.message ?? "Invalid assessment");
  }
  const created = await store.create(scope, toContent(parsed.data));
  return OK({ id: created.id });
}

export async function saveAssessmentDraft(
  store: AssessmentStore,
  scope: Scope,
  input: unknown,
): Promise<Result<{ id: string }>> {
  const parsed = assessmentDraftSchema.safeParse(input);
  if (!parsed.success) {
    return INVALID(parsed.error.issues[0]?.message ?? "Invalid assessment");
  }
  const assessmentId = parsed.data.assessmentId;
  if (!assessmentId) {
    return INVALID("Assessment id is required to update a draft");
  }

  const existing = await store.findOwned(assessmentId, scope);
  if (!existing) return NOT_FOUND("Assessment not found");
  if (existing.status !== "DRAFT") {
    return CONFLICT(
      "This assessment has already been published and can no longer be edited.",
    );
  }

  await store.replaceContent(assessmentId, scope, toContent(parsed.data));
  return OK({ id: assessmentId });
}

export async function listAssessments(
  store: AssessmentStore,
  scope: Scope,
): Promise<Result<AssessmentListRow[]>> {
  const rows = await store.listOwned(scope);
  const counts = await store.countResults(
    scope,
    rows.filter((r) => r.status !== "DRAFT").map((r) => r.id),
  );
  return OK(
    rows.map((r) => ({
      ...r,
      results:
        r.status === "DRAFT"
          ? null
          : (counts.get(r.id) ?? { students: 0, passed: 0, failed: 0 }),
    })),
  );
}

export async function getAssessment(
  store: AssessmentStore,
  scope: Scope,
  assessmentId: string,
): Promise<Result<AssessmentRow>> {
  const row = await store.findOwned(assessmentId, scope);
  if (!row) return NOT_FOUND("Assessment not found");
  return OK(row);
}

export async function deleteAssessment(
  store: AssessmentStore,
  scope: Scope,
  assessmentId: string,
): Promise<Result<{ id: string }>> {
  const row = await store.findOwned(assessmentId, scope);
  if (!row) return NOT_FOUND("Assessment not found");
  if (row.status !== "DRAFT") {
    return CONFLICT(
      "Published assessments can't be deleted — they hold candidates' results.",
    );
  }
  const removed = await store.delete(assessmentId, scope);
  if (!removed) return NOT_FOUND("Assessment not found");
  return OK({ id: assessmentId });
}

/**
 * Copy any owned assessment (draft or published) into a new DRAFT. Only the
 * content is copied — never assignments, results, publishedAt or strictMode.
 * The copy goes through createAssessment, so it is validated like a fresh save.
 */
export async function duplicateAssessment(
  store: AssessmentStore,
  scope: Scope,
  assessmentId: string,
): Promise<Result<{ id: string }>> {
  const row = await store.findOwned(assessmentId, scope);
  if (!row) return NOT_FOUND("Assessment not found");
  return createAssessment(store, scope, {
    title: `Copy of ${row.title}`.slice(0, 200),
    subheading: row.subheading,
    instructions: row.instructions,
    durationMinutes: row.durationMinutes,
    passMarkPercent: row.passMarkPercent,
    cameraRequired: row.cameraRequired,
    shortlistRefs: row.shortlistRefs,
    questions: row.questions.map((q) => {
      const base = {
        title: q.title,
        helpText: q.helpText,
        isRequired: q.isRequired,
        points: q.points,
      };
      if (q.type === "MULTIPLE_CHOICE") {
        return {
          ...base,
          type: q.type,
          allowMultipleCorrect: q.allowMultipleCorrect,
          options: q.options.map((o) => ({ body: o.body, isCorrect: o.isCorrect })),
        };
      }
      if (q.type === "PARAGRAPH") {
        return { ...base, type: q.type, maxWords: q.maxWords ?? undefined };
      }
      return { ...base, type: q.type, uploadDestinationUrl: q.uploadDestinationUrl ?? "" };
    }),
  });
}

/**
 * DRAFT → PUBLISHED. The store sets strictMode (T-219) in the same guarded write.
 */
export async function publishAssessment(
  store: AssessmentStore,
  scope: Scope,
  assessmentId: string,
): Promise<Result<{ id: string; alreadyPublished: boolean }>> {
  const row = await store.findOwned(assessmentId, scope);
  if (!row) return NOT_FOUND("Assessment not found");
  if (row.status === "PUBLISHED") {
    return OK({ id: row.id, alreadyPublished: true });
  }
  if (row.status === "ARCHIVED") {
    return CONFLICT("This assessment is archived and can't be published.");
  }
  // The pass mark is a share of auto-gradeable points. With none, T-218 has
  // nothing to score, so the assessment could never produce a result.
  const gradeable = row.questions.some(
    (q) => q.type === "MULTIPLE_CHOICE" && q.points > 0,
  );
  if (!gradeable) {
    return INVALID(
      "Add at least one multiple-choice question worth points — the pass mark is measured on those.",
    );
  }

  const moved = await store.publish(assessmentId, scope, new Date());
  if (!moved) {
    // Lost a race with another tab or a double click: the DRAFT guard in the
    // write's WHERE matched nothing. Whoever won published it once.
    const again = await store.findOwned(assessmentId, scope);
    if (again?.status === "PUBLISHED") {
      return OK({ id: assessmentId, alreadyPublished: true });
    }
    return NOT_FOUND("Assessment not found");
  }
  return OK({ id: assessmentId, alreadyPublished: false });
}

export async function assignAssessment(
  store: AssessmentStore,
  notifier: AssessmentNotifier,
  scope: Scope,
  input: unknown,
): Promise<
  Result<{ assigned: number; alreadyAssigned: number; notificationFailures: number }>
> {
  const parsed = assignAssessmentSchema.safeParse(input);
  if (!parsed.success) {
    return INVALID(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { assessmentId } = parsed.data;

  const row = await store.findOwned(assessmentId, scope);
  if (!row) return NOT_FOUND("Assessment not found");
  if (row.status !== "PUBLISHED") {
    return CONFLICT("Publish this assessment before assigning it.");
  }

  // Refs are names, not capabilities: every one is re-resolved against the
  // recruiter's own live Shortlist, and the whole call is refused if any is
  // missing so the result message is never half true. The Shortlist is the one
  // the caller's project scope names, so a ref the checkboxes never offered is
  // refused here too — the client list is not trusted to have been narrow.
  const refs = [...new Set(parsed.data.candidateRefs)];
  const pool = await store.listAssignableCandidates(scope.createdByUserId, {
    projectId: parsed.data.projectId ?? null,
  });
  const byRef = new Map(pool.map((c) => [c.candidateRef, c]));

  const targets: { candidateUserId: string; candidateRef: string }[] = [];
  const seenUsers = new Set<string>();
  for (const ref of refs) {
    const candidate = byRef.get(ref);
    if (!candidate) {
      return INVALID(
        "Some of these candidates are no longer on your Shortlist. Refresh and try again.",
      );
    }
    if (seenUsers.has(candidate.candidateUserId)) continue;
    seenUsers.add(candidate.candidateUserId);
    targets.push({
      candidateUserId: candidate.candidateUserId,
      candidateRef: candidate.candidateRef,
    });
  }

  const rows = await store.upsertAssignments(assessmentId, targets);

  // Every row, new and existing, one at a time. The dispatch dedupe key is
  // per candidate per assessment, so an existing row that was notified is a
  // no-op and one whose first send failed gets its retry. Narrowing this to
  // created rows would lose that retry.
  let notificationFailures = 0;
  for (const r of rows) {
    try {
      const res = await notifier.assigned({
        recipientUserId: r.candidateUserId,
        assessmentId,
        assignmentId: r.id,
      });
      if (!res.ok) notificationFailures++;
    } catch {
      notificationFailures++;
    }
  }

  const assigned = rows.filter((r) => r.created).length;
  return OK({
    assigned,
    alreadyAssigned: rows.length - assigned,
    notificationFailures,
  });
}

export async function getAssessmentMonitor(
  store: AssessmentStore,
  scope: Scope,
  assessmentId: string,
  /** Whose Shortlist the assign panel offers. Omitted = the legacy saved list. */
  poolScope?: AssignablePoolScope,
): Promise<Result<AssessmentMonitor>> {
  const row = await store.findOwned(assessmentId, scope);
  if (!row) return NOT_FOUND("Assessment not found");

  const assignments = await store.listAssignments(assessmentId, scope);
  const summary = {
    assigned: assignments.length,
    started: assignments.filter((a) => a.startedAt !== null).length,
    completed: assignments.filter((a) => a.status === "SUBMITTED").length,
    passed: assignments.filter((a) => a.passed === true).length,
    failed: assignments.filter((a) => a.passed === false).length,
    penalties: assignments.filter((a) => isPenalty(a.endReason)).length,
  };

  let candidates: MonitorCandidate[] = [];
  if (row.status === "PUBLISHED") {
    const pool = await store.listAssignableCandidates(
      scope.createdByUserId,
      poolScope,
    );
    const assignedUserIds = new Set(assignments.map((a) => a.candidateUserId));
    candidates = pool.map((c) => ({
      candidateRef: c.candidateRef,
      label: c.label,
      jobRole: c.jobRole,
      alreadyAssigned: assignedUserIds.has(c.candidateUserId),
    }));
  }

  return OK({
    assessment: {
      id: row.id,
      title: row.title,
      status: row.status,
      durationMinutes: row.durationMinutes,
      passMarkPercent: row.passMarkPercent,
      questionCount: row.questions.length,
      publishedAt: row.publishedAt,
      strictMode: row.strictMode,
      cameraRequired: row.cameraRequired,
    },
    summary,
    assignments,
    candidates,
    activityCounts: row.strictMode
      ? await store.countActivityEvents(assessmentId, scope)
      : {},
  });
}

export async function getAttemptActivity(
  store: AssessmentStore,
  scope: Scope,
  assessmentId: string,
  assignmentId: string,
  now: Date,
): Promise<Result<{ row: AttemptActivityRow; summary: ActivitySummary | null }>> {
  const row = await store.findAttemptActivity(assessmentId, assignmentId, scope);
  if (!row) return NOT_FOUND("Attempt not found");
  const summary = row.assessment.strictMode
    ? summarizeAttemptActivity({
        startedAt: row.startedAt ?? row.assignedAt,
        submittedAt: row.submittedAt,
        now,
        cameraRequired: row.assessment.cameraRequired,
        sessions: row.sessions,
        events: row.events,
        questionNumbers: row.questionNumbers,
        eventCount: row.events.length,
      })
    : null;
  return OK({ row, summary });
}

// ---------------------------------------------------------------------------
// Plan 131 — the builder's Create: save, publish and send in one step.
// ---------------------------------------------------------------------------

/** A Shortlisted candidate as the builder's send step sees it — no user id. */
export type SendableCandidate = {
  candidateRef: string;
  label: string;
  jobRole: string;
};

/**
 * The recruiter's live Shortlist for ONE scope (searchable only), for the
 * builder. Pass the project the recruiter came from; with no project this is
 * the legacy saved list, exactly as the off-project header shows it.
 */
export async function listSendableCandidates(
  store: AssessmentStore,
  recruiterUserId: string,
  poolScope?: AssignablePoolScope,
): Promise<SendableCandidate[]> {
  const pool = await store.listAssignableCandidates(recruiterUserId, poolScope);
  return pool.map((c) => ({
    candidateRef: c.candidateRef,
    label: c.label,
    jobRole: c.jobRole,
  }));
}

export type CreateAndSendResult = {
  id: string;
  assigned: number;
  alreadyAssigned: number;
  notificationFailures: number;
  /** Set when the assessment went live but assigning it failed. */
  assignError: string | null;
};

type CreateAndSendOutcome =
  | { ok: true; data: CreateAndSendResult }
  | {
      ok: false;
      code: "NOT_FOUND" | "INVALID" | "CONFLICT";
      message: string;
      /** The saved draft, when one exists — the builder's retry updates it. */
      assessmentId: string | null;
    };

/**
 * Save the draft, publish it, and assign it to the Shortlisted candidates the
 * recruiter ticked — each notified once through the existing notifier.
 *
 * Three steps that are each idempotent on their own, with no transaction
 * across them, so every failure leaves a state the recruiter can finish from:
 * - invalid input or a ref off the Shortlist → nothing is written at all;
 * - save or publish fails → nothing is live; the draft's id comes back so the
 *   next click updates it instead of creating a duplicate;
 * - assign fails after publishing → the assessment is live with nobody on it;
 *   `assignError` says so and the builder hands over to the detail page.
 */
export async function createPublishAndAssign(
  store: AssessmentStore,
  notifier: AssessmentNotifier,
  scope: Scope,
  input: unknown,
): Promise<CreateAndSendOutcome> {
  const parsed = createAndSendSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID",
      message: parsed.error.issues[0]?.message ?? "Invalid assessment",
      assessmentId: null,
    };
  }
  const { draft } = parsed.data;
  const refs = [...new Set(parsed.data.candidateRefs)];
  const projectId = parsed.data.projectId ?? null;

  // Checked before anything is saved: a stale pick must not leave a live
  // assessment behind. assignAssessment re-checks against the SAME scope (the
  // Shortlist can change in between; that rare race lands in the assignError
  // branch).
  const pool = await store.listAssignableCandidates(scope.createdByUserId, {
    projectId,
  });
  const onShortlist = new Set(pool.map((c) => c.candidateRef));
  if (refs.some((ref) => !onShortlist.has(ref))) {
    return {
      ok: false,
      code: "INVALID",
      message:
        "Some of these candidates are no longer on your Shortlist. Refresh and try again.",
      assessmentId: null,
    };
  }

  const saved = draft.assessmentId
    ? await saveAssessmentDraft(store, scope, draft)
    : await createAssessment(store, scope, draft);
  if (!saved.ok) {
    return { ok: false, code: saved.code, message: saved.message, assessmentId: null };
  }
  const id = saved.data.id;

  const published = await publishAssessment(store, scope, id);
  if (!published.ok) {
    return {
      ok: false,
      code: published.code,
      message: published.message,
      assessmentId: id,
    };
  }

  const assigned = await assignAssessment(store, notifier, scope, {
    assessmentId: id,
    candidateRefs: refs,
    projectId,
  });
  if (!assigned.ok) {
    return {
      ok: true,
      data: {
        id,
        assigned: 0,
        alreadyAssigned: 0,
        notificationFailures: 0,
        assignError: assigned.message,
      },
    };
  }

  return { ok: true, data: { id, ...assigned.data, assignError: null } };
}

/**
 * Publish an ABTalks template (or a combination) and send it to the ticked
 * Shortlisted candidates. The client sends preset ids + refs only — question
 * bodies are looked up here so a recruiter cannot smuggle a draft in as a
 * "template".
 */
export async function createPublishAndAssignFromPresets(
  store: AssessmentStore,
  notifier: AssessmentNotifier,
  scope: Scope,
  input: unknown,
): Promise<CreateAndSendOutcome> {
  const parsed = createAndSendFromPresetsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID",
      message: parsed.error.issues[0]?.message ?? "Invalid input",
      assessmentId: null,
    };
  }
  if (parsed.data.presetIds.some((id) => !getAssessmentPreset(id))) {
    return {
      ok: false,
      code: "INVALID",
      message: "Template not found",
      assessmentId: null,
    };
  }
  const content = buildContentFromPresets(parsed.data.presetIds);
  if (!content) {
    return {
      ok: false,
      code: "INVALID",
      message: "Template not found",
      assessmentId: null,
    };
  }
  return createPublishAndAssign(store, notifier, scope, {
    draft: content,
    candidateRefs: parsed.data.candidateRefs,
    projectId: parsed.data.projectId ?? null,
  });
}
