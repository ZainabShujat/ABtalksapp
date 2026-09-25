import { z } from "zod";
import {
  INDIA_DIALING_CODE,
  indianMobileNumberSchema,
  optionalPhoneSchema,
} from "@/lib/validations/phone";
import { legalAcceptanceSchema } from "@/lib/validations/legal";
import { normalizeGithubUsername } from "@/lib/validations/candidate-profile";

const empty = z.literal("");

/** Explicit literals so validation never depends on a stale bundled `Domain` object. */
const domainSchema = z.enum(["SE", "DS", "AI", "CLAUDE"]);

/**
 * Legacy flat schema — matches the current registration form (no `userType` field).
 * Phone stays optional here so existing registrations keep working.
 */
export const registerSchema = z.object({
  fullName: z.string().min(1, "Name is required").max(200),
  college: z.string().min(1, "College is required").max(200),
  graduationYear: z.number().int().min(2020).max(2035),
  domain: domainSchema,
  skills: z.array(z.string().min(1).max(50)).max(100).default([]),
  linkedinUrl: z.union([empty, z.string().url()]).default(""),
  phone: optionalPhoneSchema,
  githubUsername: z
    .string()
    .trim()
    .refine((v) => v === "" || normalizeGithubUsername(v) !== null, {
      message: "Enter a valid GitHub username or profile URL",
    })
    .transform((v) => (v === "" ? "" : normalizeGithubUsername(v)!))
    .default(""),
  referralCode: z
    .union([empty, z.string().length(6).regex(/^[A-Z0-9]{6}$/)])
    .default(""),
});

export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Registration collects the ONE fact the résumé cannot be trusted to give us —
 * where the candidate studies or works — and nothing else about their history.
 *
 * Graduation year, LinkedIn, GitHub and skills used to be asked for here. They
 * are all things the résumé parser fills in (`features/resume/merge/plan.ts`),
 * additively and without overwriting anything the candidate later types, so
 * asking twice bought a longer form and a worse answer.
 */
const studentFields = z.object({
  userType: z.literal("STUDENT"),
  college: z.string().trim().min(1, "College is required").max(200),
  collegeId: z.union([z.literal(""), z.string().cuid()]).default(""),
});

const professionalFields = z.object({
  userType: z.literal("PROFESSIONAL"),
  organization: z.string().trim().min(1, "Company is required").max(200),
  role: z.string().trim().min(1, "Role is required").max(200),
  yearsExperience: z
    .number({ error: "Years of experience is required" })
    .int()
    .min(0)
    .max(60),
});

const registerPayloadBase = z
  .object({
    fullName: z.string().trim().min(1, "Name is required").max(200),
    /**
     * The basic-info block. Same fields, same limits and same storage as
     * `basicInfoSchema` in `validations/candidate-profile.ts` — registration
     * writes them once and the profile editor edits them afterwards. Required
     * here where that schema allows null, because a candidate with no city and
     * no headline is not findable on `/hire`.
     */
    headline: z.string().trim().min(1, "Headline is required").max(160),
    locationCity: z.string().trim().min(1, "City is required").max(120),
    locationRegion: z
      .string()
      .trim()
      .min(1, "State / region is required")
      .max(120),
    /** ISO-3166-1 alpha-2, as stored on `CandidateProfile.countryCode` (char(2)). */
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "Use a 2-letter country code"),
    /**
     * Dialing code, e.g. "+91". Drives whether OTP verification is required.
     * Named apart from `countryCode` on purpose: one is "+91" and the other is
     * "IN", and they were the same key until the basic-info fields moved here.
     */
    phoneCountryCode: z.string().default(INDIA_DIALING_CODE),
    /** National number (no dialing code). Required + valid when +91. */
    phoneNumber: z.string().default(""),
    referralCode: z
      .union([empty, z.string().length(6).regex(/^[A-Z0-9]{6}$/)])
      .default(""),
  })
  .merge(legalAcceptanceSchema);

/**
 * Server-side registration payload (students + professionals).
 * `completeRegistrationAction` builds this from `FormData` (including default `userType`).
 *
 * The résumé is NOT in here. Upload is optional and uses its own action; when a
 * READY row exists, `completeRegistrationAction` merges it after the profile
 * is created.
 */
export const registerPayloadSchema = z
  .discriminatedUnion("userType", [
    registerPayloadBase.merge(studentFields),
    registerPayloadBase.merge(professionalFields),
  ])
  .superRefine((val, ctx) => {
    // India (+91) numbers are mandatory and must be a valid 10-digit mobile.
    // OTP verification itself is enforced server-side in completeRegistration.
    if (val.phoneCountryCode === INDIA_DIALING_CODE) {
      if (!val.phoneNumber || val.phoneNumber.trim() === "") {
        ctx.addIssue({
          code: "custom",
          message: "Phone number is required",
          path: ["phoneNumber"],
        });
      } else if (!indianMobileNumberSchema.safeParse(val.phoneNumber).success) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a valid 10-digit Indian mobile number",
          path: ["phoneNumber"],
        });
      }
    }
  });

export type RegisterPayloadInput = z.infer<typeof registerPayloadSchema>;
