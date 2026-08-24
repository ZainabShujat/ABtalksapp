"use server";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { recordLegalConsents } from "@/features/legal/record-consent";
import { recordNewsletterOptIn } from "@/features/legal/record-newsletter-optin";
import {
  findLiveSeat,
  issueRecruiterOtp,
  normaliseEmail,
  otpDevFallbackEnabled,
  purgeExpiredOtps,
  verifyRecruiterOtp,
  type OtpIntent,
} from "@/features/recruiter-auth/otp";
import {
  registerRecruiterSchema,
  requestRecruiterOtpSchema,
} from "@/lib/validations/recruiter-auth";

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

const SUPPORT_EMAIL = "team@abtalks.in";

async function deliverCode(
  email: string,
  code: string,
): Promise<{ devCode?: string }> {
  // The code leaves the server exactly one way: by email in production, or on
  // screen in development when there is no mail provider configured.
  if (otpDevFallbackEnabled()) {
    logger.warn("[recruiter-auth] dev OTP", { email, code });
    return { devCode: code };
  }
  await sendEmail({
    to: email,
    subject: "Your ABTalks verification code",
    html: `<p>Your ABTalks code is:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px;">${code}</p>
<p>It expires in 10 minutes. If you didn't ask for this, you can ignore it.</p>`,
    text: `Your ABTalks code is ${code}. It expires in 10 minutes.`,
  });
  return {};
}

/**
 * Send a code, for registering or for signing in.
 *
 * The two differ in what they can refuse. Registration is open, so the only
 * refusal is "you already have an account — sign in instead". Signing in needs
 * a registration to exist, and says so rather than silently emailing a code
 * that could never be used for anything.
 */
export async function requestRecruiterOtpAction(
  input: unknown,
): Promise<ActionResult<{ sent: true; devCode?: string }>> {
  const parsed = requestRecruiterOtpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Enter a valid work email address." };
  }
  const intent: OtpIntent = parsed.data.intent;

  try {
    void purgeExpiredOtps();

    const issued = await issueRecruiterOtp(parsed.data.email, intent);
    if (!issued.ok) {
      if (issued.reason === "rate-limited") {
        return {
          ok: false,
          message: "Too many codes requested. Try again in a few minutes.",
        };
      }
      if (issued.reason === "already-registered") {
        return {
          ok: false,
          message: "This email is already registered. Sign in instead.",
        };
      }
      return {
        ok: false,
        message:
          "We have no registration for this email. Register first and we'll be in touch.",
      };
    }

    const { devCode } = await deliverCode(parsed.data.email, issued.code);
    return { ok: true, data: { sent: true, ...(devCode ? { devCode } : {}) } };
  } catch (error) {
    logger.error("[recruiter-auth] requestRecruiterOtpAction", {
      error: String(error),
    });
    return { ok: false, message: "Could not send a code. Try again." };
  }
}

/**
 * Complete registration once the emailed code proves the address.
 *
 * The profile is created unapproved: anyone can apply, and a human at ABTalks
 * checks they are really a recruiter before any candidate data is reachable.
 * The one exception is an email the team verified out of band — a live seat is
 * that decision, already made.
 */
export async function registerRecruiterWithOtpAction(
  input: unknown,
): Promise<ActionResult<{ approved: boolean }>> {
  const parsed = registerRecruiterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check the form.",
    };
  }
  const { fullName, company, phone, email, code, newsletterOptIn } =
    parsed.data;
  const normalised = normaliseEmail(email);

  try {
    const verified = await verifyRecruiterOtp(normalised, code);
    if (!verified.ok) {
      return {
        ok: false,
        message:
          verified.reason === "too-many"
            ? "Too many wrong codes. Request a new one."
            : verified.reason === "expired"
              ? "That code expired. Request a new one."
              : "That code isn't right.",
      };
    }

    const already = await prisma.user.findFirst({
      where: { email: normalised },
      select: { id: true, recruiterProfile: { select: { id: true } } },
    });
    if (already?.recruiterProfile) {
      return { ok: false, message: "This email is already registered." };
    }

    const seat = await findLiveSeat(normalised);
    const approved = Boolean(seat);

    const userId = await prisma.$transaction(async (tx) => {
      const id =
        already?.id ??
        (
          await tx.user.create({
            data: {
              email: normalised,
              name: fullName,
              role: "RECRUITER",
              // The code proved the address. Nothing else here does.
              emailVerified: new Date(),
            },
            select: { id: true },
          })
        ).id;

      await tx.recruiterProfile.create({
        data: {
          userId: id,
          fullName,
          company: seat?.company ?? company,
          phone: phone || null,
          approved,
          approvedAt: approved ? new Date() : null,
        },
      });

      if (already) {
        await tx.user.update({ where: { id }, data: { role: "RECRUITER" } });
      }
      return id;
    });

    // Credentials sign-ins bypass the adapter, so no createUser event fires —
    // consent is recorded here or it is not recorded at all.
    try {
      await recordLegalConsents({
        userId,
        email: normalised,
        source: "talent_register",
      });
      await recordNewsletterOptIn({
        email: normalised,
        optIn: newsletterOptIn,
        source: "talent_register",
      });
    } catch (error) {
      logger.error("[recruiter-auth] consent record failed", {
        error: String(error),
      });
    }

    return { ok: true, data: { approved } };
  } catch (error) {
    logger.error("[recruiter-auth] registerRecruiterWithOtpAction", {
      error: String(error),
    });
    return {
      ok: false,
      message: `Could not complete registration. Write to ${SUPPORT_EMAIL} if this keeps happening.`,
    };
  }
}
