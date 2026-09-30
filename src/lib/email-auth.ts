import "server-only";

import { CredentialsSignin } from "next-auth";
import { cookies } from "next/headers";
import { PlatformRole, Prisma, RoleScopeType } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  emailRateLimitSubject,
  normaliseEmail,
  verifyEmailCode,
} from "@/lib/email-code";
import {
  isEmailLoginEnabled,
  isRecruiterAuthEnabled,
} from "@/lib/feature-flags";
import { logger } from "@/lib/logger";
import {
  burnPasswordCheck,
  hashPassword,
  isUsablePasswordHash,
  verifyPassword,
} from "@/lib/password";
import { assertRateLimit, rateLimitSubjectFromHeaders } from "@/lib/rate-limit";
import {
  SIGN_IN_ERROR,
  emailCodeCredentialsSchema,
  passwordCredentialsSchema,
} from "@/lib/validations/email-auth";
import { writeAudit } from "@/features/admin/audit";
import { recordLegalConsents } from "@/features/legal/record-consent";
import { recordNewsletterOptIn } from "@/features/legal/record-newsletter-optin";
import { attributeUtmToUser } from "@/features/utm/attribute";

/*
 * Password and emailed-code sign-in (plan 154). The two Credentials providers
 * in `auth.ts` call `authorizePassword` / `authorizeEmailCode`; the server
 * actions in `app/actions/email-auth-actions.ts` use the rest.
 *
 * Rules, in one place:
 * - Admins sign in with Google only. Neither method opens an admin account.
 * - The candidate door (`/login`) never opens a recruiter account and the
 *   recruiter door never opens a candidate one — recruiter isolation.
 * - An emailed code on `/login` for an unknown address creates the account,
 *   exactly as a first Google sign-in does.
 * - "No account" and "wrong password" look and take the same.
 */

// ---------------------------------------------------------------------------
// Refusal codes surfaced to the client as `signIn(...).code`
// ---------------------------------------------------------------------------

class RateLimitedSignIn extends CredentialsSignin {
  code = SIGN_IN_ERROR.rateLimited;
}

class RecruiterAccountSignIn extends CredentialsSignin {
  code = SIGN_IN_ERROR.recruiterAccount;
}

class NotRecruiterSignIn extends CredentialsSignin {
  code = SIGN_IN_ERROR.notRecruiter;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

const AUTH_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  password: true,
  emailVerified: true,
  deletedAt: true,
  disabledAt: true,
  recruiterProfile: { select: { id: true } },
} satisfies Prisma.UserSelect;

export type AuthUser = Prisma.UserGetPayload<{ select: typeof AUTH_USER_SELECT }>;

type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
};

function toSessionUser(user: AuthUser): SessionUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/**
 * The account for an address, case-insensitively: Google stores whatever case
 * the provider returned, and codes are issued to the lowercased address.
 */
export async function findAuthUserByEmail(email: string): Promise<AuthUser | null> {
  return prisma.user.findFirst({
    where: { email: { equals: normaliseEmail(email), mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
    select: AUTH_USER_SELECT,
  });
}

export function isFrozen(user: { deletedAt: Date | null; disabledAt: Date | null }): boolean {
  return Boolean(user.deletedAt || user.disabledAt);
}

export function hasUsablePassword(user: { password: string | null }): boolean {
  return isUsablePasswordHash(user.password);
}

/**
 * Local-only escape hatch: `ENABLE_DEV_AUTH=true` under `next dev` lets the
 * seeded admin sign in with a password. Both conditions, always — the
 * NODE_ENV check is what keeps this out of every deployed environment.
 */
function devAdminPasswordAllowed(): boolean {
  return (
    process.env.ENABLE_DEV_AUTH === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

/**
 * Same parse as `lib/admin-auth.ts`. Duplicated because that file imports
 * `@/auth`, and `auth.ts` imports this one.
 */
function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Admin accounts sign in with Google only: a guessed or leaked password must
 * never open the admin panel. Covers the bootstrap list, the legacy
 * `Role.ADMIN`, and a live global ADMIN grant.
 */
export async function isGoogleOnlyAccount(
  email: string,
  user: { id: string; role: string } | null,
): Promise<boolean> {
  if (devAdminPasswordAllowed()) return false;
  if (adminEmails().includes(normaliseEmail(email))) return true;
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  const grant = await prisma.userRoleAssignment.findFirst({
    where: {
      userId: user.id,
      role: PlatformRole.ADMIN,
      scopeType: RoleScopeType.GLOBAL,
      revokedAt: null,
    },
    select: { id: true },
  });
  return grant !== null;
}

/** Cookie `login-client.tsx` writes so a newsletter opt-out survives sign-in. */
const NEWSLETTER_PREF_COOKIE = "abtalks_newsletter_pref";

/**
 * A first sign-in by emailed code. Credentials providers bypass the adapter,
 * so `events.createUser` never fires — the account, its consent record and its
 * attribution are written here, the same three things a first Google sign-in
 * gets.
 */
async function createCandidateFromEmail(email: string): Promise<SessionUser | null> {
  let user: AuthUser;
  try {
    user = await prisma.user.create({
      // The code just proved the address.
      data: { email, emailVerified: new Date() },
      select: AUTH_USER_SELECT,
    });
  } catch (error) {
    // Two tabs racing the same first sign-in: the other one won.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await findAuthUserByEmail(email);
      if (!existing || isFrozen(existing) || existing.recruiterProfile) return null;
      return toSessionUser(existing);
    }
    throw error;
  }

  // Never throws: a failure here must not break sign-in.
  try {
    await recordLegalConsents({
      userId: user.id,
      email: user.email,
      source: "email_signup",
    });
    let newsletterOptIn = true;
    try {
      const pref = (await cookies()).get(NEWSLETTER_PREF_COOKIE)?.value;
      if (pref === "0") newsletterOptIn = false;
    } catch {
      // cookies() can throw outside a request context — keep the default.
    }
    await recordNewsletterOptIn({
      userId: user.id,
      email: user.email,
      source: "email_signup",
      optIn: newsletterOptIn,
    });
  } catch (error) {
    logger.error("[legal] email signup consent not recorded", {
      userId: user.id,
      error: String(error),
    });
  }
  void attributeUtmToUser(user.id);

  logger.info({ event: "auth.email_signup", userId: user.id }, "Account created by emailed code");
  return toSessionUser(user);
}

// ---------------------------------------------------------------------------
// Credentials providers
// ---------------------------------------------------------------------------

/** `signIn("email-code", { email, code })` — the candidate door only. */
export async function authorizeEmailCode(raw: unknown): Promise<SessionUser | null> {
  if (!isEmailLoginEnabled()) return null;
  const parsed = emailCodeCredentialsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { email, code } = parsed.data;

  const verified = await verifyEmailCode(email, code, {
    purposes: ["candidate-login"],
  });
  if (!verified.ok) return null;

  const user = await findAuthUserByEmail(email);
  if (!user) {
    if (await isGoogleOnlyAccount(email, null)) return null;
    return createCandidateFromEmail(email);
  }

  if (isFrozen(user)) return null;
  if (await isGoogleOnlyAccount(email, user)) return null;
  if (user.recruiterProfile) throw new RecruiterAccountSignIn();

  if (!user.emailVerified) {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: new Date() },
      select: { id: true },
    });
  }
  return toSessionUser(user);
}

/**
 * `signIn("password", { email, password, audience })`.
 *
 * Rate limits come first, before any hashing: scrypt is deliberately
 * expensive, and an unmetered door to it is a denial-of-service. Every refusal
 * before the password verifies is the same plain null; the audience refusals
 * come after it, so they only tell the account's owner something.
 */
export async function authorizePassword(
  raw: unknown,
  request: Request,
): Promise<SessionUser | null> {
  if (!isEmailLoginEnabled()) return null;
  const parsed = passwordCredentialsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { email, password, audience } = parsed.data;
  if (audience === "recruiter" && !isRecruiterAuthEnabled()) return null;

  const perClient = await assertRateLimit({
    bucket: "LOGIN_PASSWORD_IP",
    subjectId: await rateLimitSubjectFromHeaders(request.headers),
  });
  if (!perClient.ok) throw new RateLimitedSignIn();
  const perAccount = await assertRateLimit({
    bucket: "LOGIN_PASSWORD_ACCOUNT",
    subjectId: emailRateLimitSubject(email),
  });
  if (!perAccount.ok) throw new RateLimitedSignIn();

  const user = await findAuthUserByEmail(email);
  if (!user || !hasUsablePassword(user)) {
    await burnPasswordCheck(password);
    return null;
  }
  if (!(await verifyPassword(password, user.password))) return null;

  if (isFrozen(user)) return null;
  if (await isGoogleOnlyAccount(email, user)) return null;
  if (audience === "candidate" && user.recruiterProfile) {
    throw new RecruiterAccountSignIn();
  }
  if (audience === "recruiter" && !user.recruiterProfile) {
    throw new NotRecruiterSignIn();
  }
  return toSessionUser(user);
}

// ---------------------------------------------------------------------------
// Writing a password
// ---------------------------------------------------------------------------

export type PasswordWriteKind = "PASSWORD_SET" | "PASSWORD_CHANGED" | "PASSWORD_RESET";

/**
 * A first password may be set without an emailed code only this soon after
 * signing in. Past it, a session that was left open or lifted from a browser
 * cannot quietly add a password and keep the account forever.
 */
export const FRESH_SIGN_IN_SECONDS = 15 * 60;

export function isFreshSignIn(authTime: number | undefined): boolean {
  if (typeof authTime !== "number") return false;
  return Math.floor(Date.now() / 1000) - authTime <= FRESH_SIGN_IN_SECONDS;
}

/**
 * Hash and store a password, with an audit row in the same commit.
 *
 * `invalidateSessions` signs the account out everywhere (via
 * `sessionInvalidatedAt`). Used when a password is replaced or reset — whoever
 * knew the old one, or held a session opened with it, is out. The caller then
 * opens a fresh session for the person in front of it.
 */
export async function storePassword(input: {
  userId: string;
  password: string;
  kind: PasswordWriteKind;
  invalidateSessions: boolean;
  /** The caller just verified an emailed code and the account had no date. */
  markEmailVerified?: boolean;
}): Promise<void> {
  const hash = await hashPassword(input.password);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.userId },
      data: {
        password: hash,
        ...(input.invalidateSessions ? { sessionInvalidatedAt: now } : {}),
        ...(input.markEmailVerified ? { emailVerified: now } : {}),
      },
      select: { id: true },
    });
    await writeAudit(tx, {
      actorUserId: input.userId,
      targetUserId: input.userId,
      entityType: "User",
      entityId: input.userId,
      actionType: input.kind,
      reason: "Self-service password change",
      metadata: { sessionsInvalidated: input.invalidateSessions },
    });
  });
}
