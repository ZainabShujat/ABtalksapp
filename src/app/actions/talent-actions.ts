"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  registerRecruiter,
} from "@/features/talent-pool/recruiter-registration";
import {
  ensureShortlisted,
  toggleShortlist,
  updateShortlistNote,
} from "@/features/talent-pool/pool";
import {
  recruiterRegisterSchema,
  shortlistNoteSchema,
  shortlistToggleSchema,
} from "@/lib/validations/talent";
import { recordLegalConsents } from "@/features/legal/record-consent";
import { recordNewsletterOptIn } from "@/features/legal/record-newsletter-optin";

type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; message: string };

export async function registerRecruiterAction(
  input: unknown,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Please sign in to continue." };
  }

  const parsed = recruiterRegisterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Please check the form and try again.",
    };
  }

  const result = await registerRecruiter(session.user.id, {
    fullName: parsed.data.fullName,
    company: parsed.data.company,
    phone: parsed.data.phone || undefined,
  });
  if (!result.ok) return result;

  await recordLegalConsents({
    userId: session.user.id,
    email: session.user.email,
    source: "talent_register",
  });

  await recordNewsletterOptIn({
    userId: session.user.id,
    email: session.user.email,
    source: "talent_register",
    optIn: parsed.data.newsletterOptIn === true,
  });

  revalidatePath("/talent/register");
  revalidatePath("/talent/pending");
  return { ok: true };
}

export async function toggleShortlistAction(
  input: unknown,
): Promise<ActionResult<{ shortlisted: boolean }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Please sign in." };
  }

  const parsed = shortlistToggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid member." };

  const result = await toggleShortlist(
    session.user.id,
    parsed.data.memberId,
  );
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/talent");
  revalidatePath("/talent/shortlist");
  revalidatePath(`/talent/members/${parsed.data.memberId}`);
  // "layout" scope, not the bare path: the cart count lives in the /hire layout
  // and the results live at /hire/[requestId]. Revalidating "/hire" alone left
  // both stale, so adding to the cart appeared to do nothing.
  revalidatePath("/hire", "layout");
  return { ok: true, data: { shortlisted: result.shortlisted } };
}

export async function updateShortlistNoteAction(
  input: unknown,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Please sign in." };
  }

  const parsed = shortlistNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid note." };

  const result = await updateShortlistNote(
    session.user.id,
    parsed.data.memberId,
    parsed.data.note,
  );
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/talent/shortlist");
  revalidatePath(`/talent/members/${parsed.data.memberId}`);
  return { ok: true };
}

const mergeGuestCartSchema = z.object({
  memberIds: z.array(z.string().min(1).max(80)).max(25),
});

/**
 * Copy a guest localStorage cart onto the signed-in recruiter's shortlist.
 *
 * Reports WHICH members landed, not just how many, and that distinction is the
 * whole fix. This used to swallow every per-member failure and return
 * `{ ok: true, merged: 0 }` regardless — and the caller, reading only `ok`,
 * then deleted the local copy. A recruiter who registered and was still waiting
 * on approval failed `assertPoolAccess` for every candidate, so the guaranteed
 * outcome of the normal signup path was: nothing merged, cart erased, blank
 * shortlist, no message. The client can only safely forget what this confirms.
 */
export async function mergeGuestCartAction(
  memberIds: unknown,
): Promise<
  ActionResult<{ merged: number; mergedIds: string[]; failedIds: string[] }>
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Please sign in." };
  }
  const parsed = mergeGuestCartSchema.safeParse({ memberIds });
  if (!parsed.success) return { ok: false, message: "Invalid cart." };

  let merged = 0;
  const mergedIds: string[] = [];
  const failedIds: string[] = [];
  let firstFailure: string | null = null;

  for (const memberId of parsed.data.memberIds) {
    const result = await ensureShortlisted(session.user.id, memberId);
    if (result.ok) {
      // `added: false` means it was already on the shortlist — that is on the
      // account either way, so the guest copy is safe to drop.
      mergedIds.push(memberId);
      if (result.added) merged += 1;
    } else {
      failedIds.push(memberId);
      firstFailure ??= result.message;
    }
  }

  revalidatePath("/talent/shortlist");
  revalidatePath("/hire", "layout");

  // Nothing landed at all: that is a failure, however cleanly each step
  // returned. Saying otherwise is what cost recruiters their shortlist.
  if (mergedIds.length === 0 && failedIds.length > 0) {
    return {
      ok: false,
      message:
        firstFailure ??
        "Could not add your shortlist to this account yet.",
    };
  }

  return { ok: true, data: { merged, mergedIds, failedIds } };
}

const recruiterVisibilitySchema = z.object({ enabled: z.boolean() });

/**
 * Turn recruiter visibility on or off for the signed-in program member.
 *
 * Consent was write-once: it was captured on the application form
 * (features/program/entry.ts) and there was no second place to change it. A
 * member who skipped the checkbox — or ticked it and changed their mind — was
 * stuck with that answer for the whole cohort. Forty-one of forty-six members
 * of the live cohort are invisible to hiring because of a box they saw once,
 * including every one of the top performers.
 *
 * Off is still the default, nothing here pre-ticks anything, and turning it off
 * removes them from the next search — `memberEligibilityWhere` reads this
 * column on every query.
 */
export async function setRecruiterVisibilityAction(
  input: unknown,
): Promise<ActionResult<{ enabled: boolean }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Please sign in." };
  }

  const parsed = recruiterVisibilitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid choice." };

  const updated = await prisma.programMember.updateMany({
    where: { userId: session.user.id },
    data: {
      recruiterVisibilityConsentAt: parsed.data.enabled ? new Date() : null,
    },
  });
  if (updated.count === 0) {
    return { ok: false, message: "No program membership found." };
  }

  revalidatePath("/program/dashboard");
  return { ok: true, data: { enabled: parsed.data.enabled } };
}
