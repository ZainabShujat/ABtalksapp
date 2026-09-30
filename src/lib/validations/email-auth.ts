import { z } from "zod";

/*
 * Plan 154 — boundaries for password and emailed-code sign-in.
 *
 * Password rules follow NIST SP 800-63B: a length floor and ceiling, no
 * composition rules (they push people to "Password1!"), and not the email
 * address itself.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const emailAuthEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.")
  .max(254);

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`);

export const emailCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code.");

/** Which door the person came through — decides which accounts it opens. */
export const authAudienceSchema = z.enum(["candidate", "recruiter"]);
export type AuthAudience = z.infer<typeof authAudienceSchema>;

export function passwordIsNotEmail(email: string, password: string): boolean {
  return password.trim().toLowerCase() !== email.trim().toLowerCase();
}

export const PASSWORD_IS_EMAIL_MESSAGE =
  "Choose a password that isn't your email address.";

export const requestEmailCodeSchema = z.object({
  email: emailAuthEmailSchema,
  purpose: z.enum(["candidate-login", "password-reset"]),
  audience: authAudienceSchema,
});

export const resetPasswordSchema = z
  .object({
    email: emailAuthEmailSchema,
    code: emailCodeSchema,
    newPassword: passwordSchema,
  })
  .refine((v) => passwordIsNotEmail(v.email, v.newPassword), {
    message: PASSWORD_IS_EMAIL_MESSAGE,
    path: ["newPassword"],
  });

export const setPasswordSchema = z.object({
  newPassword: passwordSchema,
  /** Required when the account already has a password. */
  currentPassword: z.string().max(PASSWORD_MAX_LENGTH).optional(),
  /** Required for a first password when the session is not fresh. */
  code: emailCodeSchema.optional(),
});

/** What the `password` Credentials provider accepts. */
export const passwordCredentialsSchema = z.object({
  email: emailAuthEmailSchema,
  // Not `passwordSchema`: an account whose password predates a rule change
  // must still be able to sign in. Only the ceiling is enforced here.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  audience: authAudienceSchema,
});

/** What the `email-code` Credentials provider accepts. */
export const emailCodeCredentialsSchema = z.object({
  email: emailAuthEmailSchema,
  code: emailCodeSchema,
});

/**
 * `code` values the password / email-code providers put on a refused sign-in
 * (`signIn(...).code`). Anything else is a plain "wrong credentials".
 * Shared with the client, so no server imports here.
 */
export const SIGN_IN_ERROR = {
  rateLimited: "rate_limited",
  recruiterAccount: "recruiter_account",
  notRecruiter: "not_recruiter",
} as const;

export function signInErrorMessage(
  code: string | undefined,
  method: "password" | "code",
): string {
  switch (code) {
    case SIGN_IN_ERROR.rateLimited:
      return "Too many sign-in attempts. Wait 15 minutes and try again, or sign in with an emailed code.";
    case SIGN_IN_ERROR.recruiterAccount:
      return "This is a recruiter account. Sign in at ABTalks Hire instead.";
    case SIGN_IN_ERROR.notRecruiter:
      return "This account isn't registered as a recruiter.";
    default:
      return method === "password"
        ? "Email or password is incorrect."
        : "That code isn't right, or it has expired.";
  }
}
