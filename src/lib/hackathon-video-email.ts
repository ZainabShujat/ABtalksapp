import "server-only";
import { VIDEOTHON } from "@/features/hackathon-video/config";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.abtalks.in";
const logoUrl = `${appUrl}/abtalks-logo.png`;

const C = {
  text: "#353535",
  muted: "#626262",
  soft: "#8F8F8F",
  accent: "#111111",
  border: "#E9E9E9",
  panel: "#F4F4F4",
};

/**
 * VideoThon welcome email. Simpler than the code hackathon's four-variant
 * pipeline (leader/member/join) because VideoThon is solo-only — one email,
 * one path. Failures are logged and never block registration.
 */
export async function sendVideoWelcomeEmail(
  fullName: string,
  email: string,
): Promise<void> {
  const firstName = (fullName.split(" ")[0] ?? fullName).trim() || "there";
  const whatsappBlock = VIDEOTHON.whatsappLink
    ? `
      <p style="margin:16px 0 0;font-size:15px;color:${C.text};">
        Next step: join the WhatsApp group so you don't miss the kickoff or the brief drop.
      </p>
      <p style="margin:14px 0 0;">
        <a href="${VIDEOTHON.whatsappLink}" style="display:inline-block;background:#25D366;color:#ffffff;padding:12px 22px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:700;">
          Join the WhatsApp group
        </a>
      </p>`
    : "";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:${C.panel};font-family:Inter,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.panel};padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 14px rgba(0, 0, 0, 0.06);">
        <tr>
          <td style="background:#0A0A0A;padding:30px 32px;text-align:center;">
            <img src="${logoUrl}" alt="ABTalks" width="140" style="display:block;margin:0 auto;height:auto;max-width:140px;border:0;outline:none;text-decoration:none;" />
            <p style="color:rgba(255,255,255,0.75);font-size:13px;letter-spacing:2px;margin:14px 0 0;text-transform:uppercase;">${VIDEOTHON.name}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;color:${C.text};font-size:15px;line-height:1.7;">
            <p style="margin:0 0 12px;font-size:18px;font-weight:600;color:${C.accent};">Hi ${firstName},</p>
            <p style="margin:0 0 12px;">You're in for ${VIDEOTHON.name}. ${VIDEOTHON.tagline}</p>
            <p style="margin:12px 0 0;">
              Kickoff: <strong>${VIDEOTHON.kickoffLabel}</strong><br>
              Deadline: <strong>${VIDEOTHON.deadlineLabel}</strong><br>
              Results: <strong>${VIDEOTHON.resultsLabel}</strong>
            </p>
            ${whatsappBlock}
            <p style="margin:26px 0 0;font-size:15px;color:${C.text};">See you there,<br><strong>Team ABTalks</strong></p>
          </td>
        </tr>
        <tr>
          <td style="background-color:#FFFFFF;padding:22px 32px;text-align:center;border-top:1px solid ${C.border};">
            <p style="margin:0;font-size:12px;color:${C.soft};letter-spacing:0.5px;text-transform:uppercase;">
              You registered as ${email}. Reply to this email if that's a mistake.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Hi ${firstName},`,
    "",
    `You're in for ${VIDEOTHON.name}. ${VIDEOTHON.tagline}`,
    "",
    `Kickoff: ${VIDEOTHON.kickoffLabel}`,
    `Deadline: ${VIDEOTHON.deadlineLabel}`,
    `Results: ${VIDEOTHON.resultsLabel}`,
    VIDEOTHON.whatsappLink
      ? `\nJoin the WhatsApp group: ${VIDEOTHON.whatsappLink}`
      : "",
    "",
    "— Team ABTalks",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    await sendEmail({
      to: email,
      toName: fullName,
      subject: `You're in — ${VIDEOTHON.name}`,
      html,
      text,
    });
  } catch (error) {
    logger.error("videothon welcome email failed", { error, email });
  }
}
