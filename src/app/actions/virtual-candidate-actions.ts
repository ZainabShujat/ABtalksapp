"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/admin-auth";
import {
  cancelVirtualCandidateRequest,
  linkRealCandidate,
  listVirtualCandidateRequests,
  placeVirtualCandidateRequest,
  updateVirtualRequestStatus,
  type AdminRequestRow,
} from "@/features/hire/virtual-candidate-store";
import {
  cancelVirtualRequestSchema,
  linkRealCandidateSchema,
  listVirtualRequestsSchema,
  updateVirtualRequestSchema,
  virtualCandidateRequestSchema,
} from "@/lib/validations/virtual-candidate";

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

/**
 * Registered is enough to ask us to source someone.
 *
 * Deliberately looser than the introductions gate. Asking for a candidate to be
 * found reveals nothing about anybody — there is nobody yet — so holding it
 * behind approval would only lose the demand signal from recruiters who signed
 * up precisely because their search came back empty.
 */
async function requireRegisteredRecruiter(): Promise<
  ActionResult<{ userId: string }>
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Sign in to request a candidate." };
  }
  try {
    const profile = await prisma.recruiterProfile.findUnique({
      where: { userId: session.user.id },
      select: { userId: true },
    });
    if (!profile) return { ok: false, message: "Register as a recruiter first." };
    return { ok: true, data: { userId: session.user.id } };
  } catch (error) {
    logger.error("[hire] requireRegisteredRecruiter (virtual)", {
      error: String(error),
    });
    return { ok: false, message: "Could not reach the server. Try again." };
  }
}

/**
 * "Request Candidate" on a virtual profile.
 *
 * Returns `duplicate` rather than an error when the same recruiter asks twice:
 * from their side nothing went wrong, and a red message for "we already heard
 * you" reads as a failure.
 */
export async function requestVirtualCandidateAction(
  input: unknown,
): Promise<ActionResult<{ requestId: string; duplicate: boolean }>> {
  const gate = await requireRegisteredRecruiter();
  if (!gate.ok) return gate;

  const parsed = virtualCandidateRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Tell me the role or the stack first." };
  }

  const placed = await placeVirtualCandidateRequest({
    recruiterUserId: gate.data.userId,
    spec: parsed.data.spec,
    talentRequestId: parsed.data.talentRequestId ?? null,
    timelineDays: parsed.data.timelineDays ?? null,
    recruiterNote: parsed.data.recruiterNote ?? null,
  });
  if (!placed.ok) return placed;

  revalidatePath("/hire");
  revalidatePath("/hire/requests");
  revalidatePath("/admin/hire");
  return {
    ok: true,
    data: { requestId: placed.data.requestId, duplicate: placed.data.duplicate },
  };
}

/** Recruiter withdraws their own ask. Scoped to the caller by the store. */
export async function cancelVirtualCandidateRequestAction(
  input: unknown,
): Promise<ActionResult<{ requestId: string }>> {
  const gate = await requireRegisteredRecruiter();
  if (!gate.ok) return gate;

  const parsed = cancelVirtualRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };

  const result = await cancelVirtualCandidateRequest(
    parsed.data.requestId,
    gate.data.userId,
  );
  if (!result.ok) return result;

  revalidatePath("/hire/requests");
  revalidatePath("/admin/hire");
  return result;
}

/** Admin queue. `requireAdmin` throws for anyone else, so there is no leak. */
export async function listVirtualCandidateRequestsAction(
  input: unknown,
): Promise<ActionResult<{ rows: AdminRequestRow[]; total: number; page: number }>> {
  await requireAdmin();

  const parsed = listVirtualRequestsSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, message: "Invalid filter." };
  const page = parsed.data.page ?? 1;
  const perPage = parsed.data.perPage ?? 25;

  const result = await listVirtualCandidateRequests({
    status: parsed.data.status,
    skip: (page - 1) * perPage,
    take: perPage,
  });
  if (!result.ok) return result;

  return { ok: true, data: { ...result.data, page } };
}

/** Admin moves a request along the sourcing workflow. */
export async function updateVirtualRequestStatusAction(
  input: unknown,
): Promise<ActionResult<{ requestId: string; status: string }>> {
  const admin = await requireAdmin();

  const parsed = updateVirtualRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid update." };

  const result = await updateVirtualRequestStatus({
    requestId: parsed.data.requestId,
    to: parsed.data.status,
    adminUserId: admin.userId ?? null,
    note: parsed.data.note ?? null,
    expectedBy: parsed.data.expectedBy ? new Date(parsed.data.expectedBy) : undefined,
    assignedAdminId: parsed.data.assignedAdminId ?? undefined,
  });
  if (!result.ok) return result;

  revalidatePath("/admin/hire");
  revalidatePath("/hire/requests");
  return result;
}

/** Sourcing succeeded: attach the real person to this recruiter's ask. */
export async function linkRealCandidateAction(
  input: unknown,
): Promise<ActionResult<{ requestId: string; status: string }>> {
  const admin = await requireAdmin();

  const parsed = linkRealCandidateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid link." };

  const result = await linkRealCandidate({
    requestId: parsed.data.requestId,
    candidateUserId: parsed.data.candidateUserId,
    adminUserId: admin.userId ?? null,
    note: parsed.data.note ?? null,
  });
  if (!result.ok) return result;

  revalidatePath("/admin/hire");
  revalidatePath("/hire/requests");
  return result;
}
