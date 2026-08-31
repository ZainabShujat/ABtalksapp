"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { requireAdmin } from "@/lib/admin-auth";
import {
  completeInterview,
  evaluateInterview,
  adminResetInterview,
} from "@/features/program/interview";
import { PROGRAM_AI_COHORT_BASE } from "@/features/program/constants";
import { resolveProgramMemberForUser } from "@/lib/program-auth";
import {
  adminEvaluateInterviewSchema,
  adminResetInterviewSchema,
  completeInterviewSchema,
} from "@/lib/validations/program";

type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; message: string };

async function requireProgramMemberId(): Promise<
  { ok: true; memberId: string } | { ok: false; message: string }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Please sign in to continue." };
  }

  const resolved = await resolveProgramMemberForUser(session.user.id);
  if (!resolved) return { ok: false, message: "Enrollment required." };
  return { ok: true, memberId: resolved.member.id };
}

export async function completeInterviewAction(
  input: unknown,
): Promise<ActionResult<{ evaluated: boolean }>> {
  const authResult = await requireProgramMemberId();
  if (!authResult.ok) return authResult;

  const parsed = completeInterviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid interview data." };

  const completed = await completeInterview(
    authResult.memberId,
    parsed.data.transcript,
    parsed.data.durationSec,
  );
  if (!completed.ok) return { ok: false, message: completed.message };

  const evaluated = await evaluateInterview(completed.interviewId);
  if (!evaluated.ok) {
    revalidatePath(`${PROGRAM_AI_COHORT_BASE}/interview`);
    revalidatePath(`${PROGRAM_AI_COHORT_BASE}/dashboard`);
    return {
      ok: true,
      data: { evaluated: false },
    };
  }

  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/interview`);
  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/dashboard`);
  return { ok: true, data: { evaluated: true } };
}

export async function adminEvaluateInterviewAction(
  input: unknown,
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = adminEvaluateInterviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid interview." };

  const result = await evaluateInterview(parsed.data.interviewId);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/admin/program/interviews");
  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/interview`);
  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/dashboard`);
  return { ok: true };
}

export async function adminResetInterviewAction(
  input: unknown,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const parsed = adminResetInterviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const result = await adminResetInterview(
    admin.userId,
    parsed.data.memberId,
    parsed.data.reason,
  );
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/admin/program/interviews");
  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/interview`);
  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/dashboard`);
  return { ok: true };
}
