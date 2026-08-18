import { EnrollmentStatus, UserType } from "@prisma/client";
import { clearRefCookie } from "@/lib/cookies";
import { isClaudeEnabled, isOtpVerificationRequired } from "@/lib/feature-flags";
import type { RegisterPayloadInput } from "@/lib/validations/register";
import { INDIA_DIALING_CODE, toE164 } from "@/lib/validations/phone";
import { prisma } from "@/lib/db";
import { awardReferralSynergy } from "@/features/synergy/award-referral-synergy";
import { recordLegalConsents } from "@/features/legal/record-consent";
import { recordNewsletterOptIn } from "@/features/legal/record-newsletter-optin";
import { generateUniqueReferralCode } from "./generate-referral-code";

export type CompleteRegistrationResult =
  | { ok: true; profileId: string }
  | { ok: false; reason: "already_registered"; message: string }
  | { ok: false; reason: "internal_error"; message: string };

export async function completeRegistration(
  userId: string,
  input: RegisterPayloadInput,
  opts?: { email?: string | null },
): Promise<CompleteRegistrationResult> {
  const userExists = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!userExists) {
    return {
      ok: false,
      reason: "internal_error",
      message: "Your session has expired. Please sign out and sign in again.",
    };
  }

  const existingProfile = await prisma.studentProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  const existingEnrollment = await prisma.enrollment.findFirst({
    where: { userId },
    select: { id: true },
  });

  if (existingProfile && existingEnrollment) {
    return {
      ok: false,
      reason: "already_registered",
      message: "You are already registered.",
    };
  }

  if (existingProfile && !existingEnrollment) {
    await prisma.studentProfile.delete({ where: { userId } });
  }

  if (input.domain === "CLAUDE" && !isClaudeEnabled()) {
    return {
      ok: false,
      reason: "internal_error",
      message: "The Claude challenge is not available yet.",
    };
  }

  let referrerId: string | null = null;
  if (input.referralCode) {
    const matchingReferrer = await prisma.studentProfile.findUnique({
      where: { referralCode: input.referralCode },
      select: { userId: true },
    });
    if (matchingReferrer && matchingReferrer.userId !== userId) {
      referrerId = matchingReferrer.userId;
    } else if (!matchingReferrer) {
      console.warn(
        "[registration] invalid referral code skipped:",
        input.referralCode,
      );
    }
  }

  let newReferralCode: string;
  try {
    newReferralCode = await generateUniqueReferralCode();
  } catch {
    return {
      ok: false,
      reason: "internal_error",
      message: "Could not assign a referral code. Try again.",
    };
  }

  const challenge = await prisma.challenge.findUnique({
    where: { domain: input.domain },
    select: { id: true },
  });
  if (!challenge) {
    return {
      ok: false,
      reason: "internal_error",
      message: "Challenge for this domain is not available.",
    };
  }

  const linkedinUrl =
    input.linkedinUrl === "" ? null : input.linkedinUrl;
  const githubUsername =
    input.githubUsername === "" ? null : input.githubUsername;
  const phone =
    input.phoneNumber && input.phoneNumber.trim() !== ""
      ? toE164(input.countryCode, input.phoneNumber)
      : null;

  // India (+91) requires a phone that has been OTP-verified (production).
  // Under next dev, OTP is skipped — persist the phone as unverified.
  // Re-check the verification server-side — never trust the client.
  let phoneVerified = false;
  if (input.countryCode === INDIA_DIALING_CODE) {
    if (!phone) {
      return {
        ok: false,
        reason: "internal_error",
        message: "Phone number is required.",
      };
    }
    if (isOtpVerificationRequired()) {
      const verification = await prisma.phoneVerification.findUnique({
        where: { userId },
        select: { phone: true, verified: true },
      });
      if (!verification || !verification.verified || verification.phone !== phone) {
        return {
          ok: false,
          reason: "internal_error",
          message: "Please verify your phone number to continue.",
        };
      }
      phoneVerified = true;
    }
  }

  try {
    const profileId = await prisma.$transaction(async (tx) => {
      const profile = await tx.studentProfile.create({
        data:
          input.userType === UserType.STUDENT
            ? {
                userId,
                fullName: input.fullName,
                userType: UserType.STUDENT,
                college: input.college,
                collegeId: input.collegeId || null,
                graduationYear: input.graduationYear,
                organization: null,
                role: null,
                yearsExperience: null,
                domain: input.domain,
                skills: input.skills ?? [],
                linkedinUrl,
                phone,
                phoneVerified,
                githubUsername,
                referralCode: newReferralCode,
              }
            : {
                userId,
                fullName: input.fullName,
                userType: UserType.PROFESSIONAL,
                college: null,
                collegeId: null,
                graduationYear: null,
                organization: input.organization,
                role: input.role,
                yearsExperience: input.yearsExperience,
                domain: input.domain,
                skills: input.skills ?? [],
                linkedinUrl,
                phone,
                phoneVerified,
                githubUsername,
                referralCode: newReferralCode,
              },
      });

      await tx.enrollment.create({
        data: {
          userId,
          challengeId: challenge.id,
          domain: input.domain,
          status: EnrollmentStatus.ACTIVE,
        },
      });

      return profile.id;
    }, {
      maxWait: 10000,
      timeout: 20000,
    });

    if (referrerId) {
      try {
        await prisma.$transaction(async (tx) => {
          const referral = await tx.referral.create({
            data: {
              referrerId,
              referredId: userId,
              rewardGiven: false,
            },
            select: { id: true },
          });
          await awardReferralSynergy(tx, {
            referrerId,
            referralId: referral.id,
            referredUserId: userId,
          });
        });
      } catch (error) {
        console.error("[registration] referral creation failed:", error);
      }
    }

    await recordLegalConsents({
      userId,
      email: opts?.email,
      source: "register",
    });

    await recordNewsletterOptIn({
      userId: userId,
      email: opts?.email,
      source: "register",
      optIn: input.newsletterOptIn === true,
    });

    await clearRefCookie();

    return { ok: true, profileId };
  } catch (e) {
    console.error("[registration] transaction failed:", e);
    return {
      ok: false,
      reason: "internal_error",
      message: "Something went wrong. Please try again.",
    };
  }
}
