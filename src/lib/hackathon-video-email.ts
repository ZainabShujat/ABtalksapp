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
            <div style="display:inline-block;padding:5px 12px;background:#F0FBEE;color:#1F7A3A;border:1px solid #C7E7CB;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:0 0 14px;">✓ Registration confirmed</div>
            <p style="margin:0 0 12px;font-size:22px;font-weight:700;color:${C.accent};line-height:1.2;">Hi ${firstName}, you're in.</p>
            <p style="margin:0 0 16px;color:${C.text};">${VIDEOTHON.tagline}</p>
            <div style="margin:18px 0 0;padding:16px 18px;background:${C.panel};border-radius:10px;border:1px solid ${C.border};">
              <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${C.soft};">Event window</p>
              <p style="margin:8px 0 0;color:${C.text};line-height:1.7;">
                <strong>Kickoff</strong> · ${VIDEOTHON.kickoffLabel}<br>
                <strong>Deadline</strong> · ${VIDEOTHON.deadlineLabel}<br>
                <strong>Results</strong> · ${VIDEOTHON.resultsLabel}
              </p>
            </div>
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
    `REGISTRATION CONFIRMED · ${VIDEOTHON.name}`,
    "",
    `Hi ${firstName}, you're in.`,
    VIDEOTHON.tagline,
    "",
    "EVENT WINDOW",
    `Kickoff · ${VIDEOTHON.kickoffLabel}`,
    `Deadline · ${VIDEOTHON.deadlineLabel}`,
    `Results · ${VIDEOTHON.resultsLabel}`,
    VIDEOTHON.whatsappLink
      ? `\nJoin the WhatsApp group so you don't miss the brief:\n${VIDEOTHON.whatsappLink}`
      : "",
    "",
    "See you there,",
    "Team ABTalks",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    await sendEmail({
      to: email,
      toName: fullName,
      subject: `Registration confirmed · ${VIDEOTHON.name} on ${VIDEOTHON.kickoffLabel.split(" · ")[0] || "kickoff day"}`,
      html,
      text,
    });
  } catch (error) {
    logger.error("videothon welcome email failed", { error, email });
  }
}
