"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { notifyAdminAction } from "@/features/notification/admin-action-notify";
import { requireAdmin } from "@/lib/admin-auth";
import {
  AccountOpsError,
  disableAccount,
  restoreAccount,
  secureAccount,
} from "@/features/admin/account-ops";
import { logger } from "@/lib/logger";

type ActionResult = { ok: true } | { ok: false; message: string };

const accountOpsSchema = z.object({
  targetUserId: z.string().min(1),
  reason: z.string().trim().min(8).max(500),
});

function revalidateAccountViews(targetUserId: string) {
  revalidatePath("/admin/students");
  revalidatePath(`/admin/students/${targetUserId}`);
  revalidatePath("/admin/recruiters");
  revalidatePath("/admin/actions");
}

async function runAccountOp(
  input: unknown,
  fn: (args: {
    targetUserId: string;
    actorUserId: string;
    reason: string;
  }) => Promise<void>,
  label: string,
  /** Tells the account holder after the op succeeds. The reason stays internal. */
  noticeKind: "account_disabled" | "account_restored" | "account_secured",
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = accountOpsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Enter a reason of at least 8 characters.",
    };
  }

  try {
    await fn({
      targetUserId: parsed.data.targetUserId,
      actorUserId: admin.userId,
      reason: parsed.data.reason,
    });
    revalidateAccountViews(parsed.data.targetUserId);
    const { targetUserId } = parsed.data;
    after(() => notifyAdminAction(targetUserId, { kind: noticeKind }));
    return { ok: true };
  } catch (error) {
    if (error instanceof AccountOpsError) {
      return { ok: false, message: error.message };
    }
    logger.error(`[admin] ${label}`, { error: String(error) });
    return { ok: false, message: "Could not update this account." };
  }
}

export async function disableAccountAction(
  input: unknown,
): Promise<ActionResult> {
  return runAccountOp(
    input,
    disableAccount,
    "disableAccountAction",
    "account_disabled",
  );
}

export async function restoreAccountAction(
  input: unknown,
): Promise<ActionResult> {
  return runAccountOp(
    input,
    restoreAccount,
    "restoreAccountAction",
    "account_restored",
  );
}

export async function secureAccountAction(
  input: unknown,
): Promise<ActionResult> {
  return runAccountOp(
    input,
    secureAccount,
    "secureAccountAction",
    "account_secured",
  );
}
