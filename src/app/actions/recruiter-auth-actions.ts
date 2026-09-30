"use server";

import { headers } from "next/headers";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { deliverEmailCode, emailCodeFailureMessage } from "@/lib/email-code";
import { isEmailLoginEnabled, isRecruiterAuthEnabled } from "@/lib/feature-flags";
import { hashPassword } from "@/lib/password";
import { assertRateLimit, rateLimitSubjectFromHeaders } from "@/lib/rate-limit";
import { provisionRecruiterIdentity } from "@/features/hire/provision-recruiter";
import { recordLegalConsents } from "@/features/legal/record-consent";
import { recordNewsletterOptIn } from "@/features/legal/record-newsletter-optin";
import { attributeUtmToUser } from "@/features/utm/attribute";
import {
  findLiveSeat,
  issueRecruiterOtp,
  normaliseEmail,
  purgeExpiredOtps,
  verifyRecruiterOtp,
  type OtpIntent,
} from "@/features/recruiter-auth/otp";
import {
  registerRecruiterSchema,
  requestRecruiterOtpSchema,
} from "@/lib/validations/recruiter-auth";
import {
  WORK_EMAIL_REQUIRED_MESSAGE,
  isPersonalEmailDomain,
} from "@/lib/validations/work-email";

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

const SUPPORT_EMAIL = "team@abtalks.in";


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
  if (!isRecruiterAuthEnabled()) {
    return {
      ok: false,
      message: "Recruiter sign-in and registration aren't open yet.",
    };
  }
  const intent: OtpIntent = parsed.data.intent;

  // Registering a personal mailbox is refused here rather than after the code
  // is typed, so nobody spends a round trip on an address that can never become
  // an account. Signing in is left alone: it needs an existing registration,
  // and that registration already had to pass this rule.
  if (intent === "register" && isPersonalEmailDomain(parsed.data.email)) {
    return { ok: false, message: WORK_EMAIL_REQUIRED_MESSAGE };
  }

  try {
    // Plan 154: per client as well as per address. The address cap alone lets
    // one client mail every inbox it can think of.
    const perClient = await assertRateLimit({
      bucket: "EMAIL_CODE_IP",
      subjectId: await rateLimitSubjectFromHeaders(await headers()),
    });
    if (!perClient.ok) return { ok: false, message: perClient.message };

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

    const { devCode } = await deliverEmailCode(
      parsed.data.email,
      issued.code,
      "recruiter-signin",
    );
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
 * The account is live the moment the code is verified: the profile is created,
 * the workspace is provisioned and funded, and the recruiter signs in to
 * /hire. There is no application to review. The profile used to be created
 * unapproved unless the address matched a `VerifiedRecruiterSeat`, which parked
 * everybody else on an "Application received" screen until an admin acted.
 *
 * The work-email rule is unaffected and still refuses a personal domain twice,
 * before anything is written. A seat now only supplies the company name.
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
  if (!isRecruiterAuthEnabled()) {
    return {
      ok: false,
      message: "Recruiter sign-in and registration aren't open yet.",
    };
  }
  const { fullName, company, phone, email, code, newsletterOptIn, password } =
    parsed.data;
  const normalised = normaliseEmail(email);

  // Plan 154: an optional password, set in the same commit as the account so
  // the two can never disagree. Only while email login is switched on — the
  // password could not be used otherwise.
  if (password && !isEmailLoginEnabled()) {
    return { ok: false, message: "Passwords aren't available yet. Leave it blank." };
  }

  // Checked again on the normalised address, at the boundary that actually
  // creates the account. The schema above already refuses this, so reaching
  // here means the schema was bypassed — which is exactly when it matters.
  if (isPersonalEmailDomain(normalised)) {
    return { ok: false, message: WORK_EMAIL_REQUIRED_MESSAGE };
  }

  try {
    const verified = await verifyRecruiterOtp(normalised, code, {
      consume: false,
    });
    if (!verified.ok) {
      return { ok: false, message: emailCodeFailureMessage(verified.reason) };
    }

    const already = await prisma.user.findFirst({
      where: { email: normalised },
      select: { id: true, recruiterProfile: { select: { id: true } } },
    });
    if (already?.recruiterProfile) {
      return { ok: false, message: "This email is already registered." };
    }

    // Company name only. A seat is no longer an access decision.
    const seat = await findLiveSeat(normalised);
    const resolvedCompany = seat?.company ?? company;
    const now = new Date();
    // Hashed before the transaction: scrypt is deliberately slow and must not
    // eat into the commit window below.
    const passwordHash = password ? await hashPassword(password) : null;

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
              ...(passwordHash ? { password: passwordHash } : {}),
            },
            select: { id: true },
          })
        ).id;

      await tx.recruiterProfile.create({
        data: {
          userId: id,
          fullName,
          company: resolvedCompany,
          phone: phone || null,
          // Written, never read as a gate. See ensureRecruiterWorkspace.
          approved: true,
          approvedAt: now,
          setupStep: "COMPLETE",
          setupCompletedAt: now,
        },
      });

      if (already) {
        await tx.user.update({
          where: { id },
          data: {
            role: "RECRUITER",
            ...(passwordHash ? { password: passwordHash } : {}),
          },
          select: { id: true },
        });
      }

      // Always. The workspace — Organization, OrganizationMember, the
      // RECRUITER role assignment and the starting credit grant — is what
      // registering gets you, and it is created in the same commit as the
      // profile so the two can never disagree.
      await provisionRecruiterIdentity(tx, {
        userId: id,
        company: resolvedCompany,
      });
      return id;
      // The same window ensureRecruiterWorkspace and the credit grant use.
      // Prisma's 5s default is not enough for this many sequential writes over
      // Neon: it timed out at ~5.3s and rolled everything back. The code is
      // only peeked here, so a retry can reuse it, but the recruiter still
      // waits on this commit.
    }, { maxWait: 20_000, timeout: 20_000 });

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

    // T-254: first-touch UTM attribution. Best-effort — failure never blocks
    // the recruiter's signup, and the write itself is a no-op if the row
    // already has any UTM value.
    void attributeUtmToUser(userId);

    return { ok: true, data: { approved: true } };
  } catch (error) {
    logger.error("[recruiter-auth] registerRecruiterWithOtpAction", {
      error: String(error),
    });
    // The code was only peeked, so a retry can use the same digits until TTL.
    return {
      ok: false,
      message: `Could not complete registration. Try the same code again, or request a new one if it has expired. Write to ${SUPPORT_EMAIL} if this keeps happening.`,
    };
  }
}
