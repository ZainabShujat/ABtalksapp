"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { logger } from "@/lib/logger";
import { resumeLinkSchema } from "@/lib/validations/resume";
import {
  removeResume,
  saveResumeLink,
  saveResumeUpload,
} from "@/features/resume/service";
import { MAX_RESUME_BYTES, type ResumeView } from "@/features/resume/types";

/**
 * Résumé server actions.
 *
 * Every one of them authenticates first and then works exclusively from
 * `session.user.id`. No action accepts a user id, a blob path or a filename
 * that would steer where data is read from or written to — which is what makes
 * "user A cannot reach user B's résumé" a property of the shape of these
 * functions rather than of a check that could be forgotten.
 *
 * Parsing runs inline. That is deliberate for V1: there is no queue in this
 * codebase and adding one for a call that happens a handful of times per
 * candidate would be infrastructure without a reason. The client renders a
 * processing state for the duration.
 */

export type ResumeActionResult =
  | { ok: true; data: ResumeView }
  | { ok: false; message: string };

const GENERIC_FAILURE = "Something went wrong. Please try again.";

async function requireUserId(): Promise<
  { ok: true; userId: string } | { ok: false; message: string }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "You must be signed in." };
  }
  return { ok: true, userId: session.user.id };
}

export async function uploadResumeAction(
  formData: FormData,
): Promise<ResumeActionResult> {
  const authed = await requireUserId();
  if (!authed.ok) return authed;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a PDF to upload." };
  }
  // A cheap pre-check so an oversized file is rejected before it is buffered.
  // The authoritative size and type checks run on the bytes in `ingest.ts`.
  if (file.size > MAX_RESUME_BYTES) {
    return {
      ok: false,
      message: `That file is too large. Please upload a PDF under ${Math.floor(
        MAX_RESUME_BYTES / (1024 * 1024),
      )} MB.`,
    };
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await saveResumeUpload(authed.userId, {
      bytes,
      // Only the display name survives; it never reaches a filesystem path.
      fileName: file.name.slice(0, 120) || null,
    });
    if (result.ok) revalidatePath("/profile");
    return result;
  } catch (error) {
    logger.error("[resume] upload action failed", {
      userId: authed.userId,
      error: String(error),
    });
    return { ok: false, message: GENERIC_FAILURE };
  }
}

export async function saveResumeLinkAction(
  raw: unknown,
): Promise<ResumeActionResult> {
  const authed = await requireUserId();
  if (!authed.ok) return authed;

  const parsed = resumeLinkSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid link",
    };
  }

  try {
    const result = await saveResumeLink(authed.userId, parsed.data.url);
    revalidatePath("/profile");
    return result;
  } catch (error) {
    logger.error("[resume] link action failed", {
      userId: authed.userId,
      error: String(error),
    });
    return { ok: false, message: GENERIC_FAILURE };
  }
}

export async function removeResumeAction(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const authed = await requireUserId();
  if (!authed.ok) return authed;

  try {
    await removeResume(authed.userId);
    revalidatePath("/profile");
    return { ok: true };
  } catch (error) {
    logger.error("[resume] remove action failed", {
      userId: authed.userId,
      error: String(error),
    });
    return { ok: false, message: GENERIC_FAILURE };
  }
}
