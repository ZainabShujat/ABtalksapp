"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { sendRecruiterWelcomeEmail } from "@/features/notification/recruiter-welcome-email";
import { prisma, writeClient } from "@/lib/db";
import { logger, safeErrorMessage } from "@/lib/logger";
import { requireAdmin } from "@/lib/admin-auth";
import { hashPassword } from "@/lib/password";
import { isEmailLoginEnabled } from "@/lib/feature-flags";
import { createRecruiterAccount } from "@/features/admin/create-recruiter";
import { generateRecruiterPassword } from "@/features/admin/generate-password";
import {
  isCompanyLogoStorageConfigured,
  readLogoUpload,
  storeCompanyLogoFile,
} from "@/features/hire/org-logo-storage";
import { createRecruiterSchema } from "@/lib/validations/admin-recruiter";
import {
  DeleteRecruiterError,
  purgeRecruiterAccount,
} from "@/features/hire/delete-recruiter-account";
import {
  deleteCompanyLogoBlob,
  isOurCompanyLogoUrl,
} from "@/features/hire/org-logo-storage";

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

/**
 * What the admin is shown once, and only once.
 *
 * `password` is not logged, not persisted and not written to the audit row.
 * It IS emailed once to the new recruiter in the welcome mail
 * (features/notification/recruiter-welcome-email.ts), alongside a prompt to
 * change it after the first sign-in — a product decision that deliberately
 * reverses the earlier "admin is the only delivery channel" design, pending
 * security-owner review. The mail redacts the password from any error it
 * logs, and omits it entirely when password sign-in is off.
 */
export type CreatedRecruiter = {
  userId: string;
  email: string;
  password: string;
  logoAttached: boolean;
  logoMessage: string | null;
};

/** Form fields that are optional text: "" from a form input means "not set". */
function text(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Create a recruiter account from /admin/recruiters (plan 159).
 *
 * Admin-only, and the admin comes from the session — no user id, organization
 * id or role is accepted from the client. FormData rather than a plain object
 * because the company logo travels with it.
 */
export async function createRecruiterAction(
  formData: FormData,
): Promise<ActionResult<CreatedRecruiter>> {
  const admin = await requireAdmin();

  const parsed = createRecruiterSchema.safeParse({
    fullName: text(formData, "fullName") ?? "",
    email: text(formData, "email") ?? "",
    phone: text(formData, "phone") ?? null,
    companyName: text(formData, "companyName") ?? "",
    website: text(formData, "website") ?? null,
    industry: text(formData, "industry") ?? null,
    companySize: text(formData, "companySize") ?? null,
    location: text(formData, "location") ?? null,
    passwordMode: formData.get("passwordMode") === "manual" ? "manual" : "generate",
    password: text(formData, "password"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check the form.",
    };
  }

  const input = parsed.data;

  // Same refusal registerRecruiterWithOtpAction gives: a password that cannot
  // be used to sign in should not be quietly accepted. A generated one is still
  // allowed — the form explains that the recruiter will use an emailed code.
  if (input.passwordMode === "manual" && !isEmailLoginEnabled()) {
    return {
      ok: false,
      message: "Passwords aren't available yet. Choose 'Generate a password'.",
    };
  }

  // Branch on the MODE, not on whether a password happens to be present.
  // `input.password ?? generate()` would accept a `password` field posted
  // alongside passwordMode=generate — and superRefine only runs passwordSchema
  // for `manual`, so that value would never have met the 8-character minimum.
  let password: string;
  if (input.passwordMode === "manual") {
    if (!input.password) {
      return { ok: false, message: "Enter a password." };
    }
    password = input.password;
  } else {
    password = generateRecruiterPassword();
  }

  // Hashed BEFORE the transaction: scrypt is deliberately slow (~32 MiB) and
  // must not eat into the commit window below.
  let passwordHash: string;
  try {
    passwordHash = await hashPassword(password);
  } catch (error) {
    logger.error("[admin] recruiter password hash failed", {
      adminUserId: admin.userId,
      error: safeErrorMessage(error),
    });
    return { ok: false, message: "Could not create the account. Try again." };
  }

  let created;
  try {
    created = await createRecruiterAccount({
      ...input,
      adminUserId: admin.userId,
      passwordHash,
    });
  } catch (error) {
    logger.error("[admin] createRecruiterAction", {
      adminUserId: admin.userId,
      error: safeErrorMessage(error),
    });
    return { ok: false, message: "Could not create the account. Try again." };
  }
  if (!created.ok) return created;

  // The logo is attached after the commit, and its failure never undoes the
  // account: a blob upload cannot live inside a database transaction, and an
  // admin who typed everything correctly should not lose it to a storage
  // hiccup. An unattached logo is reported, and can be set from /hire/settings.
  let logoAttached = false;
  let logoMessage: string | null = null;
  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    const result = await attachLogo(created.organizationId, logo);
    logoAttached = result.ok;
    logoMessage = result.ok ? null : result.message;
  }

  revalidatePath("/admin/recruiters");
  revalidatePath("/admin/actions");

  // Welcome mail with sign-in details, after the response. Never throws, so
  // a mail failure cannot undo or fail the account the admin just created.
  const welcome = {
    to: input.email.trim().toLowerCase(),
    fullName: input.fullName,
    companyName: input.companyName,
    password,
    passwordLoginEnabled: isEmailLoginEnabled(),
  };
  after(() => sendRecruiterWelcomeEmail(welcome));

  return {
    ok: true,
    data: {
      userId: created.userId,
      email: input.email.trim().toLowerCase(),
      password,
      logoAttached,
      logoMessage,
    },
  };
}

async function attachLogo(
  organizationId: string,
  file: File,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isCompanyLogoStorageConfigured()) {
    return {
      ok: false,
      message: "Logo storage isn't configured, so the logo wasn't saved.",
    };
  }

  const upload = await readLogoUpload(file);
  if (!upload.ok) return upload;

  try {
    const url = await storeCompanyLogoFile({
      organizationId,
      contentHash: upload.contentHash,
      ext: upload.ext,
      bytes: upload.bytes,
      mimeType: upload.mime,
    });
    if (!url) {
      return { ok: false, message: "The logo could not be stored." };
    }
    await prisma.organization.update({
      where: { id: organizationId },
      data: { logoUrl: url },
      select: { id: true },
    });
    return { ok: true };
  } catch (error) {
    logger.error("[admin] recruiter logo attach failed", {
      organizationId,
      error: safeErrorMessage(error),
    });
    return { ok: false, message: "The logo could not be stored." };
  }
}

const deleteRecruiterSchema = z.object({
  targetUserId: z.string().min(1),
  confirm: z.literal("DELETE"),
  // The same floor accountOpsSchema sets for every other destructive admin op.
  reason: z.string().trim().min(8, "Give a reason of at least 8 characters.").max(500),
});

/**
 * An admin permanently deletes a recruiter account (plan 160).
 *
 * Unlike the self-service path this is not blocked by a purchased credit
 * balance — an admin closing an account is exactly the case where a forfeiture
 * is a deliberate decision, and the audit row records the amount.
 */
export async function deleteRecruiterAccountAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const admin = await requireAdmin();

  const parsed = deleteRecruiterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ??
        'Type "DELETE" and give a reason to confirm.',
    };
  }

  const { targetUserId, reason } = parsed.data;

  let logoUrl: string | null = null;
  try {
    const result = await writeClient().$transaction(
      async (tx) =>
        purgeRecruiterAccount(tx, {
          userId: targetUserId,
          actorUserId: admin.userId,
          byAdmin: true,
          reason,
        }),
      { maxWait: 20_000, timeout: 30_000 },
    );
    logoUrl = result.logoUrl;
  } catch (error) {
    if (error instanceof DeleteRecruiterError) {
      return { ok: false, message: error.message };
    }
    logger.error("[admin] deleteRecruiterAccountAction", {
      adminUserId: admin.userId,
      error: safeErrorMessage(error),
    });
    return { ok: false, message: "Could not delete this account." };
  }

  if (logoUrl && isOurCompanyLogoUrl(logoUrl)) {
    await deleteCompanyLogoBlob(logoUrl);
  }

  revalidatePath("/admin/recruiters");
  revalidatePath("/admin/actions");
  return { ok: true };
}
