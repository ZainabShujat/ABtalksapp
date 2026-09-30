"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { JobType, JobWorkMode } from "@prisma/client";
import { requireRecruiterWorkspace } from "@/features/recruiter-workspace/workspace";
import { logger } from "@/lib/logger";
import {
  createRecruiterJob,
  getRecruiterJob,
  listApplicantsForOwnedJob,
  listRecruiterJobs,
  loadApplicantMatchForOwnedJob,
  transitionJob,
  updateRecruiterJob,
  type CreateJobInput,
  type JobRow,
  type OwnedApplicantRow,
  type UpdateJobInput,
} from "@/features/recruiter-jobs/service";
import {
  prismaApplicantStore,
  prismaJobStore,
  prismaLoadPublicIdentity,
} from "@/features/recruiter-jobs/prisma-store";
import type { MatchCardData } from "@/components/hire/match-card";
import type { LifecycleAction } from "@/features/recruiter-jobs/lifecycle";
import { prismaJobAlertStore } from "@/features/job-alerts/prisma-store";
import { fanoutOnJobPublished } from "@/features/job-alerts/service";
import { dispatch as dispatchNotification } from "@/features/notification/notification-service";
import { decodeCandidateRef } from "@/features/hire/candidate-ref";
import { notifyProfileViewed } from "@/features/profile-view-notification/service";
import { prismaProfileViewStore } from "@/features/profile-view-notification/store";

type ActionOk<T = undefined> = T extends undefined
  ? { ok: true }
  : { ok: true; data: T };
type ActionErr = { ok: false; message: string; status?: number };

const workModeSchema = z.nativeEnum(JobWorkMode);
const opportunityTypeSchema = z.nativeEnum(JobType);

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(20000),
  location: z.string().max(200).optional().default(""),
  workMode: workModeSchema,
  opportunityType: opportunityTypeSchema,
  skills: z.array(z.string().max(60)).max(25).optional().default([]),
  // Same bounds as `jobSpecSchema.minExperience`, which the scout search
  // already uses, so the two sides of the product agree on what a plausible
  // number of years is. Nullable rather than defaulted: "not stated" and
  // "none needed" are different answers and the card renders them the same
  // way only by coincidence.
  minExperience: z.number().int().min(0).max(50).nullable().optional(),
  applyExternalUrl: z
    .union([z.literal(""), z.string().url()])
    .optional()
    .default(""),
});

const updateSchema = createSchema
  .partial()
  .extend({ jobId: z.string().min(1) });

const transitionSchema = z.object({
  jobId: z.string().min(1),
});

function revalidateJobViews(jobId?: string) {
  revalidatePath("/jobs");
  revalidatePath("/hire/jobs");
  if (jobId) {
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/hire/jobs/${jobId}`);
  }
}

export async function createRecruiterJobAction(
  input: unknown,
): Promise<ActionOk<{ id: string }> | ActionErr> {
  const workspace = await requireRecruiterWorkspace();
  if (!workspace.ok) return { ok: false, message: workspace.message, status: 403 };

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Invalid input" };
  }

  try {
    // T-226: stamp the job with the recruiter's own registered company so a
    // recruiter cannot post under a different brand than their approved
    // workspace. The service still records recruiterId as the owner.
    const payload: CreateJobInput = {
      title: parsed.data.title,
      company: workspace.data.company,
      description: parsed.data.description,
      location: parsed.data.location,
      workMode: parsed.data.workMode,
      opportunityType: parsed.data.opportunityType,
      skills: parsed.data.skills,
      minExperience: parsed.data.minExperience ?? null,
      applyExternalUrl: parsed.data.applyExternalUrl,
    };
    const result = await createRecruiterJob(
      { jobs: prismaJobStore() },
      { userId: workspace.data.userId },
      payload,
    );
    if (!result.ok) return { ok: false, message: result.message };
    revalidateJobViews();
    return { ok: true, data: { id: result.data.id } };
  } catch (error) {
    logger.error("[recruiter-job-actions] create", { error: String(error) });
    return { ok: false, message: "Failed to create job" };
  }
}

export async function updateRecruiterJobAction(
  input: unknown,
): Promise<ActionOk | ActionErr> {
  const workspace = await requireRecruiterWorkspace();
  if (!workspace.ok) return { ok: false, message: workspace.message, status: 403 };

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Invalid input" };
  }
  const { jobId, ...rest } = parsed.data;

  try {
    const payload: UpdateJobInput = rest;
    const result = await updateRecruiterJob(
      { jobs: prismaJobStore() },
      { userId: workspace.data.userId },
      jobId,
      payload,
    );
    if (!result.ok) {
      const status =
        result.code === "FORBIDDEN"
          ? 403
          : result.code === "NOT_FOUND"
            ? 404
            : undefined;
      return { ok: false, message: result.message, status };
    }
    revalidateJobViews(jobId);
    return { ok: true };
  } catch (error) {
    logger.error("[recruiter-job-actions] update", { error: String(error) });
    return { ok: false, message: "Failed to update job" };
  }
}

async function runTransition(
  input: unknown,
  action: LifecycleAction,
): Promise<ActionOk<{ id: string; status: string }> | ActionErr> {
  const workspace = await requireRecruiterWorkspace();
  if (!workspace.ok) return { ok: false, message: workspace.message, status: 403 };

  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  try {
    // T-250: on the first-time DRAFT→PUBLISHED transition, transitionJob
    // invokes this hook with the freshly-updated row. Fanout is idempotent
    // via UserNotification.dedupeKey, so a stray retry cannot double-send.
    const alertStore = prismaJobAlertStore();
    const result = await transitionJob(
      {
        jobs: prismaJobStore(),
        onFirstPublish: async (job) => {
          const summary = await fanoutOnJobPublished(
            { alerts: alertStore, dispatch: dispatchNotification },
            job,
          );
          logger.info("[job-alerts] fanout", {
            jobId: job.id,
            matched: summary.matched,
            sent: summary.sent,
            deduplicated: summary.deduplicated,
            failed: summary.failed.length,
          });
        },
      },
      { userId: workspace.data.userId },
      parsed.data.jobId,
      action,
    );
    if (!result.ok) {
      const status =
        result.code === "FORBIDDEN"
          ? 403
          : result.code === "NOT_FOUND"
            ? 404
            : undefined;
      return { ok: false, message: result.message, status };
    }
    revalidateJobViews(parsed.data.jobId);
    return { ok: true, data: result.data };
  } catch (error) {
    logger.error("[recruiter-job-actions] transition", {
      action,
      error: String(error),
    });
    return { ok: false, message: `Failed to ${action} job` };
  }
}

export async function publishRecruiterJobAction(input: unknown) {
  return runTransition(input, "publish");
}

export async function closeRecruiterJobAction(input: unknown) {
  return runTransition(input, "close");
}

export async function reopenRecruiterJobAction(input: unknown) {
  return runTransition(input, "reopen");
}

/**
 * Workspace-scoped list. Callers never pass a userId — the workspace resolves
 * the caller from the session and the service filters by that id. Same-domain
 * independence (T-226) is therefore an argument the caller cannot get wrong.
 */
export async function listMyJobsAction(): Promise<
  ActionOk<{ jobs: JobRow[] }> | ActionErr
> {
  const workspace = await requireRecruiterWorkspace();
  if (!workspace.ok) return { ok: false, message: workspace.message, status: 403 };
  try {
    const result = await listRecruiterJobs(
      { jobs: prismaJobStore() },
      { userId: workspace.data.userId },
    );
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, data: { jobs: result.data } };
  } catch (error) {
    logger.error("[recruiter-job-actions] list", { error: String(error) });
    return { ok: false, message: "Failed to load jobs" };
  }
}

/** Workspace-scoped single fetch — a foreign row returns NOT_FOUND, not 403. */
export async function getMyJobAction(
  input: unknown,
): Promise<ActionOk<{ job: JobRow }> | ActionErr> {
  const workspace = await requireRecruiterWorkspace();
  if (!workspace.ok) return { ok: false, message: workspace.message, status: 403 };
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };
  try {
    const result = await getRecruiterJob(
      { jobs: prismaJobStore() },
      { userId: workspace.data.userId },
      parsed.data.jobId,
    );
    if (!result.ok) {
      const status = result.code === "NOT_FOUND" ? 404 : undefined;
      return { ok: false, message: result.message, status };
    }
    return { ok: true, data: { job: result.data } };
  } catch (error) {
    logger.error("[recruiter-job-actions] get", { error: String(error) });
    return { ok: false, message: "Failed to load job" };
  }
}

/** Workspace-scoped applicants for an owned job — foreign id is NOT_FOUND. */
export async function listMyJobApplicantsAction(
  input: unknown,
): Promise<ActionOk<{ applicants: OwnedApplicantRow[] }> | ActionErr> {
  const workspace = await requireRecruiterWorkspace();
  if (!workspace.ok) return { ok: false, message: workspace.message, status: 403 };
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };
  try {
    const result = await listApplicantsForOwnedJob(
      { jobs: prismaJobStore(), applications: prismaApplicantStore() },
      { userId: workspace.data.userId },
      parsed.data.jobId,
    );
    if (!result.ok) {
      const status = result.code === "NOT_FOUND" ? 404 : undefined;
      return { ok: false, message: result.message, status };
    }
    return { ok: true, data: { applicants: result.data } };
  } catch (error) {
    logger.error("[recruiter-job-actions] applicants", { error: String(error) });
    return { ok: false, message: "Failed to load applicants" };
  }
}

const applicantCardSchema = z.object({
  jobId: z.string().min(1),
  candidateRef: z.string().min(1),
});

/** Public inspector card for one applicant on an owned job. */
export async function getMyJobApplicantCardAction(
  input: unknown,
): Promise<ActionOk<{ match: MatchCardData }> | ActionErr> {
  const workspace = await requireRecruiterWorkspace();
  if (!workspace.ok) return { ok: false, message: workspace.message, status: 403 };
  const parsed = applicantCardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };
  try {
    const result = await loadApplicantMatchForOwnedJob(
      {
        jobs: prismaJobStore(),
        applications: prismaApplicantStore(),
        loadPublicIdentity: prismaLoadPublicIdentity,
      },
      { userId: workspace.data.userId },
      parsed.data.jobId,
      parsed.data.candidateRef,
    );
    if (!result.ok) {
      const status = result.code === "NOT_FOUND" ? 404 : undefined;
      return { ok: false, message: result.message, status };
    }

    // T-251: notify the candidate that a real recruiter opened their
    // profile from the jobs applicant panel. Best-effort — the decoded
    // ref might come from a legacy prefix in edge cases, in which case
    // we simply skip the notification. Failure never surfaces to the
    // recruiter.
    const decoded = decodeCandidateRef(parsed.data.candidateRef);
    if (decoded?.source === "PROFILE" && decoded.id) {
      try {
        await notifyProfileViewed(
          {
            store: prismaProfileViewStore(),
            dispatch: dispatchNotification,
          },
          {
            candidateUserId: decoded.id,
            recruiterUserId: workspace.data.userId,
          },
        );
      } catch (error) {
        logger.error("[recruiter-job-actions] profile-view notify failed", {
          error: String(error),
        });
      }
    }

    return { ok: true, data: { match: result.data } };
  } catch (error) {
    logger.error("[recruiter-job-actions] applicant-card", {
      error: String(error),
    });
    return { ok: false, message: "Failed to load applicant" };
  }
}
