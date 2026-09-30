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
 * Registration collects only what the résumé cannot give us: who they are, how
 * to reach them, and whether they are a student or a working professional.
 *
 * College, company / role / years, headline, city, state and country used to be
 * asked for here. College and company were written as `CandidateEducation` /
 * `CandidateExperience` rows, and the résumé merge straight after registration
 * (`features/resume/merge/plan.ts`) added its own rows for the same school and
 * job — so the profile showed each one twice. The merge fills all of these in,
 * additively, and the profile editor covers anyone who skips the upload.
 */
const registerPayloadBase = z
  .object({
    fullName: z.string().trim().min(1, "Full name is required").max(200),
    userType: z.enum(["STUDENT", "PROFESSIONAL"], {
      error: "Please select whether you are a student or a working professional",
    }),
    /**
     * Dialing code, e.g. "+91". Drives whether OTP verification is required.
     * Named `phoneCountryCode` rather than `countryCode` because
     * `CandidateProfile.countryCode` is the ISO-2 country ("IN"), a different fact.
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
 * `completeRegistrationAction` builds this from `FormData`. `userType` has no
 * default: the candidate must pick one.
 *
 * The résumé is NOT in here. Upload is optional and uses its own action; when a
 * READY row exists, `completeRegistrationAction` merges it after the profile
 * is created.
 */
export const registerPayloadSchema = registerPayloadBase
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
