import { BrevoClient } from "@getbrevo/brevo";

const brevoApiKey = process.env.BREVO_API_KEY!;
const fromEmail = process.env.FROM_EMAIL || "team@abtalks.in";
const fromName = process.env.FROM_NAME || "ABTalks";
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.abtalks.in";
const logoUrl = `${appUrl}/abtalks-logo.png`;

const brevoClient = new BrevoClient({ apiKey: brevoApiKey });

export async function sendWorkshopConfirmationEmail(
  name: string,
  email: string,
  config: { zoomLink: string; whatsappLink: string; webinarDate: string; webinarTime: string }
): Promise<void> {
  const { zoomLink, whatsappLink, webinarDate, webinarTime } = config;

  // The seeded fallback config uses "#" as a placeholder. Rendering that as a
  // button gives registrants a dead link, so show a note instead.
  const hasZoomLink = Boolean(zoomLink) && zoomLink !== "#";

  const joinBlock = hasZoomLink
    ? `
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <a href="${zoomLink}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:50px;font-size:15px;font-weight:600;">
                      Join the YouTube Live stream
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 16px;">
                Save this email. The same link gets you in on the day, and we'd suggest joining 5 to 10 minutes early so you don't miss the start.
              </p>`
    : `
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f3ff;border-radius:12px;margin-bottom:24px;">
                <tr><td style="padding:20px;">
                  <p style="color:#4c1d95;font-size:14px;line-height:1.6;margin:0;">
                    <strong>Your YouTube Live link is on its way.</strong><br>
                    We'll email it to this address before the session. Keep an eye on your inbox and join 5 to 10 minutes early.
                  </p>
                </td></tr>
              </table>`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f9fafb;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.05);">
          <tr>
            <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center;">
              <img src="${logoUrl}" alt="ABTalks" width="150" style="display:block;margin:0 auto;height:auto;max-width:150px;border:0;outline:none;text-decoration:none;" />
              <p style="color:rgba(255,255,255,0.9);font-size:14px;margin:10px 0 0;">AI Workshop</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h2 style="color:#1a1a1a;font-size:22px;margin:0 0 8px;">You're registered</h2>
              <p style="color:#666;font-size:15px;line-height:1.6;margin:0 0 24px;">
                Hi <strong>${name}</strong>,<br><br>
                Your seat at the <strong>ABTalks AI Workshop</strong> is confirmed. Here's everything you need for the day.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f3ff;border-radius:12px;margin-bottom:24px;">
                <tr><td style="padding:24px;">
                  <h3 style="color:#6366f1;font-size:16px;margin:0 0 16px;">Session details</h3>
                  <p style="color:#333;font-size:14px;line-height:2;margin:0;">
                    <strong>Date:</strong> ${webinarDate}<br>
                    <strong>Time:</strong> ${webinarTime}<br>
                    <strong>Platform:</strong> YouTube Live<br>
                    <strong>Cost:</strong> Free
                  </p>
                </td></tr>
              </table>
${joinBlock}
              <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 8px;">
                <strong>Come prepared.</strong> It's a hands-on session, so join from a laptop if you can and have the tools we'll be using open and ready.
              </p>
              <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 24px;">
                Join our <a href="${whatsappLink}" style="color:#6366f1;font-weight:600;">WhatsApp community</a> for the reminder, session resources, and news of future workshops.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#fafafa;padding:24px;text-align:center;border-top:1px solid #eee;">
              <p style="color:#999;font-size:13px;margin:0;">Can't make it? Just reply to this email and let us know.</p>
              <p style="color:#666;font-size:14px;font-weight:600;margin:8px 0 0;">Team ABTalks</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await brevoClient.transactionalEmails.sendTransacEmail({
    sender: { name: fromName, email: fromEmail },
    to: [{ email, name }],
    subject: "You're registered for the FREE ABTalks AI Workshop",
    htmlContent: html,
  });
}
