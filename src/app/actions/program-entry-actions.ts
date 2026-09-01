"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  createApplication,
  peekJoinCode,
  startEntryAttempt,
  submitEntryAttempt,
  type EntrySubmitOk,
} from "@/features/program/entry";
import { PROGRAM_AI_COHORT_BASE } from "@/features/program/constants";
import {
  applyToProgramSchema,
  entrySubmitSchema,
  joinCodeSchema,
} from "@/lib/validations/program";

type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; message: string };

export async function applyToProgramAction(
  input: unknown,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Please sign in to continue." };
  }

  const parsed = applyToProgramSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Please check the form and try again." };
  }

  const { joinCode, ...profile } = parsed.data;
  const result = await createApplication(session.user.id, profile, joinCode);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/apply`);
  revalidatePath(PROGRAM_AI_COHORT_BASE);
  return { ok: true };
}

export async function validateJoinCodeAction(
  input: unknown,
): Promise<
  | { ok: true; data: { joinCode: string; cohortName: string } }
  | { ok: false; message: string }
> {
  const parsed = joinCodeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Enter a valid join code." };
  }
  const result = await peekJoinCode(parsed.data);
  if (!result.ok) return { ok: false, message: result.message };
  return {
    ok: true,
    data: { joinCode: result.joinCode, cohortName: result.cohortName },
  };
}

/** Form action: starts (or resumes) an attempt and sends the user to the assessment. */
export async function startEntryAssessmentAction(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect(`/login?from=${PROGRAM_AI_COHORT_BASE}/apply`);

  const result = await startEntryAttempt(session.user.id);
  if (!result.ok) redirect(`${PROGRAM_AI_COHORT_BASE}/apply`);

  redirect(`${PROGRAM_AI_COHORT_BASE}/assessment`);
}

export async function submitEntryAssessmentAction(
  input: unknown,
): Promise<ActionResult<EntrySubmitOk>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Please sign in to continue." };
  }

  const parsed = entrySubmitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Invalid submission." };
  }

  const result = await submitEntryAttempt(
    session.user.id,
    parsed.data.attemptId,
    parsed.data.answers,
  );
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/apply`);
  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/assessment`);
  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/dashboard`);
  return { ok: true, data: result };
}
