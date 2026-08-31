"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import {
  evaluateInterview,
  adminResetInterview,
} from "@/features/program/interview";
import {
  adminEvaluateInterviewSchema,
  adminResetInterviewSchema,
} from "@/lib/validations/program";

type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; message: string };

export async function adminEvaluateInterviewAction(
  input: unknown,
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = adminEvaluateInterviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid interview." };

  const result = await evaluateInterview(parsed.data.interviewId);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/admin/program/interviews");
  revalidatePath("/program/dashboard");
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
  revalidatePath("/program/dashboard");
  return { ok: true };
}
