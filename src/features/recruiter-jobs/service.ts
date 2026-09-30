import type {
  JobApplicationStatus,
  JobStatus,
  JobType,
  JobWorkMode,
} from "@prisma/client";
import type { MatchCardData } from "@/components/hire/match-card";
import {
  decodeCandidateRef,
  encodeCandidateRef,
} from "@/features/hire/candidate-ref";
import { candidatePublicId } from "@/features/hire/public-id";
import {
  lifecyclePatch,
  normalizeSkills,
  type JobDraftInput,
  type LifecycleAction,
  type Result,
} from "./lifecycle";

/**
 * A minimal Prisma-shaped surface the recruiter-jobs service needs. Using an
 * interface (not `typeof prisma`) keeps the module unit-testable without a
 * live database: the tests inject an in-memory fake, production wiring
 * imports the real client.
 */
export type JobRow = {
  id: string;
  title: string;
  company: string;
  description: string;
  location: string | null;
  workMode: JobWorkMode | null;
  type: JobType;
  skills: string[];
  minExperience: number | null;
  status: JobStatus;
  isOpen: boolean;
  recruiterId: string | null;
  createdByAdminId: string | null;
  publishedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  applyExternalUrl: string | null;
};

export type JobStore = {
  create(input: {
    data: Omit<JobRow, "id" | "createdAt" | "updatedAt">;
  }): Promise<JobRow>;
  findById(id: string): Promise<JobRow | null>;
  update(id: string, patch: Partial<JobRow>): Promise<JobRow>;
  /**
   * List jobs owned by the given recruiter (User.id), newest first. Used by
   * the recruiter's own workspace view — T-226 requires that reads are scoped
   * to the caller's own userId, so this MUST filter by recruiterId and
   * MUST NOT accept "list all" without an owner.
   */
  listByRecruiter(recruiterId: string): Promise<JobRow[]>;
};

/**
 * Narrow application row the recruiter path is allowed to load. Contact
 * fields (email, phone, LinkedIn) are deliberately absent — T-257.
 */
export type ApplicantStoreRow = {
  id: string;
  userId: string;
  note: string | null;
  status: JobApplicationStatus;
  createdAt: Date;
  fullName: string | null;
};

export type ApplicationStore = {
  listByJob(jobId: string): Promise<ApplicantStoreRow[]>;
  countByJobIds(jobIds: string[]): Promise<Record<string, number>>;
  existsOnJob(jobId: string, userId: string): Promise<boolean>;
};

/** Recruiter-safe identity for the inspector card. Booleans only for links. */
export type ApplicantPublicIdentity = {
  fullName: string;
  role: string | null;
  yearsExperience: number | null;
  education: string | null;
  skills: string[];
  hasLinkedin: boolean;
  hasGithub: boolean;
  hasResume: boolean;
};

export type ServiceDeps = {
  jobs: JobStore;
  applications?: ApplicationStore;
  loadPublicIdentity?: (
    userId: string,
  ) => Promise<ApplicantPublicIdentity | null>;
  now?: () => Date;
  /**
   * T-250 fanout hook. Called AFTER a successful transition write, and only
   * when the transition was a first-time DRAFT→PUBLISHED (i.e. the row had
   * no `publishedAt` before the write). A thrown error is swallowed by the
   * caller so the publish response is not held hostage by an alerts
   * failure — dispatch is idempotent, so a retry stays safe.
   */
  onFirstPublish?: (job: JobRow) => Promise<void>;
};

/** Serializable applicant row for the recruiter's own job view. */
export type OwnedApplicantRow = {
  id: string;
  userId: string;
  candidateRef: string;
  displayName: string;
  note: string | null;
  status: JobApplicationStatus;
  appliedAt: Date;
};

const OK = <T>(data: T): Result<T> => ({ ok: true, data });
const FORBIDDEN = (msg: string): Result<never> => ({
  ok: false,
  code: "FORBIDDEN",
  message: msg,
});
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

export type CreateJobInput = JobDraftInput & { applyExternalUrl?: string | null };

export async function createRecruiterJob(
  deps: ServiceDeps,
  actor: { userId: string; isAdmin?: boolean },
  input: CreateJobInput,
): Promise<Result<{ id: string; status: JobStatus }>> {
  const title = input.title?.trim();
  const company = input.company?.trim();
  const description = input.description?.trim();
  if (!title || !company || !description) {
    return INVALID("title, company, and description are required");
  }
  const now = (deps.now ?? (() => new Date()))();
  const row = await deps.jobs.create({
    data: {
      title,
      company,
      description,
      location: input.location?.trim() || null,
      workMode: input.workMode,
      type: input.opportunityType,
      skills: normalizeSkills(input.skills),
      minExperience: input.minExperience ?? null,
      status: "DRAFT",
      isOpen: false,
      recruiterId: actor.userId,
      createdByAdminId: actor.isAdmin ? actor.userId : null,
      publishedAt: null,
      closedAt: null,
      applyExternalUrl: input.applyExternalUrl?.trim() || null,
    },
  });
  void now;
  return OK({ id: row.id, status: row.status });
}

/**
 * Owner-scoped fetch used by every mutation. Returns the row when the actor
 * owns it (or is admin); refuses with 403 otherwise. A missing row is 404 for
 * everyone — no signal about whether the id ever existed.
 */
async function loadOwned(
  deps: ServiceDeps,
  jobId: string,
  actor: { userId: string; isAdmin?: boolean },
): Promise<Result<JobRow>> {
  const row = await deps.jobs.findById(jobId);
  if (!row) return NOT_FOUND("Job not found");
  if (!actor.isAdmin && row.recruiterId !== actor.userId) {
    return FORBIDDEN("You do not own this job");
  }
  return OK(row);
}

export async function transitionJob(
  deps: ServiceDeps,
  actor: { userId: string; isAdmin?: boolean },
  jobId: string,
  action: LifecycleAction,
): Promise<Result<{ id: string; status: JobStatus; firstPublish: boolean }>> {
  const loaded = await loadOwned(deps, jobId, actor);
  if (!loaded.ok) return loaded;
  const now = (deps.now ?? (() => new Date()))();
  const patch = lifecyclePatch(loaded.data, action, now);
  if (!patch.ok) return patch;
  // First publish = the transition just stamped publishedAt for the first
  // time. Derive from the pre-image + the patch so this stays a single
  // invariant with lifecyclePatch — edit/close/reopen physically cannot
  // set firstPublish.
  const firstPublish =
    action === "publish" &&
    !loaded.data.publishedAt &&
    patch.data.publishedAt != null;
  const updated = await deps.jobs.update(jobId, patch.data);
  if (firstPublish && deps.onFirstPublish) {
    try {
      await deps.onFirstPublish(updated);
    } catch {
      // Swallowed on purpose: the row is written, dispatch is idempotent,
      // the action layer logs. See ServiceDeps.onFirstPublish doc.
    }
  }
  return OK({ id: updated.id, status: updated.status, firstPublish });
}

export type UpdateJobInput = Partial<Omit<CreateJobInput, "opportunityType">> & {
  opportunityType?: JobType;
};

export async function updateRecruiterJob(
  deps: ServiceDeps,
  actor: { userId: string; isAdmin?: boolean },
  jobId: string,
  input: UpdateJobInput,
): Promise<Result<{ id: string }>> {
  const loaded = await loadOwned(deps, jobId, actor);
  if (!loaded.ok) return loaded;
  const patch: Partial<JobRow> = {};
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.company !== undefined) patch.company = input.company.trim();
  if (input.description !== undefined) patch.description = input.description.trim();
  if (input.location !== undefined) patch.location = input.location.trim() || null;
  if (input.workMode !== undefined) patch.workMode = input.workMode;
  if (input.opportunityType !== undefined) patch.type = input.opportunityType;
  if (input.skills !== undefined) patch.skills = normalizeSkills(input.skills);
  if (input.minExperience !== undefined) {
    patch.minExperience = input.minExperience ?? null;
  }
  if (input.applyExternalUrl !== undefined) {
    patch.applyExternalUrl = input.applyExternalUrl?.trim() || null;
  }
  const updated = await deps.jobs.update(jobId, patch);
  return OK({ id: updated.id });
}

/**
 * List every job owned by the calling recruiter. T-226 rule: two recruiters
 * on the same email domain remain independent, so this filters strictly on
 * `recruiterId === actor.userId` — the caller cannot pass another user's id
 * (the workspace resolver stamps it from the session). Admins bypass the
 * owner filter and see everything, matching how the existing admin listing
 * works.
 */
export async function listRecruiterJobs(
  deps: ServiceDeps,
  actor: { userId: string; isAdmin?: boolean },
): Promise<Result<JobRow[]>> {
  if (actor.isAdmin) {
    // Admin needs all rows including those of other recruiters — but this
    // function is the recruiter-scoped read, so even admins get only their
    // own rows here. Cross-recruiter admin views should hit getJobsAdmin.
    return OK(await deps.jobs.listByRecruiter(actor.userId));
  }
  return OK(await deps.jobs.listByRecruiter(actor.userId));
}

/**
 * Single-job fetch for the recruiter's own management view — returns any
 * status (DRAFT included). Uses NOT_FOUND (not FORBIDDEN) when the row is
 * owned by another recruiter so this endpoint cannot be used to enumerate
 * another recruiter's job ids either. Admin bypasses ownership.
 */
export async function getRecruiterJob(
  deps: ServiceDeps,
  actor: { userId: string; isAdmin?: boolean },
  jobId: string,
): Promise<Result<JobRow>> {
  const row = await deps.jobs.findById(jobId);
  if (!row) return NOT_FOUND("Job not found");
  if (!actor.isAdmin && row.recruiterId !== actor.userId) {
    return NOT_FOUND("Job not found");
  }
  return OK(row);
}

/**
 * Applicants on a job the caller owns. Foreign / unknown ids return the same
 * NOT_FOUND as `getRecruiterJob` so this read cannot enumerate another
 * recruiter's applications. Display name is CandidateProfile.fullName or the
 * public AB- label — never email.
 */
export async function listApplicantsForOwnedJob(
  deps: ServiceDeps,
  actor: { userId: string; isAdmin?: boolean },
  jobId: string,
): Promise<Result<OwnedApplicantRow[]>> {
  const owned = await getRecruiterJob(deps, actor, jobId);
  if (!owned.ok) return owned;
  if (!deps.applications) return OK([]);
  const rows = await deps.applications.listByJob(jobId);
  return OK(
    rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      candidateRef: encodeCandidateRef("PROFILE", row.userId),
      displayName: row.fullName?.trim() || candidatePublicId(row.userId),
      note: row.note,
      status: row.status,
      appliedAt: row.createdAt,
    })),
  );
}

/**
 * Public inspector card for one applicant on a job the caller owns. Foreign
 * job, unknown id, or a ref that is not an applicant on this job are the same
 * NOT_FOUND — this read cannot probe another recruiter's applications or mint
 * a card from a fabricated handle. Contact URLs stay off the card.
 */
export async function loadApplicantMatchForOwnedJob(
  deps: ServiceDeps,
  actor: { userId: string; isAdmin?: boolean },
  jobId: string,
  candidateRef: string,
): Promise<Result<MatchCardData>> {
  const owned = await getRecruiterJob(deps, actor, jobId);
  if (!owned.ok) return owned;
  const parsed = decodeCandidateRef(candidateRef);
  if (!parsed || parsed.source !== "PROFILE") {
    return NOT_FOUND("Job not found");
  }
  if (!deps.applications) return NOT_FOUND("Job not found");
  const applied = await deps.applications.existsOnJob(jobId, parsed.id);
  if (!applied) return NOT_FOUND("Job not found");
  const identity = deps.loadPublicIdentity
    ? await deps.loadPublicIdentity(parsed.id)
    : null;
  return OK(toApplicantMatchCard(candidateRef, parsed.id, identity));
}

function toApplicantMatchCard(
  candidateRef: string,
  userId: string,
  identity: ApplicantPublicIdentity | null,
): MatchCardData {
  const name = identity?.fullName.trim() || candidatePublicId(userId);
  return {
    candidateRef,
    source: "PROFILE",
    programMemberId: null,
    displayName: name,
    jobRole: identity?.role?.trim() || "Candidate",
    score: 0,
    tier: "NONE",
    rationale: null,
    gaps: [],
    availabilityUnknown: true,
    openToWork: false,
    evidence: {
      skills: identity?.skills.length ? identity.skills : undefined,
      yearsExperience: identity?.yearsExperience ?? undefined,
      educationLevel: identity?.education?.trim() || null,
      githubConnected: identity?.hasGithub ?? false,
      linkedinConnected: identity?.hasLinkedin ?? false,
    },
  };
}

/** Counts for job ids the caller already listed as their own — one grouped query. */
export async function countApplicantsByJobIds(
  deps: ServiceDeps,
  jobIds: string[],
): Promise<Record<string, number>> {
  if (!deps.applications || jobIds.length === 0) return {};
  return deps.applications.countByJobIds(jobIds);
}

/**
 * Candidate-facing lookup. DRAFT jobs are 404 (never 403) so recruiters cannot
 * leak the existence of a draft opening via id enumeration. CLOSED jobs stay
 * visible so applicants who followed a stale link see the closed message.
 */
export async function getJobForCandidate(
  deps: ServiceDeps,
  jobId: string,
): Promise<Result<JobRow>> {
  const row = await deps.jobs.findById(jobId);
  if (!row) return NOT_FOUND("Job not found");
  if (row.status === "DRAFT") return NOT_FOUND("Job not found");
  return OK(row);
}

export const CLOSED_JOB_MESSAGE =
  "This position is closed and no longer accepting applications";

/**
 * Enforces the closed-job guard on apply. Returns the guard result — the
 * caller performs the actual application write so this stays free of side
 * effects and easy to test.
 */
export async function assertApplyAllowed(
  deps: ServiceDeps,
  jobId: string,
): Promise<Result<JobRow>> {
  const visible = await getJobForCandidate(deps, jobId);
  if (!visible.ok) return visible;
  if (visible.data.status === "CLOSED") {
    return {
      ok: false,
      code: "CONFLICT",
      message: CLOSED_JOB_MESSAGE,
    };
  }
  if (visible.data.status !== "PUBLISHED") {
    return { ok: false, code: "CONFLICT", message: "This role is not open." };
  }
  return OK(visible.data);
}
