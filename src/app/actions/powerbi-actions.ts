"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { POWERBI_BASE } from "@/features/powerbi/constants";
import { createPowerBiEnrollment } from "@/features/powerbi/enroll";
import {
  submitPowerBiMissionRun,
  type PowerBiSubmitOk,
} from "@/features/powerbi/missions";
import {
  powerBiEnrollSchema,
  powerBiSubmitMissionSchema,
} from "@/lib/validations/powerbi";
import { findPowerBiEnrollment } from "@/repositories/powerbi";

type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; message: string };

export async function enrollInPowerBiAction(
  input: unknown,
): Promise<ActionResult<{ enrollmentId: string }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Please sign in to continue." };
  }

  const parsed = powerBiEnrollSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Please check the form and try again." };
  }

  const result = await createPowerBiEnrollment(session.user.id, parsed.data);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(POWERBI_BASE);
  return { ok: true, data: { enrollmentId: result.enrollmentId } };
}

export async function submitPowerBiMissionAction(
  input: unknown,
): Promise<ActionResult<PowerBiSubmitOk>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Please sign in to continue." };
  }

  const parsed = powerBiSubmitMissionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Invalid submission." };
  }

  const enrollment = await findPowerBiEnrollment(session.user.id);
  if (!enrollment) {
    return { ok: false, message: "You are not enrolled in this cohort." };
  }

  const result = await submitPowerBiMissionRun(
    enrollment,
    parsed.data.dayNumber,
    parsed.data.payload,
  );
  if ("ok" in result && result.ok === false) {
    return { ok: false, message: result.message };
  }

  revalidatePath(POWERBI_BASE);
  revalidatePath(`${POWERBI_BASE}/day/${parsed.data.dayNumber}`);
  return { ok: true, data: result as PowerBiSubmitOk };
}
