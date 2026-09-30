"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { syncApplicationsForStageChange } from "@/features/pipeline-convergence/sync-application-status";
import { requireRecruiterWorkspace } from "@/features/recruiter-workspace/workspace";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { resolveInspectorCandidate } from "@/features/hire/pool-policy";
import { decodeCandidateRef } from "@/features/hire/candidate-ref";
import {
  addToPipeline,
  moveStage,
  removeFromPipeline,
} from "@/repositories/talent-pipeline";
import {
  addToPipelineInputSchema,
  moveStageInputSchema,
  removeItemInputSchema,
  pipelineStageSchema,
} from "@/lib/validations/pipeline";

/**
 * T-240 recruiter pipeline server actions.
 *
 * Every action resolves the caller through `requireRecruiterWorkspace()`,
 * which is the single boundary for "this row belongs to this recruiter" —
 * no id ever comes from the client, so there is no "recruiter A passes
 * recruiter B's id" bug to plug. Zod parses every input. Repository does
 * the write. `revalidatePath("/hire/pipeline")` refreshes the board.
 */

type ActionOk<T = undefined> = T extends undefined
  ? { ok: true }
  : { ok: true; data: T };
type ActionErr = { ok: false; message: string; status?: number };

/**
 * The candidate row Prisma stores has a name we use as the tombstone label
 * (`TalentListItem.candidateLabel`) so a candidate deleting their account
 * later does not silently shrink the recruiter's pipeline count. Fall back
 * to the label the client passed if we cannot read a name.
 */
async function labelForCandidate(
  candidateUserId: string,
  fallback: string,
): Promise<string> {
  try {
    const row = await prisma.user.findUnique({
      where: { id: candidateUserId },
      select: { name: true },
    });
    const name = row?.name?.trim();
    if (name) return name;
  } catch (err) {
    logger.warn("pipeline-actions.labelForCandidate lookup failed", {
      candidateUserId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return fallback.trim() || "Candidate";
}

export async function addCandidateToPipelineAction(
  input: unknown,
): Promise<ActionOk<{ itemId: string; created: boolean }> | ActionErr> {
  const workspace = await requireRecruiterWorkspace();
  if (!workspace.ok) {
    return { ok: false, message: workspace.message, status: 403 };
  }

  const parsed = addToPipelineInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid pipeline input.",
      status: 400,
    };
  }

  const label = await labelForCandidate(parsed.data.candidateUserId, "Candidate");

  const result = await addToPipeline(
    {
      userId: workspace.data.userId,
      recruiterProfileId: workspace.data.recruiterProfileId,
      organizationId: workspace.data.organizationId,
    },
    {
      candidateUserId: parsed.data.candidateUserId,
      label,
      stage: parsed.data.stage,
    },
  );

  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/hire/pipeline");
  return { ok: true, data: result.data };
}

const addRefInputSchema = z.object({
  candidateRef: z.string().min(1).max(200),
  stage: pipelineStageSchema.optional(),
  fallbackLabel: z.string().max(200).optional(),
});

/**
 * Bridge from the Scout candidate inspector: caller passes a `candidateRef`
 * ("PROGRAM:xxx", "CLAUDE:xxx", …) and the server decodes it, resolves the
 * User id via the same helper the inspector already uses for its own reads
 * (`resolveInspectorCandidate`), then adds. Idempotent.
 */
export async function addCandidateRefToPipelineAction(
  input: unknown,
): Promise<ActionOk<{ itemId: string; created: boolean }> | ActionErr> {
  const workspace = await requireRecruiterWorkspace();
  if (!workspace.ok) {
    return { ok: false, message: workspace.message, status: 403 };
  }

  const parsed = addRefInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid pipeline input.",
      status: 400,
    };
  }

  let candidateUserId: string | null = null;
  const resolved = await resolveInspectorCandidate(parsed.data.candidateRef);
  if (resolved) {
    candidateUserId = resolved.userId;
  } else {
    const decoded = decodeCandidateRef(parsed.data.candidateRef);
    if (decoded?.id) {
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true },
      });
      if (user) candidateUserId = user.id;
    }
  }

  if (!candidateUserId) {
    return {
      ok: false,
      message: "That candidate is no longer available.",
      status: 404,
    };
  }

  const label = await labelForCandidate(
    candidateUserId,
    parsed.data.fallbackLabel ?? "Candidate",
  );

  const result = await addToPipeline(
    {
      userId: workspace.data.userId,
      recruiterProfileId: workspace.data.recruiterProfileId,
      organizationId: workspace.data.organizationId,
    },
    {
      candidateUserId,
      label,
      stage: parsed.data.stage,
    },
  );

  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/hire/pipeline");
  return { ok: true, data: result.data };
}

export async function moveCandidateStageAction(
  input: unknown,
): Promise<ActionOk | ActionErr> {
  const workspace = await requireRecruiterWorkspace();
  if (!workspace.ok) {
    return { ok: false, message: workspace.message, status: 403 };
  }

  const parsed = moveStageInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid pipeline input.",
      status: 400,
    };
  }

  const pipelineWorkspace = {
    userId: workspace.data.userId,
    recruiterProfileId: workspace.data.recruiterProfileId,
    organizationId: workspace.data.organizationId,
  };
  const result = await moveStage(pipelineWorkspace, parsed.data);

  if (!result.ok) return { ok: false, message: result.message, status: 404 };

  // Write the move back to the candidate's job application(s) and notify
  // them — after the response, so the board never waits on the email.
  // Owned by the applications/notifications module; never throws.
  const { itemId, stage } = parsed.data;
  after(() =>
    syncApplicationsForStageChange({
      workspace: pipelineWorkspace,
      itemId,
      stage,
    }),
  );

  revalidatePath("/hire/pipeline");
  return { ok: true };
}

export async function removeCandidateFromPipelineAction(
  input: unknown,
): Promise<ActionOk | ActionErr> {
  const workspace = await requireRecruiterWorkspace();
  if (!workspace.ok) {
    return { ok: false, message: workspace.message, status: 403 };
  }

  const parsed = removeItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid pipeline input.",
      status: 400,
    };
  }

  const result = await removeFromPipeline(
    {
      userId: workspace.data.userId,
      recruiterProfileId: workspace.data.recruiterProfileId,
      organizationId: workspace.data.organizationId,
    },
    parsed.data,
  );

  if (!result.ok) return { ok: false, message: result.message, status: 404 };

  revalidatePath("/hire/pipeline");
  return { ok: true };
}
