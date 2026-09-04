"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { DS_ARCHITECT_BASE } from "@/features/ds-architect/constants";
import { createDsArchitectEnrollment } from "@/features/ds-architect/enroll";
import {
  submitDsArchitectMissionRun,
  type DsArchitectSubmitOk,
} from "@/features/ds-architect/missions";
import {
  dsArchitectEnrollSchema,
  dsArchitectSubmitMissionSchema,
} from "@/lib/validations/ds-architect";
import { findDsArchitectEnrollment } from "@/repositories/ds-architect";

type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; message: string };

export async function enrollInDsArchitectAction(
  input: unknown,
): Promise<ActionResult<{ enrollmentId: string }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Please sign in to continue." };
  }

  const parsed = dsArchitectEnrollSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Please check the form and try again." };
  }

  const result = await createDsArchitectEnrollment(session.user.id, parsed.data);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(DS_ARCHITECT_BASE);
  return { ok: true, data: { enrollmentId: result.enrollmentId } };
}

export async function submitDsArchitectMissionAction(
  input: unknown,
): Promise<ActionResult<DsArchitectSubmitOk>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Please sign in to continue." };
  }

  const parsed = dsArchitectSubmitMissionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Invalid submission." };
  }

  const enrollment = await findDsArchitectEnrollment(session.user.id);
  if (!enrollment) {
    return { ok: false, message: "You are not enrolled in this cohort." };
  }

  const result = await submitDsArchitectMissionRun(
    enrollment,
    parsed.data.dayNumber,
    parsed.data.payload,
  );
  if ("ok" in result && result.ok === false) {
    return { ok: false, message: result.message };
  }

  revalidatePath(DS_ARCHITECT_BASE);
  revalidatePath(`${DS_ARCHITECT_BASE}/day/${parsed.data.dayNumber}`);
  return { ok: true, data: result as DsArchitectSubmitOk };
}
