"use server";

import { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { VIDEOTHON, isVideothonRegistrationOpen } from "@/features/hackathon-video/config";
import { getVerifiedPhone } from "@/features/hackathon-video/get-verified-phone";
import { sendVideoWelcomeEmail } from "@/lib/hackathon-video-email";
import { isOtpVerificationRequired } from "@/lib/feature-flags";
import { INDIA_DIALING_CODE } from "@/lib/validations/phone";
import { recordLegalConsents } from "@/features/legal/record-consent";
import { recordNewsletterOptIn } from "@/features/legal/record-newsletter-optin";
import {
  videoRegistrationSchema,
  videoSourceSlugSchema,
  type VideoRegistrationInput,
} from "@/lib/validations/hackathon-video";

const SRC_COOKIE_NAME = "abtalks_src";

async function readSourceSlug(): Promise<string | null> {
  const raw = (await cookies()).get(SRC_COOKIE_NAME)?.value;
  if (!raw) return null;
  const parsed = videoSourceSlugSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Register the signed-in user for VideoThon. Identity (`fullName`, `email`)
 * is read from the session — never trusted from the client payload — so a
 * crafted request cannot register someone under another name or email.
 */
export async function submitVideoRegistrationAction(input: VideoRegistrationInput) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return { ok: false as const, message: "Please sign in with Google first." };
  }
  const userId = session.user.id;
  const email = session.user.email.trim().toLowerCase();
  const fullName = (session.user.name ?? "").trim();
  if (fullName.length < 2) {
    return {
      ok: false as const,
      message: "Add your full name to your Google account, then try again.",
    };
  }

  if (!isVideothonRegistrationOpen()) {
    return { ok: false as const, message: "Registration is closed." };
  }

  const parsed = videoRegistrationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const d = parsed.data;

  // Re-check the phone server-side — never trust the client. A number already
  // verified on the platform is locked on the form, so it must come back
  // unchanged; any other +91 number must have just been OTP-verified.
  // Non-India numbers cannot be OTP-verified and are accepted as typed.
  if (isOtpVerificationRequired()) {
    const verified = await getVerifiedPhone(userId);
    const matchesVerified =
      verified !== null &&
      verified.countryCode === d.phoneCountryCode &&
      verified.phoneNumber === d.phoneNumber;
    const needsMatch =
      verified !== null || d.phoneCountryCode === INDIA_DIALING_CODE;
    if (needsMatch && !matchesVerified) {
      return {
        ok: false as const,
        message: "Please verify your phone number to continue.",
      };
    }
  }

  const sourceSlug = await readSourceSlug();

  try {
    await prisma.hackathonVideoRegistration.create({
      data: {
        eventId: VIDEOTHON.eventId,
        userId,
        fullName,
        email,
        phoneCountryCode: d.phoneCountryCode,
        phoneNumber: d.phoneNumber,
        city: d.city,
        state: d.state ?? null,
        employment: d.employment,
        currentCtc: d.currentCtc ?? null,
        portfolioUrl: d.portfolioUrl,
        sourceSlug,
      },
      select: { id: true },
    });
  } catch (error) {
    // Unique constraint on (eventId, userId) — user re-submits the dialog.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        ok: false as const,
        message: "You're already registered for this event.",
      };
    }
    logger.error("videothon registration insert failed", { error, userId });
    return {
      ok: false as const,
      message: "Something went wrong. Please try again.",
    };
  }

  // Send the confirmation email BEFORE the action returns — fire-and-forget
  // on Vercel serverless can be killed mid-flight when the function replies.
  // `sendVideoWelcomeEmail` catches its own transport errors and logs; it
  // never throws, so awaiting it can't break registration.
  await sendVideoWelcomeEmail(fullName, email);

  try {
    await recordLegalConsents({ userId, email, source: "hackathon" });
    await recordNewsletterOptIn({
      userId,
      email,
      source: "hackathon",
      optIn: d.newsletterOptIn === true,
    });
  } catch (error) {
    logger.error("videothon consent/newsletter record failed", { error, userId });
  }

  (await cookies()).delete(SRC_COOKIE_NAME);
  revalidatePath("/hackathon");
  revalidatePath("/hackathon/dashboard");

  return {
    ok: true as const,
    data: {
      eventId: VIDEOTHON.eventId,
      fullName,
      email,
    },
  };
}
