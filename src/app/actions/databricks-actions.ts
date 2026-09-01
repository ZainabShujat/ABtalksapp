"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { DATABRICKS_BASE } from "@/features/databricks/constants";
import { createDatabricksEnrollment } from "@/features/databricks/enroll";
import {
  submitDatabricksMissionRun,
  type DatabricksSubmitOk,
} from "@/features/databricks/missions";
import {
  databricksEnrollSchema,
  databricksSubmitMissionSchema,
} from "@/lib/validations/databricks";
import { findDatabricksEnrollment } from "@/repositories/databricks";

type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; message: string };

export async function enrollInDatabricksAction(
  input: unknown,
): Promise<ActionResult<{ enrollmentId: string }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Please sign in to continue." };
  }

  const parsed = databricksEnrollSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Please check the form and try again." };
  }

  const result = await createDatabricksEnrollment(session.user.id, parsed.data);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(DATABRICKS_BASE);
  return { ok: true, data: { enrollmentId: result.enrollmentId } };
}

export async function submitDatabricksMissionAction(
  input: unknown,
): Promise<ActionResult<DatabricksSubmitOk>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Please sign in to continue." };
  }

  const parsed = databricksSubmitMissionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Invalid submission." };
  }

  const enrollment = await findDatabricksEnrollment(session.user.id);
  if (!enrollment) {
    return { ok: false, message: "You are not enrolled in this cohort." };
  }

  const result = await submitDatabricksMissionRun(
    enrollment,
    parsed.data.dayNumber,
    parsed.data.payload,
  );
  if ("ok" in result && result.ok === false) {
    return { ok: false, message: result.message };
  }

  revalidatePath(DATABRICKS_BASE);
  revalidatePath(`${DATABRICKS_BASE}/day/${parsed.data.dayNumber}`);
  return { ok: true, data: result as DatabricksSubmitOk };
}
