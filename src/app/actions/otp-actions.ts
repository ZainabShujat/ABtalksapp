"use server";

import { auth } from "@/auth";
import { writeClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import { verifyAccessToken } from "@/lib/msg91";
import { isOtpDevBypassEnabled, otpDevCode } from "@/lib/feature-flags";
import { otpVerifySchema } from "@/lib/validations/otp";
import { toE164, toWidgetMobile } from "@/lib/validations/phone";
import { dualWriteCandidateIdentity } from "@/repositories/dual-write";

type ActionResult = { ok: true } | { ok: false; message: string };

/**
 * Verify a phone OTP and record the verification.
 *
 * Live: validates the MSG91 widget access token server-side.
 * Dev-bypass: accepts the fixed dev code.
 * On success, upserts the `PhoneVerification` bridge row (used by registration
 * before a StudentProfile exists) and, if a profile already exists, marks it
 * verified in place.
 */
export async function verifyOtpAction(input: {
  countryCode: string;
  phoneNumber: string;
  accessToken?: string;
  otp?: string;
}): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Not authenticated" };
  }
  const userId = session.user.id;

  const parsed = otpVerifySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const { countryCode, phoneNumber, accessToken, otp } = parsed.data;
  const e164 = toE164(countryCode, phoneNumber);
  const widgetMobile = toWidgetMobile(e164);

  if (isOtpDevBypassEnabled()) {
    if (otp !== otpDevCode()) {
      return { ok: false, message: "Invalid code." };
    }
  } else {
    if (!accessToken) {
      return { ok: false, message: "Missing verification token." };
    }
    const result = await verifyAccessToken(accessToken);
    if (!result.ok) {
      return { ok: false, message: result.message };
    }
    // If MSG91 echoed the verified mobile, ensure it matches the submitted number.
    if (result.mobile && result.mobile !== widgetMobile) {
      return {
        ok: false,
        message: "Verified number does not match. Please try again.",
      };
    }
  }

  try {
    await writeClient().$transaction(async (tx) => {
      await tx.phoneVerification.upsert({
        where: { userId },
        create: {
          userId,
          phone: e164,
          verified: true,
          verifiedAt: new Date(),
        },
        update: {
          phone: e164,
          verified: true,
          verifiedAt: new Date(),
        },
      });

      const existingProfile = await tx.studentProfile.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (existingProfile) {
        await tx.studentProfile.update({
          where: { userId },
          data: { phone: e164, phoneVerified: true, phoneVerifiedAt: new Date() },
        });
        await dualWriteCandidateIdentity(tx, userId);
      }
    });
  } catch (e) {
    logger.error("[otp] failed to persist verification", { error: String(e) });
    return { ok: false, message: "Could not save verification. Try again." };
  }

  return { ok: true };
}
