"use server";

import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  deliverEmailCode,
  emailCodeFailureMessage,
  emailRateLimitSubject,
  issueEmailCode,
  purgeExpiredEmailCodes,
  verifyEmailCode,
} from "@/lib/email-code";
import {
  findAuthUserByEmail,
  hasUsablePassword,
  isFreshSignIn,
  isFrozen,
  isGoogleOnlyAccount,
  storePassword,
} from "@/lib/email-auth";
import {
  isEmailLoginEnabled,
  isRecruiterAuthEnabled,
} from "@/lib/feature-flags";
import { logger } from "@/lib/logger";
import { verifyPassword } from "@/lib/password";
import { assertRateLimit, rateLimitSubjectFromHeaders } from "@/lib/rate-limit";
import {
  PASSWORD_IS_EMAIL_MESSAGE,
  passwordIsNotEmail,
  requestEmailCodeSchema,
  resetPasswordSchema,
  setPasswordSchema,
} from "@/lib/validations/email-auth";

/*
 * Plan 154 — the server side of password and emailed-code sign-in that is not
 * the sign-in itself (that is the `email-code` / `password` providers in
 * auth.ts). Public: requestEmailCodeAction and resetPasswordAction are called
 * from the login pages by signed-out visitors. The two self-service actions
 * check the session themselves.
 */

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

const NOT_AVAILABLE = "Email sign-in isn't available yet.";
const RECRUITER_ACCOUNT_MESSAGE =
  "This email belongs to a recruiter account. Sign in at ABTalks Hire instead.";
const GOOGLE_ONLY_MESSAGE = "This account signs in with Google only.";
const SEND_FAILED = "Could not send a code. Try again.";

async function clientRateLimit(): Promise<{ ok: true } | { ok: false; message: string }> {
  return assertRateLimit({
    bucket: "EMAIL_CODE_IP",
    subjectId: await rateLimitSubjectFromHeaders(await headers()),
  });
}

/**
 * Email a code: to sign in on /login (`candidate-login`), or to set a new
 * password from either door (`password-reset`).
 *
 * `candidate-login` to an unknown address is a signup and gets a code. A
 * recruiter address is told where to go, whichever purpose it asked for —
 * recruiter sign-in already says which addresses are registered, so this
 * reveals nothing new, and the candidate door must neither open a recruiter
 * account nor rewrite its password. Admin and frozen accounts get the same
 * answer as everyone else and no email.
 *
 * `password-reset` always answers the same way, whether or not a code was
 * sent, so it cannot be used to learn who has an account.
 */
export async function requestEmailCodeAction(
  input: unknown,
): Promise<ActionResult<{ sent: true; devCode?: string }>> {
  if (!isEmailLoginEnabled()) return { ok: false, message: NOT_AVAILABLE };
  const parsed = requestEmailCodeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Enter a valid email address." };
  }
  const { email, purpose, audience } = parsed.data;
  if (audience === "recruiter" && !isRecruiterAuthEnabled()) {
    return { ok: false, message: "Recruiter sign-in isn't open yet." };
  }
  if (purpose === "candidate-login" && audience !== "candidate") {
    return { ok: false, message: "Enter a valid email address." };
  }

  try {
    const perClient = await clientRateLimit();
    if (!perClient.ok) return { ok: false, message: perClient.message };

    void purgeExpiredEmailCodes();

    const user = await findAuthUserByEmail(email);
    const googleOnly = await isGoogleOnlyAccount(email, user);
    const silent: ActionResult<{ sent: true }> = { ok: true, data: { sent: true } };

    // `candidate-login` already implies the candidate door (checked above);
    // `password-reset` can arrive from either.
    if (audience === "candidate" && user?.recruiterProfile) {
      return { ok: false, message: RECRUITER_ACCOUNT_MESSAGE };
    }

    if (purpose === "candidate-login") {
      if (googleOnly || (user && isFrozen(user))) return silent;
    } else if (
      !user ||
      isFrozen(user) ||
      googleOnly ||
      (audience === "recruiter" && !user.recruiterProfile)
    ) {
      return silent;
    }

    const issued = await issueEmailCode(email, purpose);
    // The limiter's own message: "too many" only when it really counted that
    // many, and something else when it could not count at all.
    if (!issued.ok) return { ok: false, message: issued.message };
    const { devCode } = await deliverEmailCode(
      email,
      issued.code,
      purpose === "candidate-login" ? "signin" : "password",
    );
    return { ok: true, data: { sent: true, ...(devCode ? { devCode } : {}) } };
  } catch (error) {
    logger.error("[email-auth] requestEmailCodeAction", { error: String(error) });
    return { ok: false, message: SEND_FAILED };
  }
}

/**
 * Forgot password: an emailed `password-reset` code plus a new password.
 *
 * Signs the account out everywhere — whoever had the old password, or a
 * session opened with it, is out. The page then signs the person in with the
 * new password.
 */
export async function resetPasswordAction(
  input: unknown,
): Promise<ActionResult<{ reset: true }>> {
  if (!isEmailLoginEnabled()) return { ok: false, message: NOT_AVAILABLE };
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check the form.",
    };
  }
  const { email, code, newPassword } = parsed.data;

  try {
    const verified = await verifyEmailCode(email, code, {
      purposes: ["password-reset"],
    });
    if (!verified.ok) {
      return { ok: false, message: emailCodeFailureMessage(verified.reason) };
    }

    const user = await findAuthUserByEmail(email);
    if (!user || isFrozen(user) || (await isGoogleOnlyAccount(email, user))) {
      return { ok: false, message: emailCodeFailureMessage("invalid") };
    }

    await storePassword({
      userId: user.id,
      password: newPassword,
      kind: "PASSWORD_RESET",
      invalidateSessions: true,
      markEmailVerified: !user.emailVerified,
    });
    return { ok: true, data: { reset: true } };
  } catch (error) {
    logger.error("[email-auth] resetPasswordAction", { error: String(error) });
    return { ok: false, message: "Could not save your password. Try again." };
  }
}

/**
 * Signed-in: set a first password, or change the current one.
 *
 * - Changing needs the current password, and signs out every other session
 *   (`reauthenticate: true` — the page signs this one back in).
 * - A first password needs a recent sign-in, or an emailed code
 *   (`requestPasswordCodeAction`) when the sign-in is older.
 */
export async function setPasswordAction(
  input: unknown,
): Promise<ActionResult<{ reauthenticate: boolean }>> {
  if (!isEmailLoginEnabled()) return { ok: false, message: NOT_AVAILABLE };
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, message: "Sign in first." };

  const parsed = setPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check the form.",
    };
  }
  const { newPassword, currentPassword, code } = parsed.data;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        password: true,
        deletedAt: true,
        disabledAt: true,
      },
    });
    if (!user || isFrozen(user)) return { ok: false, message: "Sign in first." };
    if (await isGoogleOnlyAccount(user.email, user)) {
      return { ok: false, message: GOOGLE_ONLY_MESSAGE };
    }
    if (!passwordIsNotEmail(user.email, newPassword)) {
      return { ok: false, message: PASSWORD_IS_EMAIL_MESSAGE };
    }

    if (hasUsablePassword(user)) {
      if (!currentPassword) {
        return { ok: false, message: "Enter your current password." };
      }
      // The current-password box is a password guess like any other.
      const allowed = await assertRateLimit({
        bucket: "LOGIN_PASSWORD_ACCOUNT",
        subjectId: emailRateLimitSubject(user.email),
      });
      if (!allowed.ok) return { ok: false, message: allowed.message };
      if (!(await verifyPassword(currentPassword, user.password))) {
        return { ok: false, message: "Your current password is incorrect." };
      }
      await storePassword({
        userId: user.id,
        password: newPassword,
        kind: "PASSWORD_CHANGED",
        invalidateSessions: true,
      });
      return { ok: true, data: { reauthenticate: true } };
    }

    if (!isFreshSignIn(session.authTime)) {
      if (!code) {
        return {
          ok: false,
          message: "Confirm it's you with the code we email you.",
        };
      }
      const verified = await verifyEmailCode(user.email, code, {
        purposes: ["password-reset"],
      });
      if (!verified.ok) {
        return { ok: false, message: emailCodeFailureMessage(verified.reason) };
      }
    }

    await storePassword({
      userId: user.id,
      password: newPassword,
      kind: "PASSWORD_SET",
      invalidateSessions: false,
    });
    return { ok: true, data: { reauthenticate: false } };
  } catch (error) {
    logger.error("[email-auth] setPasswordAction", { error: String(error) });
    return { ok: false, message: "Could not save your password. Try again." };
  }
}

/** Signed-in: email a `password-reset` code to the account's own address. */
export async function requestPasswordCodeAction(): Promise<
  ActionResult<{ sent: true; devCode?: string }>
> {
  if (!isEmailLoginEnabled()) return { ok: false, message: NOT_AVAILABLE };
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, message: "Sign in first." };

  try {
    const perClient = await clientRateLimit();
    if (!perClient.ok) return { ok: false, message: perClient.message };

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, deletedAt: true, disabledAt: true },
    });
    if (!user || isFrozen(user)) return { ok: false, message: "Sign in first." };
    if (await isGoogleOnlyAccount(user.email, user)) {
      return { ok: false, message: GOOGLE_ONLY_MESSAGE };
    }

    const issued = await issueEmailCode(user.email, "password-reset");
    if (!issued.ok) return { ok: false, message: issued.message };
    const { devCode } = await deliverEmailCode(user.email, issued.code, "password");
    return { ok: true, data: { sent: true, ...(devCode ? { devCode } : {}) } };
  } catch (error) {
    logger.error("[email-auth] requestPasswordCodeAction", {
      error: String(error),
    });
    return { ok: false, message: SEND_FAILED };
  }
}
