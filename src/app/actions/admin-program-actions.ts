"use server";

import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import { requireAdmin } from "@/lib/admin-auth";
import { PROGRAM_AI_COHORT_BASE, PROGRAM_TZ } from "@/features/program/constants";
import {
  adminUnlockDay,
  createOrUpdateCohort,
  dropMember,
  getAdminProgramCohort,
  grantSkipToken,
  promoteWaitlisted,
  publishResults,
  regenerateJoinCode,
  regenerateMemberRecommendation,
  resolveAdminProgramCohort,
  setCohortStatus,
} from "@/features/program/admin";
import {
  adminMemberActionSchema,
  adminMemberIdSchema,
  adminUnlockDaySchema,
  cohortFormSchema,
  cohortIdSchema,
  cohortStatusSchema,
  regenerateJoinCodeSchema,
} from "@/lib/validations/program";

type ActionResult =
  | { ok: true }
  | { ok: false; message: string };

export async function createOrUpdateCohortAction(
  input: unknown,
): Promise<ActionResult & { cohortId?: string }> {
  const admin = await requireAdmin();
  const parsed = cohortFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid cohort data." };

  const result = await createOrUpdateCohort(admin.userId, {
    cohortId: parsed.data.cohortId,
    name: parsed.data.name,
    startsAt: fromZonedTime(parsed.data.startsAt, PROGRAM_TZ),
    endsAt: fromZonedTime(parsed.data.endsAt, PROGRAM_TZ),
    capacity: parsed.data.capacity,
    requiresJoinCode: parsed.data.requiresJoinCode,
  });
  if (!result.ok) return result;

  revalidatePath("/admin/program");
  return { ok: true, cohortId: result.cohortId };
}

export async function regenerateJoinCodeAction(
  input: unknown,
): Promise<ActionResult & { joinCode?: string }> {
  const admin = await requireAdmin();
  const parsed = regenerateJoinCodeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid cohort." };

  const result = await regenerateJoinCode(admin.userId, parsed.data.cohortId);
  if (!result.ok) return result;

  revalidatePath("/admin/program");
  return { ok: true, joinCode: result.joinCode };
}

export async function setCohortStatusAction(
  input: unknown,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = cohortStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid status." };

  const result = await setCohortStatus(
    admin.userId,
    parsed.data.cohortId,
    parsed.data.status,
  );
  if (!result.ok) return result;

  revalidatePath("/admin/program");
  return { ok: true };
}

export async function publishResultsAction(
  input: unknown,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = cohortIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid cohort." };

  const result = await publishResults(admin.userId, parsed.data.cohortId);
  if (!result.ok) return result;

  revalidatePath("/admin/program");
  revalidatePath("/hire");
  return { ok: true };
}

export async function promoteWaitlistedAction(
  input: unknown,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = adminMemberIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid member." };

  const result = await promoteWaitlisted(admin.userId, parsed.data.memberId);
  if (!result.ok) return result;

  revalidatePath("/admin/program/members");
  revalidatePath(`/admin/program/members/${parsed.data.memberId}`);
  return { ok: true };
}

export async function dropMemberAction(input: unknown): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = adminMemberActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const result = await dropMember(
    admin.userId,
    parsed.data.memberId,
    parsed.data.reason,
  );
  if (!result.ok) return result;

  revalidatePath("/admin/program");
  revalidatePath("/admin/program/members");
  revalidatePath(`/admin/program/members/${parsed.data.memberId}`);
  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/leaderboard`);
  revalidatePath("/hire");
  return { ok: true };
}

export async function adminUnlockDayAction(
  input: unknown,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = adminUnlockDaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const result = await adminUnlockDay(
    admin.userId,
    parsed.data.memberId,
    parsed.data.day,
    parsed.data.reason,
  );
  if (!result.ok) return result;

  revalidatePath(`/admin/program/members/${parsed.data.memberId}`);
  return { ok: true };
}

export async function grantSkipTokenAction(
  input: unknown,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = adminMemberActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const result = await grantSkipToken(
    admin.userId,
    parsed.data.memberId,
    parsed.data.reason,
  );
  if (!result.ok) return result;

  revalidatePath(`/admin/program/members/${parsed.data.memberId}`);
  return { ok: true };
}

export async function regenerateRecommendationAction(
  input: unknown,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = adminMemberIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid member." };

  const result = await regenerateMemberRecommendation(
    admin.userId,
    parsed.data.memberId,
  );
  if (!result.ok) return result;

  revalidatePath(`/admin/program/members/${parsed.data.memberId}`);
  revalidatePath("/admin/program/projects");
  return { ok: true };
}

export async function getAdminCohortIdAction(
  preferredCohortId?: string | null,
): Promise<
  { ok: true; cohortId: string | null } | { ok: false; message: string }
> {
  await requireAdmin();
  if (preferredCohortId) {
    const cohort = await resolveAdminProgramCohort(preferredCohortId);
    return { ok: true, cohortId: cohort?.id ?? null };
  }
  const cohort = await getAdminProgramCohort();
  return { ok: true, cohortId: cohort?.id ?? null };
}
