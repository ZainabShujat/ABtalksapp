import { z } from "zod";
import { optionalPhoneSchema } from "@/lib/validations/phone";

function trimEmptyToUndefined(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  const t = s.trim();
  return t === "" ? undefined : t;
}

const profileCommonFields = {
  fullName: z.string().trim().min(1, "Full name is required").max(200),
  skills: z
    .array(z.string().trim().min(1, "Skills cannot be blank").max(80))
    .max(10, "At most 10 skills"),
  linkedinUrl: z
    .string()
    .default("")
    .transform((s) => trimEmptyToUndefined(s.trim()))
    .pipe(z.union([z.undefined(), z.string().url("Must be a valid URL")])),
  resumeUrl: z
    .union([z.literal(""), z.string().url("Must be a valid URL")])
    .default(""),
  githubUsername: z
    .string()
    .default("")
    .transform((s) => trimEmptyToUndefined(s.trim()))
    .pipe(
      z.union([
        z.undefined(),
        z.string().regex(/^[a-zA-Z0-9-]+$/, {
          message:
            "GitHub username may only contain letters, numbers, and hyphens",
        }),
      ]),
    ),
  phone: optionalPhoneSchema,
};

export const updateStudentProfileSchema = z.object({
  userType: z.literal("STUDENT"),
  ...profileCommonFields,
  college: z.string().trim().min(1, "College is required").max(200),
  collegeId: z.union([z.literal(""), z.string().cuid()]).default(""),
  graduationYear: z.coerce.number().int().min(2020).max(2035),
});

export const updateProfessionalProfileSchema = z.object({
  userType: z.literal("PROFESSIONAL"),
  ...profileCommonFields,
  organization: z
    .string()
    .trim()
    .min(1, "Organization is required")
    .max(200),
  role: z.string().trim().min(1, "Role is required").max(200),
  yearsExperience: z.coerce.number().int().min(0).max(60),
});

export type UpdateStudentProfileInput = z.infer<typeof updateStudentProfileSchema>;
export type UpdateProfessionalProfileInput = z.infer<
  typeof updateProfessionalProfileSchema
>;

export type StudentProfileFormValues = z.input<typeof updateStudentProfileSchema>;
export type ProfessionalProfileFormValues = z.input<
  typeof updateProfessionalProfileSchema
>;

export type ProfileFormValues =
  | StudentProfileFormValues
  | ProfessionalProfileFormValues;

/** @deprecated Use discriminated ProfileFormValues */
export type UpdateProfileInput = UpdateStudentProfileInput;
