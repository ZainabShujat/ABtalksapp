import "server-only";

import { createHash, randomInt, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

const CODE_LENGTH = 6;
const TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
/** Codes per email per window. Without this the email box is a free cannon. */
const RATE_LIMIT = 3;
const RATE_WINDOW_MINUTES = 15;

export type OtpPurpose = "login" | "register";

/** What the recruiter is trying to do, which decides the gate. */
export type OtpIntent = "register" | "signin";

/**
 * sha256(code + AUTH_SECRET).
 *
 * The column is `codeHash`, and it means it — a plaintext code in the database
 * is a password in the database. The secret is a pepper: without it, a stolen
 * table plus six digits of search space is no protection at all.
 */
function hashCode(code: string): string {
  return createHash("sha256")
    .update(`${code}${process.env.AUTH_SECRET ?? ""}`)
    .digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The dev escape hatch: show the code instead of emailing it.
 *
 * Both conditions, always. A deployed environment that happens to be missing
 * the Resend key must not start handing out other people's sign-in codes, so
 * the NODE_ENV check is the one that actually protects this — the missing key
 * only decides whether it is *needed*.
 */
export function otpDevFallbackEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY;
}

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

  const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60_000);
  const recent = await prisma.recruiterEmailOtp.count({
    where: { email, createdAt: { gte: since } },
  });
  if (recent >= RATE_LIMIT) return { ok: false, reason: "rate-limited" };

  // randomInt, not Math.random: this is a credential, however short-lived.
  const code = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(
    CODE_LENGTH,
    "0",
  );
  const purpose: OtpPurpose = intent === "signin" ? "login" : "register";

  await prisma.$transaction([
    // One live code per email. An older one lying around is a second key.
    prisma.recruiterEmailOtp.deleteMany({ where: { email } }),
    prisma.recruiterEmailOtp.create({
      data: {
        email,
        codeHash: hashCode(code),
        purpose,
        expiresAt: new Date(Date.now() + TTL_MINUTES * 60_000),
      },
    }),
  ]);

  return { ok: true, purpose, code };
}

export type VerifyResult =
  | { ok: true; email: string; purpose: OtpPurpose }
  | { ok: false; reason: "invalid" | "expired" | "too-many" };

/**
 * Check a code and consume it.
 *
 * Deleted on success, so one code buys one sign-in. Deleted after the attempt
 * budget too — a code someone is guessing at is a code that should stop
 * existing.
 */
export async function verifyRecruiterOtp(
  rawEmail: string,
  code: string,
): Promise<VerifyResult> {
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

  if (!safeEqual(hashCode(code.trim()), row.codeHash)) {
    const next = row.attempts + 1;
    if (next >= MAX_ATTEMPTS) {
      await prisma.recruiterEmailOtp.delete({ where: { id: row.id } });
      return { ok: false, reason: "too-many" };
    }
    await prisma.recruiterEmailOtp.update({
      where: { id: row.id },
      data: { attempts: next },
    });
    return { ok: false, reason: "invalid" };
  }

  await prisma.recruiterEmailOtp.delete({ where: { id: row.id } });
  return {
    ok: true,
    email,
    purpose: row.purpose === "login" ? "login" : "register",
  };
}

/** Housekeeping for expired rows; safe to call from anywhere. */
export async function purgeExpiredOtps(): Promise<number> {
  try {
    const { count } = await prisma.recruiterEmailOtp.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return count;
  } catch (error) {
    logger.error("[recruiter-auth] purgeExpiredOtps", { error: String(error) });
    return 0;
  }
}
