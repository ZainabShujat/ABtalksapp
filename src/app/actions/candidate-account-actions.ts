"use server";

import { after } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { writeClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  DeleteOwnAccountError,
  deleteOwnCandidateAccount,
} from "@/features/profile/delete-own-account";
import {
  DELETE_ACCOUNT_FEEDBACK_MAX,
  DELETE_ACCOUNT_REASONS,
} from "@/features/profile/delete-account-reasons";
import { sendAccountDeletedEmail } from "@/features/notification/account-deleted-email";

type ActionResult = { ok: true } | { ok: false; message: string };

const schema = z.object({
  confirm: z.literal("DELETE"),
  reason: z.enum(DELETE_ACCOUNT_REASONS),
  feedback: z.string().trim().max(DELETE_ACCOUNT_FEEDBACK_MAX).optional(),
});

export async function deleteOwnAccountAction(
  input: unknown,
): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { ok: false, message: "Please sign in." };
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Pick a reason and type "DELETE" to confirm.',
    };
  }

  try {
    const deleted = await writeClient().$transaction(async (tx) =>
      deleteOwnCandidateAccount(tx, {
        userId,
        leaveReason: parsed.data.reason,
        feedback: parsed.data.feedback || null,
      }),
    );
    // Confirmation mail after the response. Never throws, so a mail failure
    // cannot fail a deletion that already committed.
    after(() =>
      sendAccountDeletedEmail({ to: deleted.email, name: deleted.name }),
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof DeleteOwnAccountError) {
      return { ok: false, message: error.message };
    }
    logger.error("[profile] deleteOwnAccountAction", { error: String(error) });
    return { ok: false, message: "Could not delete this account." };
  }
}
