import { z } from "zod";
import { workEmailSchema } from "@/lib/validations/work-email";
import {
  PASSWORD_IS_EMAIL_MESSAGE,
  passwordIsNotEmail,
  passwordSchema,
} from "@/lib/validations/email-auth";

export const requestRecruiterOtpSchema = z.object({
  email: z.string().trim().email().max(200),
  /** Registering decides the gate: open to apply, closed to sign in. */
  intent: z.enum(["register", "signin"]),
});

/**
 * A person's name carries no digits. Written as a REJECTION of digits rather
 * than a whitelist of allowed characters: a whitelist would have to enumerate
 * every script, accent, apostrophe, hyphen and particle a real name can hold,
 * and every such list eventually rejects somebody's actual name. `\p{Nd}`
 * covers every Unicode decimal digit, not just 0-9, so a name padded with
 * Devanagari or Arabic-Indic numerals is caught the same way "Sarthak123" is.
 */
const NAME_HAS_DIGIT = /\p{Nd}/u;

export const registerRecruiterSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Enter your full name.")
      .max(120)
      .refine((v) => !NAME_HAS_DIGIT.test(v), "Full name cannot contain numbers."),
    company: z.string().trim().min(2, "Enter your company.").max(200),
    /** Work domains only — a free consumer mailbox never becomes a recruiter. */
    email: workEmailSchema,
    /** Optional, and not verified — it is a contact detail, not a credential. */
    phone: z.string().trim().max(20).optional(),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Enter the 6-digit code."),
    acceptedTerms: z.literal(true, {
      message: "Please accept the Terms and Privacy Policy.",
    }),
    newsletterOptIn: z.boolean(),
    /** Plan 154: optional. Blank means sign in by emailed code only. */
    password: passwordSchema.optional(),
  })
  .refine((v) => !v.password || passwordIsNotEmail(v.email, v.password), {
    message: PASSWORD_IS_EMAIL_MESSAGE,
    path: ["password"],
  });

export const verifyRecruiterOtpSchema = z.object({
  email: z.string().trim().email().max(200),
  /** Exactly six digits — anything else never reaches the database. */
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code."),
});
