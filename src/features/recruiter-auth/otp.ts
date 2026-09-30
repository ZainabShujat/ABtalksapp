import "server-only";

import { prisma } from "@/lib/db";
import {
  issueEmailCode,
  normaliseEmail,
  otpDevFallbackEnabled,
  purgeExpiredEmailCodes,
  verifyEmailCode,
} from "@/lib/email-code";

/*
 * Recruiter sign-in / registration codes.
 *
 * The code machinery — hashing, expiry, attempts, per-address rate limit —
 * lives in `lib/email-code.ts` since plan 154, shared with candidate sign-in
 * and password reset. What stays here is the recruiter gate: who may be sent a
 * code for which intent.
 */

export { normaliseEmail, otpDevFallbackEnabled };

export type OtpPurpose = "login" | "register";

/** What the recruiter is trying to do, which decides the gate. */
export type OtpIntent = "register" | "signin";

/** The live seat for this email, or null. Seats are matched exactly, lowercased. */
export async function findLiveSeat(email: string) {
  return prisma.verifiedRecruiterSeat.findFirst({
    where: { email: normaliseEmail(email), active: true, revokedAt: null },
    select: { id: true, company: true, contactName: true },
  });
}

export type IssueResult =
  | {
      ok: true;
      purpose: OtpPurpose;
      /**
       * The plaintext code, returned to the *server* caller so it can be
       * emailed. It must never be put in a Server Action response outside the
       * dev fallback — see requestRecruiterOtpAction.
       */
      code: string;
    }
  | {
      ok: false;
      reason: "rate-limited" | "not-registered" | "already-registered";
    };

/**
 * Create a code for an email.
 *
 * The gate depends on what they are doing. Registration is open — anyone can
 * apply, and the ABTalks team decides afterwards — so the only thing checked is
 * that they have not already registered. Signing in is the opposite: it needs a
 * registration to exist, because there is nothing to sign in to otherwise.
 */
export async function issueRecruiterOtp(
  rawEmail: string,
  intent: OtpIntent,
): Promise<IssueResult> {
  const email = normaliseEmail(rawEmail);

  const existing = await prisma.user.findFirst({
    where: { email },
    select: { id: true, recruiterProfile: { select: { id: true } } },
  });
  const isRegistered = Boolean(existing?.recruiterProfile);

  if (intent === "signin" && !isRegistered) {
    return { ok: false, reason: "not-registered" };
  }
  if (intent === "register" && isRegistered) {
    return { ok: false, reason: "already-registered" };
  }

  const purpose: OtpPurpose = intent === "signin" ? "login" : "register";
  const issued = await issueEmailCode(email, purpose);
  if (!issued.ok) return { ok: false, reason: "rate-limited" };
  return { ok: true, purpose, code: issued.code };
}

export type VerifyResult =
  | { ok: true; email: string; purpose: OtpPurpose }
  | { ok: false; reason: "invalid" | "expired" | "too-many" };

/**
 * Check a recruiter code (sign-in or registration — either opens the
 * recruiter session, as it always has). Consumed by default; registration
 * peeks with `{ consume: false }` so the same digits can then open the session
 * through `signIn("recruiter-otp")`.
 */
export async function verifyRecruiterOtp(
  rawEmail: string,
  code: string,
  opts?: { consume?: boolean },
): Promise<VerifyResult> {
  const verified = await verifyEmailCode(rawEmail, code, {
    purposes: ["login", "register"],
    consume: opts?.consume,
  });
  if (!verified.ok) return verified;
  return {
    ok: true,
    email: verified.email,
    purpose: verified.purpose === "login" ? "login" : "register",
  };
}

/** Housekeeping for expired rows; safe to call from anywhere. */
export const purgeExpiredOtps = purgeExpiredEmailCodes;
