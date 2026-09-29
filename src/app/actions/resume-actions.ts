"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { logger } from "@/lib/logger";
import { resumeLinkSchema } from "@/lib/validations/resume";
import {
  getResumeView,
  removeResume,
  saveResumeLink,
  saveResumeUpload,
  applyStoredResumeToProfile,
} from "@/features/resume/service";
import { MAX_RESUME_BYTES, type ParsedResume, type ResumeView } from "@/features/resume/types";
import { prisma, writeClient } from "@/lib/db";
import { UserType } from "@prisma/client";
import { isCandidateRegistered } from "@/features/registration/registration-gate";
import { createCandidateIdentity } from "@/repositories/candidate-identity";
import { generateUniqueReferralCode } from "@/features/registration/generate-referral-code";
import { identityFromParsedResume } from "@/features/resume/import/identity-mapping";
import { applyVisibilityChange } from "@/repositories/visibility";

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
  | { ok: true; data: ResumeView; autoRegistered?: boolean }
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
    if (result.ok) {
      revalidatePath("/profile");
      const registered = await isCandidateRegistered(authed.userId);
      if (!registered) {
        const candidateResume = await prisma.candidateResume.findUnique({
          where: { userId: authed.userId },
          select: { parsedData: true },
        });
        if (candidateResume?.parsedData) {
          const user = await prisma.user.findUnique({
            where: { id: authed.userId },
            select: { name: true, email: true },
          });
          const mapped = identityFromParsedResume(candidateResume.parsedData as ParsedResume);
          const fullName = mapped.ok ? mapped.identity.fullName : (user?.name || "Candidate");
          const userType = mapped.ok ? mapped.identity.userType : UserType.STUDENT;
          const headline = mapped.ok ? mapped.identity.headline : null;
          const referralCode = await generateUniqueReferralCode();

          await writeClient().$transaction(async (tx) => {
            await createCandidateIdentity(tx, {
              userId: authed.userId,
              fullName,
              userType,
              referralCode,
              phone: null,
              phoneVerified: false,
              college: null,
              collegeId: null,
              organization: null,
              role: null,
              yearsExperience: null,
              headline,
              locationCity: null,
              locationRegion: null,
              countryCode: null,
              synergyPoints: 0,
            });
            await tx.candidateProfile.update({
              where: { userId: authed.userId },
              data: { reviewPendingSince: new Date() },
              select: { id: true },
            });
            await applyVisibilityChange(tx, { userId: authed.userId, kind: "usable_profile" });
          });
          await applyStoredResumeToProfile(authed.userId);
          revalidatePath("/dashboard");
          return { ok: true, data: result.data, autoRegistered: true };
        }
      }
      return result;
    }
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

/**
 * What is actually stored for this user right now.
 *
 * The upload path replaces the stored résumé before it parses, so a failed
 * upload can leave the row FAILED with the previous file already deleted. The
 * client cannot infer that from an error message, so after a failure it asks.
 *
 * `ready` mirrors exactly what `register/page.tsx` computes for `resumeReady`,
 * so the two agree by construction. It is the only truth signal: a FAILED row
 * can still carry a `fileName`, which is why that is returned for display only.
 *
 * Read-only, and like every action here it takes no argument and works only
 * from the session.
 */
export async function getResumeStateAction(): Promise<{
  ready: boolean;
  fileName: string | null;
}> {
  const authed = await requireUserId();
  if (!authed.ok) return { ready: false, fileName: null };

  try {
    const view = await getResumeView(authed.userId);
    return {
      ready: view?.status === "READY",
      fileName: view?.fileName ?? null,
    };
  } catch (error) {
    logger.error("[resume] state action failed", {
      userId: authed.userId,
      error: String(error),
    });
    return { ready: false, fileName: null };
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
