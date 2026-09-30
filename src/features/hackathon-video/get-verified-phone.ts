import "server-only";
import { prisma } from "@/lib/db";
import {
  INDIA_DIALING_CODE,
  indianMobileNumberSchema,
} from "@/lib/validations/phone";

export type VerifiedPhone = {
  countryCode: string;
  phoneNumber: string;
};

/**
 * The +91 number this user has already OTP-verified anywhere on the platform,
 * or null. Only +91 numbers can be OTP-verified (MSG91), so anything else is
 * treated as not verified.
 *
 * `PhoneVerification` is written by every OTP verification; the candidate
 * profile's flag is checked as a fallback for profiles verified without one.
 */
export async function getVerifiedPhone(
  userId: string,
): Promise<VerifiedPhone | null> {
  const verification = await prisma.phoneVerification.findUnique({
    where: { userId },
    select: { phone: true, verified: true },
  });
  const fromVerification = verification?.verified
    ? splitIndianE164(verification.phone)
    : null;
  if (fromVerification) return fromVerification;

  const profile = await prisma.candidateProfile.findUnique({
    where: { userId },
    select: { phone: true, phoneVerified: true },
  });
  return profile?.phoneVerified && profile.phone
    ? splitIndianE164(profile.phone)
    : null;
}

function splitIndianE164(e164: string): VerifiedPhone | null {
  if (!e164.startsWith(INDIA_DIALING_CODE)) return null;
  const national = e164.slice(INDIA_DIALING_CODE.length);
  if (!indianMobileNumberSchema.safeParse(national).success) return null;
  return { countryCode: INDIA_DIALING_CODE, phoneNumber: national };
}
