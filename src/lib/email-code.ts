import "server-only";

import { createHash, randomInt, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { assertRateLimit } from "@/lib/rate-limit";

/*
 * Emailed one-time codes (plan 154).
 *
 * This began as the recruiter sign-in OTP (`features/recruiter-auth/otp.ts`,
 * which now delegates here). Candidates' sign-in and everyone's password
 * set / reset use the same table, hashing, expiry and attempt budget; the
 * `purpose` column is what keeps a code for one job from being spent on
 * another.
 */

const CODE_LENGTH = 6;
export const EMAIL_CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

export type EmailCodePurpose =
  /** Recruiter sign-in. The stored value predates plan 154. */
  | "login"
  /** Recruiter registration. */
  | "register"
  | "candidate-login"
  | "password-reset";

const PURPOSES: readonly EmailCodePurpose[] = [
  "login",
  "register",
  "candidate-login",
  "password-reset",
];

function isPurpose(value: string): value is EmailCodePurpose {
  return (PURPOSES as readonly string[]).includes(value);
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * sha256(value + AUTH_SECRET).
 *
 * The column is `codeHash`, and it means it — a plaintext code in the database
 * is a password in the database. The secret is a pepper: without it, a stolen
 * table plus six digits of search space is no protection at all.
 */
function pepperedHash(value: string): string {
  return createHash("sha256")
    .update(`${value}${process.env.AUTH_SECRET ?? ""}`)
    .digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Rate-limit subject for an address. Hashed so `RateLimitEvent` never holds an
 * email — the anonymizer does not know that table exists.
 */
export function emailRateLimitSubject(email: string): string {
  return `email:${pepperedHash(normaliseEmail(email)).slice(0, 32)}`;
}

/**
 * The dev escape hatch: show the code instead of emailing it.
 *
 * Both conditions, always. A deployed environment that happens to be missing
 * the mail key must not start handing out other people's sign-in codes, so
 * the NODE_ENV check is the one that actually protects this — the missing key
 * only decides whether it is *needed*.
 */
export function otpDevFallbackEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.BREVO_API_KEY;
}

export type IssueEmailCodeResult =
  | {
      ok: true;
      /**
       * The plaintext code, returned to the *server* caller so it can be
       * emailed. It must never be put in a Server Action response outside the
       * dev fallback — see `deliverEmailCode`.
       */
      code: string;
    }
  | {
      ok: false;
      reason: "rate-limited";
      /** The limiter's own words — a real quota, or the limiter being down. */
      message: string;
    };

/**
 * Create a code for an email. One live code per address: issuing deletes any
 * older one, whatever its purpose.
 *
 * Callers decide whether the address may have a code at all; this only
 * enforces how many it may have.
 */
export async function issueEmailCode(
  rawEmail: string,
  purpose: EmailCodePurpose,
): Promise<IssueEmailCodeResult> {
  const email = normaliseEmail(rawEmail);

  // Counted in RateLimitEvent, not on this table: every issue deletes the
  // previous row, so a count here could never exceed one.
  const allowed = await assertRateLimit({
    bucket: "EMAIL_CODE_ADDRESS",
    subjectId: emailRateLimitSubject(email),
  });
  if (!allowed.ok) {
    return { ok: false, reason: "rate-limited", message: allowed.message };
  }

  // randomInt, not Math.random: this is a credential, however short-lived.
  const code = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(
    CODE_LENGTH,
    "0",
  );

  await prisma.$transaction([
    // One live code per email. An older one lying around is a second key.
    prisma.recruiterEmailOtp.deleteMany({ where: { email } }),
    prisma.recruiterEmailOtp.create({
      data: {
        email,
        codeHash: pepperedHash(code),
        purpose,
        expiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MINUTES * 60_000),
      },
      select: { id: true },
    }),
  ]);

  return { ok: true, code };
}

export type VerifyEmailCodeResult =
  | { ok: true; email: string; purpose: EmailCodePurpose }
  | { ok: false; reason: "invalid" | "expired" | "too-many" };

/**
 * Check a code. By default it is consumed: deleted on success, so one code
 * buys one sign-in. Deleted after the attempt budget too — a code someone is
 * guessing at is a code that should stop existing.
 *
 * `purposes` is the set this caller accepts. A code issued for anything else
 * is treated as a wrong code, attempt counted, so a sign-in code can never
 * reset a password and a reset code can never open a session.
 *
 * `{ consume: false }` peeks: recruiter registration verifies, writes the
 * account, then spends the same digits on `signIn("recruiter-otp")`.
 */
export async function verifyEmailCode(
  rawEmail: string,
  code: string,
  opts: { purposes: readonly EmailCodePurpose[]; consume?: boolean },
): Promise<VerifyEmailCodeResult> {
  const consume = opts.consume !== false;
  const email = normaliseEmail(rawEmail);

  const row = await prisma.recruiterEmailOtp.findFirst({
    where: { email },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      codeHash: true,
      purpose: true,
      attempts: true,
      expiresAt: true,
    },
  });
  if (!row) return { ok: false, reason: "invalid" };

  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.recruiterEmailOtp.delete({ where: { id: row.id } });
    return { ok: false, reason: "expired" };
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    await prisma.recruiterEmailOtp.delete({ where: { id: row.id } });
    return { ok: false, reason: "too-many" };
  }

  const purposeAccepted =
    isPurpose(row.purpose) && opts.purposes.includes(row.purpose);
  if (!purposeAccepted || !safeEqual(pepperedHash(code.trim()), row.codeHash)) {
    const next = row.attempts + 1;
    if (next >= MAX_ATTEMPTS) {
      await prisma.recruiterEmailOtp.delete({ where: { id: row.id } });
      return { ok: false, reason: "too-many" };
    }
    await prisma.recruiterEmailOtp.update({
      where: { id: row.id },
      data: { attempts: next },
      select: { id: true },
    });
    return { ok: false, reason: "invalid" };
  }

  if (consume) {
    await prisma.recruiterEmailOtp.delete({ where: { id: row.id } });
  }
  return { ok: true, email, purpose: row.purpose as EmailCodePurpose };
}

/** User-facing sentence for a failed verification. */
export function emailCodeFailureMessage(
  reason: "invalid" | "expired" | "too-many",
): string {
  if (reason === "too-many") return "Too many wrong codes. Request a new one.";
  if (reason === "expired") return "That code expired. Request a new one.";
  return "That code isn't right.";
}

/** Housekeeping for expired rows; safe to call from anywhere. */
export async function purgeExpiredEmailCodes(): Promise<number> {
  try {
    const { count } = await prisma.recruiterEmailOtp.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return count;
  } catch (error) {
    logger.error("[email-code] purgeExpiredEmailCodes", {
      error: String(error),
    });
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/**
 * Which email to send. `recruiter-signin` is byte-for-byte the plan 152
 * recruiter template; do not reword it without re-checking deliverability.
 */
export type EmailCodeVariant = "recruiter-signin" | "signin" | "password";

type TemplateCopy = {
  kind: string;
  tags: string[];
  subject: (code: string) => string;
  title: string;
  label: string;
  preheader: (code: string) => string;
  introHtml: string;
  introText: string;
  codeLabel: string;
  ignoreHtml: string;
  ignoreText: string;
  footerReason: string;
};

const SIGNIN_COPY: Omit<TemplateCopy, "kind" | "tags" | "label"> = {
  // Plan 152: code in the subject line. Gmail's snippet expansion shows it
  // one-tap-copy, and modern spam filters treat "code: NNNNNN" as clearly
  // transactional. The word "verification" is spam-heavy and is dropped;
  // "sign-in code" reads the same to a human and better to a filter.
  subject: (code) => `Your ABTalks sign-in code is ${code}`,
  title: "Your ABTalks sign-in code",
  preheader: (code) =>
    `Use ${code} to sign in to ABTalks. It expires in ${EMAIL_CODE_TTL_MINUTES} minutes.`,
  introHtml: `Enter this code on the sign-in screen to continue. The code is valid for the next ${EMAIL_CODE_TTL_MINUTES} minutes.`,
  introText: "Enter this code on the sign-in screen to continue:",
  codeLabel: "Sign-in code",
  ignoreHtml:
    "If you didn&rsquo;t try to sign in to ABTalks, you can safely ignore this email &mdash; no changes have been made to any account.",
  ignoreText:
    "If you didn't try to sign in to ABTalks, you can safely ignore this email — no changes have been made to any account.",
  footerReason: "someone requested a sign-in code for this address",
};

const COPY: Record<EmailCodeVariant, TemplateCopy> = {
  "recruiter-signin": {
    ...SIGNIN_COPY,
    kind: "recruiter.otp",
    tags: ["recruiter-otp", "transactional"],
    label: "Recruiter sign-in",
  },
  signin: {
    ...SIGNIN_COPY,
    kind: "auth.signin_code",
    tags: ["signin-code", "transactional"],
    label: "Sign in",
  },
  password: {
    kind: "auth.password_code",
    tags: ["password-code", "transactional"],
    subject: (code) => `Your ABTalks password code is ${code}`,
    title: "Your ABTalks password code",
    label: "Password",
    preheader: (code) =>
      `Use ${code} to set your ABTalks password. It expires in ${EMAIL_CODE_TTL_MINUTES} minutes.`,
    introHtml: `Enter this code to set a new password for your ABTalks account. The code is valid for the next ${EMAIL_CODE_TTL_MINUTES} minutes.`,
    introText: "Enter this code to set a new password for your ABTalks account:",
    codeLabel: "Password code",
    ignoreHtml:
      "If you didn&rsquo;t ask to set or reset your ABTalks password, you can safely ignore this email &mdash; your password has not been changed.",
    ignoreText:
      "If you didn't ask to set or reset your ABTalks password, you can safely ignore this email — your password has not been changed.",
    footerReason: "someone requested a password code for this address",
  },
};

/**
 * Send a code. The code leaves the server exactly one way: by email in
 * production, or back to the caller in development when there is no mail
 * provider configured (`devCode`, shown on screen).
 */
export async function deliverEmailCode(
  email: string,
  code: string,
  variant: EmailCodeVariant,
): Promise<{ devCode?: string }> {
  const copy = COPY[variant];
  if (otpDevFallbackEnabled()) {
    // Never logged next to the address: a one-time credential and a private
    // email on one line is what T-259 forbids.
    logger.warn(
      { event: `${copy.kind}.dev_fallback` },
      "Code returned to the caller instead of emailed (dev fallback)",
    );
    return { devCode: code };
  }
  await sendEmail({
    to: email,
    kind: copy.kind,
    tags: copy.tags,
    subject: copy.subject(code),
    html: renderCodeHtml(copy, code),
    text: renderCodeText(copy, code),
  });
  return {};
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.abtalks.in";
const LOGO_URL = `${APP_URL}/abtalks-logo.png`;

/**
 * Plan 152. Full HTML5 transactional email for a one-time code.
 *
 * A 3-line HTML fragment (the previous template) is one of the strongest
 * heuristics Gmail and Outlook use to route mail to spam — legit transactional
 * senders always ship a proper HTML document with a preheader, a body, and a
 * footer. The layout borrows the workshop-email conventions so the two feel
 * like the same product.
 */
export function renderCodeHtml(copy: TemplateCopy, code: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <title>${copy.title}</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F4;font-family:Inter,'Segoe UI',Arial,sans-serif;">
  <!-- Preheader: shown in the inbox snippet next to the subject line. Kept short so it doesn't wrap into the body. -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F4F4F4;opacity:0;">
    ${copy.preheader(code)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F4F4F4;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.06);">
          <tr>
            <td style="background:linear-gradient(135deg,#03535F,#076573);padding:28px;text-align:center;">
              <img src="${LOGO_URL}" alt="ABTalks" width="140" style="display:block;margin:0 auto;height:auto;max-width:140px;border:0;outline:none;text-decoration:none;" />
              <p style="color:rgba(255,255,255,0.9);font-size:13px;margin:8px 0 0;letter-spacing:0.3px;">${copy.label}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 8px;">
              <h1 style="color:#0F1720;font-size:20px;line-height:1.35;margin:0 0 8px;font-weight:600;">${copy.title}</h1>
              <p style="color:#4b4b4b;font-size:15px;line-height:1.6;margin:0 0 24px;">
                ${copy.introHtml}
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#E7F2F3;border-radius:12px;margin-bottom:24px;">
                <tr>
                  <td align="center" style="padding:24px;">
                    <p style="color:#076573;font-size:12px;margin:0 0 6px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;">${copy.codeLabel}</p>
                    <p style="color:#03535F;font-size:34px;font-weight:700;letter-spacing:8px;margin:0;font-family:'Menlo','Consolas',ui-monospace,monospace;">${code}</p>
                  </td>
                </tr>
              </table>
              <p style="color:#4b4b4b;font-size:14px;line-height:1.6;margin:0 0 16px;">
                ${copy.ignoreHtml}
              </p>
              <p style="color:#4b4b4b;font-size:14px;line-height:1.6;margin:0 0 24px;">
                Need a hand? Write to <a href="mailto:team@abtalks.in" style="color:#03535F;text-decoration:underline;">team@abtalks.in</a> and someone from the team will help.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 32px;border-top:1px solid #EFEFEF;">
              <p style="color:#8A8A8A;font-size:12px;line-height:1.6;margin:0 0 6px;">
                This is a transactional message from ABTalks, sent because ${copy.footerReason}. If that wasn&rsquo;t you, no action is needed.
              </p>
              <p style="color:#8A8A8A;font-size:12px;line-height:1.6;margin:0;">
                ABTalks &middot; <a href="${APP_URL}" style="color:#8A8A8A;text-decoration:underline;">abtalks.in</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function renderCodeText(copy: TemplateCopy, code: string): string {
  return `${copy.title}

${copy.introText}

  ${code}

The code is valid for the next ${EMAIL_CODE_TTL_MINUTES} minutes.

${copy.ignoreText}

Need a hand? Write to team@abtalks.in.

—
This is a transactional message from ABTalks (${APP_URL}).`;
}

/** Exposed for the template regression test only. */
export const EMAIL_CODE_COPY = COPY;
