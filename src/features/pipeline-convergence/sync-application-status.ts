import "server-only";
import { PipelineStage, type JobApplicationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { notifyCandidateApplicationStatus } from "@/features/recruiter-notifications/notify-recruiter";
import { dispatch } from "@/features/notification/notification-service";
import {
  getPipelineItemCandidateId,
  type PipelineWorkspace,
} from "@/repositories/talent-pipeline";

/**
 * Pipeline → application write-back (the reverse of T-247).
 *
 * T-247 puts an applicant on the recruiter's board at SOURCED. Until now a
 * stage move never flowed back, so the candidate's JobApplication stayed
 * APPLIED forever and they were never told anything. When the recruiter
 * moves a card, every application that candidate has on THIS recruiter's
 * jobs is moved to the matching status and the candidate is notified
 * (in-app + email).
 *
 * Milestones — Shortlisted, Offer, Hired — additionally email EVERY
 * candidate on the board, including Scout-sourced ones who never applied
 * (`pipeline.stage_reached`, once per candidate × recruiter × stage). For
 * those three stages that email replaces the application-status one, so
 * nobody gets two. Other stages still only reach applicants.
 *
 * Fire-and-forget: the recruiter's stage move already succeeded, so every
 * failure is a warn log and a silent return. Never throws.
 */

/** Stage → candidate-facing status. null = the stage does not change the application. */
export function applicationStatusForStage(
  stage: PipelineStage,
): Exclude<JobApplicationStatus, "APPLIED"> | null {
  switch (stage) {
    case PipelineStage.SHORTLISTED:
    case PipelineStage.CONTACTED:
    case PipelineStage.SCREENING:
    case PipelineStage.INTERVIEWING:
      return "REVIEWING";
    case PipelineStage.OFFER:
    case PipelineStage.HIRED:
      return "ACCEPTED";
    case PipelineStage.REJECTED:
      return "REJECTED";
    // SOURCED is where applicants start; WITHDRAWN is the candidate's own
    // exit, not a recruiter decision to announce.
    default:
      return null;
  }
}

/**
 * Stages that email EVERY candidate on the board (applied or Scout-sourced).
 * These replace the application-status email for the same move, so an
 * applicant is never told twice.
 */
const MILESTONE_STAGES = new Set<PipelineStage>([
  PipelineStage.SHORTLISTED,
  PipelineStage.OFFER,
  PipelineStage.HIRED,
]);

function milestoneCopy(
  stage: PipelineStage,
  company: string,
  jobTitle: string | null,
): { title: string; body: string } {
  const forRole = jobTitle ? ` for the ${jobTitle} role` : "";
  if (stage === PipelineStage.OFFER) {
    return {
      title: `${company} has moved you to the offer stage`,
      body: `${company} has moved you to the offer stage${forRole}. The recruiter will contact you with the details.`,
    };
  }
  if (stage === PipelineStage.HIRED) {
    return {
      title: `${company} has marked you as hired`,
      body: `Congratulations. ${company} has marked you as hired${forRole}. The recruiter will contact you about next steps.`,
    };
  }
  return {
    title: `${company} has shortlisted you`,
    body: `${company} has shortlisted your profile${forRole}. The recruiter may contact you on ABTalks soon.`,
  };
}

async function notifyMilestone(input: {
  candidateUserId: string;
  recruiterProfileId: string;
  stage: PipelineStage;
  company: string;
  jobTitle: string | null;
  hasApplied: boolean;
}): Promise<void> {
  const copy = milestoneCopy(input.stage, input.company, input.jobTitle);
  const result = await dispatch({
    eventType: "pipeline.stage_reached",
    recipientUserId: input.candidateUserId,
    primaryEntityId: input.recruiterProfileId,
    // Once per candidate × recruiter × stage: dragging a card back and
    // forth never re-sends the same milestone.
    dedupeKey: `pipeline.stage_reached:${input.candidateUserId}:${input.recruiterProfileId}:${input.stage}`,
    title: copy.title,
    body: copy.body,
    href: input.hasApplied ? "/jobs?tab=applications" : "/dashboard",
  });
  if (!result.ok) {
    logger.warn("pipeline-convergence.milestone_refused", {
      stage: input.stage,
      message: result.message,
    });
  }
}

export async function syncApplicationsForStageChange(input: {
  workspace: PipelineWorkspace;
  itemId: string;
  stage: PipelineStage;
}): Promise<void> {
  const target = applicationStatusForStage(input.stage);
  const isMilestone = MILESTONE_STAGES.has(input.stage);
  if (!target && !isMilestone) return;

  try {
    // Through the T-240 repository (the only module allowed to read
    // TalentListItem); same ownership scope as moveStage.
    const candidateUserId = await getPipelineItemCandidateId(
      input.workspace,
      input.itemId,
    );
    if (!candidateUserId) return;

    if (target) {
      const applications = await prisma.jobApplication.findMany({
        where: {
          userId: candidateUserId,
          job: { recruiterId: input.workspace.userId },
          status: { not: target },
        },
        select: {
          id: true,
          status: true,
          job: { select: { title: true, company: true } },
        },
      });

      for (const app of applications) {
        // Conditional on the status we read, so two quick moves cannot both
        // claim the same transition and send two emails.
        const updated = await prisma.jobApplication.updateMany({
          where: { id: app.id, status: app.status },
          data: { status: target },
        });
        if (updated.count === 0) continue;

        // Milestone stages send their own email below instead.
        if (!isMilestone) {
          await notifyCandidateApplicationStatus({
            candidateUserId,
            applicationId: app.id,
            status: target,
            jobTitle: app.job.title,
            company: app.job.company,
          });
        }
      }
    }

    if (isMilestone) {
      // Name the role only when the candidate applied to exactly one of this
      // recruiter's jobs; otherwise the stage is about the person, not a job.
      const applied = await prisma.jobApplication.findMany({
        where: {
          userId: candidateUserId,
          job: { recruiterId: input.workspace.userId },
        },
        select: { job: { select: { title: true, company: true } } },
        take: 2,
      });
      const org = await prisma.organization.findUnique({
        where: { id: input.workspace.organizationId },
        select: { name: true },
      });
      const onlyJob = applied.length === 1 ? applied[0].job : null;
      const company = onlyJob?.company || org?.name?.trim() || "A recruiter";

      await notifyMilestone({
        candidateUserId,
        recruiterProfileId: input.workspace.recruiterProfileId,
        stage: input.stage,
        company,
        jobTitle: onlyJob?.title ?? null,
        hasApplied: applied.length > 0,
      });
    }
  } catch (err) {
    logger.warn("pipeline-convergence.status_sync_failed", {
      itemId: input.itemId,
      stage: input.stage,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
