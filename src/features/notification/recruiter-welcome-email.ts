import "server-only";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { ACCOUNT_NOTICE_HEADERS } from "./email-delivery";

/**
 * Welcome mail for a recruiter account an admin created on /admin/recruiters.
 *
 * Carries the sign-in email, the password (when password sign-in is on) and
 * a clear instruction to change it after the first sign-in. The admin still
 * sees the password once in the panel as before; this is a second delivery
 * channel, requested by the product owner and reviewed by the security
 * owner (see the note on CreatedRecruiter in admin-recruiter-actions.ts).
 *
 * When password sign-in is off (ENABLE_EMAIL_LOGIN != "true") a password
 * cannot be used, so the mail explains the emailed-code sign-in instead and
 * does not include it.
 *
 * The password never reaches a log line: only `sendEmail`'s redacted
 * delivery record is written. Never throws.
 */
export async function sendRecruiterWelcomeEmail(input: {
  to: string;
  fullName: string;
  companyName: string;
  password: string;
  passwordLoginEnabled: boolean;
}): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://abtalks.in";
  const signInUrl = `${baseUrl}/recruiter-onboarding/signin`;
  const settingsUrl = `${baseUrl}/hire/settings`;
  const firstName = input.fullName.trim().split(/\s+/)[0] || "there";
  const subject = `Welcome to ABTalks Hire, your ${input.companyName} recruiter account is ready`;

  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const credentialsHtml = input.passwordLoginEnabled
    ? `<table role="presentation" style="border-collapse: collapse; margin: 8px 0 16px;">
    <tr><td style="padding: 4px 16px 4px 0; color: #6B6B6B;">Email</td><td style="padding: 4px 0; color: #000000;"><strong>${esc(input.to)}</strong></td></tr>
    <tr><td style="padding: 4px 16px 4px 0; color: #6B6B6B;">Password</td><td style="padding: 4px 0; color: #000000; font-family: ui-monospace, Menlo, Consolas, monospace;"><strong>${esc(input.password)}</strong></td></tr>
  </table>
  <p style="color: #353535;"><strong>Please change this password after you sign in:</strong> go to Settings &rarr; Manage password (${esc(settingsUrl)}).</p>`
    : `<table role="presentation" style="border-collapse: collapse; margin: 8px 0 16px;">
    <tr><td style="padding: 4px 16px 4px 0; color: #6B6B6B;">Email</td><td style="padding: 4px 0; color: #000000;"><strong>${esc(input.to)}</strong></td></tr>
  </table>
  <p style="color: #353535;">To sign in, enter this email on the sign-in page and we will send you a one-time code.</p>`;

  const html = `<div style="font-family: Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
  <p style="color: #353535;">Hi ${esc(firstName)},</p>
  <h2 style="color: #000000; margin: 16px 0 8px;">Your recruiter account is ready</h2>
  <p style="color: #353535;">The ABTalks team has set up a recruiter account for you at <strong>${esc(input.companyName)}</strong>. You can use it to search candidates, post jobs and manage your hiring pipeline.</p>
  <p style="color: #353535; margin-bottom: 4px;"><strong>Your sign-in details</strong></p>
  ${credentialsHtml}
  <p><a href="${esc(signInUrl)}" style="color: #03535F;">Sign in to ABTalks Hire &rarr;</a></p>
  <p style="color: #353535;"><strong>Getting started</strong></p>
  <ol style="color: #353535; padding-left: 20px; margin: 0 0 16px;">
    <li>Sign in and check your company profile under Settings.</li>
    <li>Post your first job from Jobs, or search for candidates from Home.</li>
    <li>Move candidates through your Pipeline as you hire.</li>
  </ol>
  <p style="color: #353535;">Keep these details private. If you did not expect this email or have questions, just reply to it.</p>
  <hr style="border: none; border-top: 1px solid #E9E9E9; margin: 24px 0;" />
  <p style="color: #A5A5A5; font-size: 12px;">This is a service message about your ABTalks account.</p>
</div>`;

  const credentialsText = input.passwordLoginEnabled
    ? `Email:    ${input.to}\nPassword: ${input.password}\n\nPlease change this password after you sign in: Settings -> Manage password (${settingsUrl}).`
    : `Email: ${input.to}\n\nTo sign in, enter this email on the sign-in page and we will send you a one-time code.`;

  const text = `Hi ${firstName},

Your recruiter account is ready

The ABTalks team has set up a recruiter account for you at ${input.companyName}. You can use it to search candidates, post jobs and manage your hiring pipeline.

Your sign-in details
${credentialsText}

Sign in: ${signInUrl}

Getting started
1. Sign in and check your company profile under Settings.
2. Post your first job from Jobs, or search for candidates from Home.
3. Move candidates through your Pipeline as you hire.

Keep these details private. If you did not expect this email or have questions, just reply to it.

---
This is a service message about your ABTalks account.`;

  try {
    const result = await sendEmail({
      to: input.to,
      toName: input.fullName,
      subject,
      html,
      text,
      bulk: false,
      headers: ACCOUNT_NOTICE_HEADERS,
      kind: "recruiter.welcome",
      // Keep the password out of any error that gets logged / sent to Sentry.
      redact: [input.password],
    });
    if (!result.ok && !result.skipped) {
      logger.warn("recruiter-welcome.email_failed", {
        deliveryId: result.deliveryId,
      });
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    logger.warn("recruiter-welcome.email_threw", {
      err: input.password ? raw.split(input.password).join("[redacted]") : raw,
    });
  }
}
