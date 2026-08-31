import "server-only";
import { BrevoClient } from "@getbrevo/brevo";
import { logger } from "@/lib/logger";

/**
 * Transactional mail, through Brevo.
 *
 * This used to call Resend, and nothing that reaches it ever sent: `RESEND_API_KEY`
 * is not configured anywhere, so every caller was quietly taking the
 * `skipped: true` branch. That is five paths, three of them recruiter-facing —
 * the sign-in code, the admin's approval mail and the hire alert — plus the
 * contact form and DSAR notifications. In development the recruiter one hides
 * behind `otpDevFallbackEnabled`, which prints the code to the log instead, so
 * the failure only showed up in production, where nobody could sign in and
 * nothing said why.
 *
 * Brevo is the provider this project actually has credentials for and already
 * uses for the workshop, hackathon and challenge-reset mail. One provider
 * beats two, and beats one that is only configured on paper.
 *
 * The interface is unchanged, so no caller moves.
 */

const FROM_EMAIL = process.env.FROM_EMAIL || "team@abtalks.in";
const FROM_NAME = process.env.FROM_NAME || "ABTalks";
const REPLY_TO = process.env.REPLY_TO_EMAIL || FROM_EMAIL;

export type SendEmailResult =
  | { ok: true }
  | { ok: false; skipped?: boolean };

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer }[];
}): Promise<SendEmailResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    logger.warn("[email] BREVO_API_KEY missing — skipping send");
    return { ok: false, skipped: true };
  }
  // Never email seed/test accounts (avoid bounces hurting domain reputation).
  if (opts.to.toLowerCase().endsWith("@abtalks.dev")) {
    logger.info("[email] skipping test address");
    return { ok: false, skipped: true };
  }

  try {
    const brevo = new BrevoClient({ apiKey });
    await brevo.transactionalEmails.sendTransacEmail({
      sender: { name: FROM_NAME, email: FROM_EMAIL },
      replyTo: { email: REPLY_TO },
      to: [{ email: opts.to }],
      subject: opts.subject,
      htmlContent: opts.html,
      textContent: opts.text,
      // Brevo wants base64, not a Buffer. No caller passes attachments today,
      // but the signature offered them, and a silently dropped attachment is
      // worse than one that was never offered.
      ...(opts.attachments?.length
        ? {
            attachment: opts.attachments.map((a) => ({
              name: a.filename,
              content: a.content.toString("base64"),
            })),
          }
        : {}),
    });
    return { ok: true };
  } catch (e) {
    logger.error("[email] send threw", { error: String(e) });
    return { ok: false };
  }
}
