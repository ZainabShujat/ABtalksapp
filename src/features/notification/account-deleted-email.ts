import "server-only";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { ACCOUNT_NOTICE_HEADERS } from "./email-delivery";

/**
 * Confirmation mail after a candidate deletes their own account from
 * /profile. The user row is already gone when this runs, so the caller
 * captures the address and name before the delete. Never throws.
 */
export async function sendAccountDeletedEmail(input: {
  to: string;
  name: string | null;
}): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://abtalks.in";
  const firstName = input.name?.trim().split(/\s+/)[0] || "there";
  const subject = "Your ABTalks account has been deleted";

  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const html = `<div style="font-family: Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
  <p style="color: #353535;">Hi ${esc(firstName)},</p>
  <h2 style="color: #000000; margin: 16px 0 8px;">Your account has been deleted</h2>
  <p style="color: #353535;">As you requested, your ABTalks account for <strong>${esc(input.to)}</strong> and the data linked to it have been removed. You will no longer appear to recruiters, and we will not send you any more updates about this account.</p>
  <p style="color: #353535;">Thank you for the time you spent with us. If you ever want to come back, you are welcome to sign up again at <a href="${esc(baseUrl)}" style="color: #03535F;">${esc(baseUrl.replace(/^https?:\/\//, ""))}</a>.</p>
  <p style="color: #353535;"><strong>Did not do this?</strong> Reply to this email straight away and we will help.</p>
  <hr style="border: none; border-top: 1px solid #E9E9E9; margin: 24px 0;" />
  <p style="color: #A5A5A5; font-size: 12px;">This is a service message about your ABTalks account.</p>
</div>`;

  const text = `Hi ${firstName},

Your account has been deleted

As you requested, your ABTalks account for ${input.to} and the data linked to it have been removed. You will no longer appear to recruiters, and we will not send you any more updates about this account.

Thank you for the time you spent with us. If you ever want to come back, you are welcome to sign up again at ${baseUrl}.

Did not do this? Reply to this email straight away and we will help.

---
This is a service message about your ABTalks account.`;

  try {
    const result = await sendEmail({
      to: input.to,
      toName: input.name ?? undefined,
      subject,
      html,
      text,
      bulk: false,
      headers: ACCOUNT_NOTICE_HEADERS,
      kind: "account.self_deleted",
    });
    if (!result.ok && !result.skipped) {
      logger.warn("account-deleted.email_failed", {
        deliveryId: result.deliveryId,
      });
    }
  } catch (err) {
    logger.warn("account-deleted.email_threw", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
