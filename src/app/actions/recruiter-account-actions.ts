"use server";

import { z } from "zod";
import { writeClient } from "@/lib/db";
import { logger, safeErrorMessage } from "@/lib/logger";
import { requireRecruiterWorkspace } from "@/features/recruiter-workspace/workspace";
import {
  DeleteRecruiterError,
  purgeRecruiterAccount,
} from "@/features/hire/delete-recruiter-account";
import {
  deleteCompanyLogoBlob,
  isOurCompanyLogoUrl,
} from "@/features/hire/org-logo-storage";

type ActionResult = { ok: true } | { ok: false; message: string };

const schema = z.object({
  // The same literal the candidate dialog requires, so the two destructive
  // confirmations behave identically.
  confirm: z.literal("DELETE"),
});

/**
 * A recruiter permanently deletes their own account (plan 160).
 *
 * The caller is resolved from the session — no user id is accepted, so this
 * cannot be pointed at anybody else. Irreversible: `disableAccount` is the
 * reversible operation and the dialog says so.
 */
export async function deleteOwnRecruiterAccountAction(
  input: unknown,
): Promise<ActionResult> {
  const workspace = await requireRecruiterWorkspace();
  if (!workspace.ok) return workspace;

  const { userId } = workspace.data;

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: 'Type "DELETE" to confirm.' };
  }

  let logoUrl: string | null = null;
  try {
    const result = await writeClient().$transaction(
      async (tx) =>
        purgeRecruiterAccount(tx, {
          userId,
          actorUserId: userId,
          byAdmin: false,
          reason: "Recruiter requested account deletion",
        }),
      // The window every recruiter-workspace write uses, with the longer
      // ceiling the admin purge already takes for this much deleting.
      { maxWait: 20_000, timeout: 30_000 },
    );
    logoUrl = result.logoUrl;
  } catch (error) {
    if (error instanceof DeleteRecruiterError) {
      return { ok: false, message: error.message };
    }
    logger.error("[hire] deleteOwnRecruiterAccountAction", {
      userId,
      error: safeErrorMessage(error),
    });
    return { ok: false, message: "Could not delete this account." };
  }

  // After the commit, and never fatal: a stranded blob is litter, a failed
  // deletion the recruiter already confirmed would be a broken promise.
  if (logoUrl && isOurCompanyLogoUrl(logoUrl)) {
    await deleteCompanyLogoBlob(logoUrl);
  }

  return { ok: true };
}
