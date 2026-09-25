import { z } from "zod";
import { legalAcceptanceSchema } from "@/lib/validations/legal";
import { ACCEPTED_DIAL_CODES } from "@/features/hackathon-video/phone-countries";

/**
 * VideoThon (video editors hackathon) registration payload.
 *
 * Identity is NOT in this schema: `fullName` and `email` are read from the
 * session on the server, never trusted from the client. Everything else the
 * form asks for lives here.
 */

const trimmedString = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max);

const phoneCountryCodeSchema = z
  .string()
  .trim()
  .refine((v) => ACCEPTED_DIAL_CODES.has(v), {
    message: "Pick a country code from the list",
  });

/**
 * Digits, spaces, dashes, and parentheses allowed on input for user comfort;
 * the server strips everything but digits before storage. The digit-count
 * bounds (6–15) cover every country in `phone-countries.ts` — E.164 caps at
 * 15 digits and every real country uses at least 6 subscriber digits.
 */
const phoneNumberSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[^\d]/g, ""))
  .pipe(
    z
      .string()
      .min(6, "Phone number looks too short")
      .max(15, "Phone number looks too long"),
  );

/**
 * CTC is intentionally free-text so it can hold a rupees-per-year number or
 * the literal string "NA" (freelance, between jobs, prefers not to say).
 * The Working-vs-Learner conditional-required check runs on the whole payload
 * below via `.superRefine`.
 */
const currentCtcSchema = z
  .string()
  .trim()
  .max(60, "Keep it under 60 characters")
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

/**
 * Portfolio URL: any `https://` URL is accepted (Drive, Behance, YouTube,
 * personal site — per organizer's answer 5). No host restriction.
 */
const portfolioUrlSchema = z
  .string()
  .trim()
  .max(500, "Keep the link under 500 characters")
  .url("Enter a full URL, including https://")
  .refine((v) => v.startsWith("https://"), {
    message: "Link must use https://",
  });

export const videoRegistrationSchema = z
  .object({
    phoneCountryCode: phoneCountryCodeSchema,
    phoneNumber: phoneNumberSchema,
    city: trimmedString(120, "City is required"),
    employment: z.enum(["LEARNER", "WORKING"]),
    currentCtc: currentCtcSchema,
    portfolioUrl: portfolioUrlSchema,
  })
  .merge(legalAcceptanceSchema)
  .superRefine((data, ctx) => {
    if (data.employment === "WORKING" && !data.currentCtc) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentCtc"],
        message: "Add your current CTC (or type NA)",
      });
    }
  });

export type VideoRegistrationInput = z.infer<typeof videoRegistrationSchema>;

/**
 * VideoThon submission — one link the judges open.
 *
 * Any `https://` URL, no host lock. Matches the portfolio-url rule.
 */
export const videoSubmissionSchema = z.object({
  submissionUrl: z
    .string()
    .trim()
    .max(500, "Keep the link under 500 characters")
    .url("Enter a full URL, including https://")
    .refine((v) => v.startsWith("https://"), {
      message: "Link must use https://",
    }),
  notes: z
    .string()
    .trim()
    .max(1000, "Keep notes under 1000 characters")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

export type VideoSubmissionInput = z.infer<typeof videoSubmissionSchema>;

/** Reused from the code hackathon — `?s=<slug>` attribution. */
export const videoSourceSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_-]{1,32}$/);
