"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { LANGCHAIN_BASE } from "@/features/langchain/constants";
import { createLangchainEnrollment } from "@/features/langchain/enroll";
import {
  submitLangchainMissionRun,
  type LangchainSubmitOk,
} from "@/features/langchain/missions";
import {
  langchainEnrollSchema,
  langchainSubmitMissionSchema,
} from "@/lib/validations/langchain";
import { findLangchainEnrollment } from "@/repositories/langchain";

type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; message: string };

export async function enrollInLangchainAction(
  input: unknown,
): Promise<ActionResult<{ enrollmentId: string }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Please sign in to continue." };
  }

  const parsed = langchainEnrollSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Please check the form and try again." };
  }

  const result = await createLangchainEnrollment(session.user.id, parsed.data);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(LANGCHAIN_BASE);
  return { ok: true, data: { enrollmentId: result.enrollmentId } };
}

export async function submitLangchainMissionAction(
  input: unknown,
): Promise<ActionResult<LangchainSubmitOk>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Please sign in to continue." };
  }

  const parsed = langchainSubmitMissionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Invalid submission." };
  }

  const enrollment = await findLangchainEnrollment(session.user.id);
  if (!enrollment) {
    return { ok: false, message: "You are not enrolled in this cohort." };
  }

  const result = await submitLangchainMissionRun(
    enrollment,
    parsed.data.dayNumber,
    parsed.data.payload,
  );
  if ("ok" in result && result.ok === false) {
    return { ok: false, message: result.message };
  }

  revalidatePath(LANGCHAIN_BASE);
  revalidatePath(`${LANGCHAIN_BASE}/day/${parsed.data.dayNumber}`);
  return { ok: true, data: result as LangchainSubmitOk };
}
