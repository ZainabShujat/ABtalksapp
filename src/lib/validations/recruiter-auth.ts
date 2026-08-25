import { z } from "zod";

export const requestRecruiterOtpSchema = z.object({
  email: z.string().trim().email().max(200),
  /** Registering decides the gate: open to apply, closed to sign in. */
  intent: z.enum(["register", "signin"]),
});

export const registerRecruiterSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(120),
  company: z.string().trim().min(2, "Enter your company.").max(200),
  email: z.string().trim().email("Enter a valid work email.").max(200),
  /** Optional, and not verified — it is a contact detail, not a credential. */
  phone: z.string().trim().max(20).optional(),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code."),
  acceptedTerms: z.literal(true, {
    message: "Please accept the Terms and Privacy Policy.",
  }),
  newsletterOptIn: z.boolean(),
});

export const verifyRecruiterOtpSchema = z.object({
  email: z.string().trim().email().max(200),
  /** Exactly six digits — anything else never reaches the database. */
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code."),
});

