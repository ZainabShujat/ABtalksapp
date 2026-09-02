import { z } from "zod";
import {
  CandidateLinkType,
  CandidatePersona,
  GradeType,
  OpportunityType,
  SkillProficiency,
} from "@prisma/client";
import { optionalPhoneSchema } from "@/lib/validations/phone";

/* ─── shared helpers ─────────────────────────────────────────────────────── */

/** Trim, then treat "" as absent. Sections send every field, so "" means clear. */
const emptyToNull = (s: unknown) => {
  if (typeof s !== "string") return s;
  const t = s.trim();
  return t === "" ? null : t;
};

const nullableText = (max: number) =>
  z.preprocess(emptyToNull, z.string().max(max).nullable().default(null));

const nullableUrl = z.preprocess(
  emptyToNull,
  z.string().url("Must be a valid URL").max(500).nullable().default(null),
);

const MONTH = z.coerce.number().int().min(1).max(12);
const YEAR = z.coerce.number().int().min(1950).max(2040);

const nullableMonth = z.preprocess(emptyToNull, MONTH.nullable().default(null));
const nullableYear = z.preprocess(emptyToNull, YEAR.nullable().default(null));

/** Only `collegeId` round-trips a real id — repeatable rows are replaced wholesale. */
const nullableCuid = z.preprocess(
  emptyToNull,
  z.string().cuid().nullable().default(null),
);

/**
 * GitHub is stored as a bare username on `CandidateProfile.githubUsername`.
 * The editor accepts either the handle or any form of profile URL; both land on
 * the handle. Adding a second `githubUrl` column for form convenience would
 * create a fifth place the same fact lives.
 */
export function normalizeGithubUsername(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  const urlish = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.*)$/i.exec(trimmed);
  if (urlish) {
    // Take the first path segment, dropping query/hash and any trailing path.
    candidate = (urlish[1] ?? "").split(/[/?#]/)[0] ?? "";
  } else if (trimmed.startsWith("@")) {
    candidate = trimmed.slice(1);
  }

  candidate = candidate.trim();
  if (!candidate) return null;
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(candidate)) {
    return null;
  }
  return candidate;
}

const githubField = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const t = value.trim();
  return t === "" ? null : t;
}, z
  .string()
  .nullable()
  .default(null)
  .superRefine((value, ctx) => {
    if (value === null) return;
    if (normalizeGithubUsername(value) === null) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a GitHub username or profile URL",
      });
    }
  })
  .transform((value) => (value === null ? null : normalizeGithubUsername(value))));

/* ─── Basic information ──────────────────────────────────────────────────── */

export const basicInfoSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required").max(200),
  phone: optionalPhoneSchema,
  headline: nullableText(160),
  summary: nullableText(2000),
  locationCity: nullableText(120),
  locationRegion: nullableText(120),
  countryCode: z.preprocess(
    emptyToNull,
    z
      .string()
      .length(2, "Use a 2-letter country code")
      .toUpperCase()
      .nullable()
      .default(null),
  ),
  primaryPersona: z.enum(CandidatePersona),
});

export type BasicInfoInput = z.infer<typeof basicInfoSchema>;

/* ─── Experience ─────────────────────────────────────────────────────────── */

const experienceRowSchema = z
  .object({
    companyName: z.string().trim().min(1, "Company is required").max(200),
    title: z.string().trim().min(1, "Role is required").max(200),
    employmentType: nullableText(60),
    locationCity: nullableText(120),
    startMonth: MONTH,
    startYear: YEAR,
    endMonth: nullableMonth,
    endYear: nullableYear,
    isCurrent: z.coerce.boolean().default(false),
    description: nullableText(4000),
  })
  .superRefine((row, ctx) => {
    if (!row.isCurrent && (row.endMonth === null || row.endYear === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["endYear"],
        message: "Add an end date or tick “Currently working here”",
      });
      return;
    }
    if (row.isCurrent) return;
    const start = row.startYear * 12 + row.startMonth;
    const end = row.endYear! * 12 + row.endMonth!;
    if (end < start) {
      ctx.addIssue({
        code: "custom",
        path: ["endYear"],
        message: "End date cannot be before the start date",
      });
    }
  });

export const experienceSectionSchema = z.object({
  rows: z.array(experienceRowSchema).max(25, "At most 25 roles"),
});

export type ExperienceRowInput = z.infer<typeof experienceRowSchema>;

/* ─── Education ──────────────────────────────────────────────────────────── */

const educationRowSchema = z
  .object({
    institutionName: z
      .string()
      .trim()
      .min(1, "School or college is required")
      .max(200),
    collegeId: nullableCuid,
    degree: nullableText(160),
    fieldOfStudy: nullableText(160),
    startMonth: nullableMonth,
    startYear: nullableYear,
    endMonth: nullableMonth,
    graduationYear: nullableYear,
    isCurrent: z.coerce.boolean().default(false),
    gradeType: z.preprocess(
      emptyToNull,
      z.enum(GradeType).nullable().default(null),
    ),
    grade: nullableText(40),
    description: nullableText(4000),
  })
  .superRefine((row, ctx) => {
    if (!row.isCurrent && row.graduationYear === null) {
      ctx.addIssue({
        code: "custom",
        path: ["graduationYear"],
        message: "Add an end year or tick “Currently studying here”",
      });
      return;
    }
    if (row.isCurrent || row.startYear === null || row.graduationYear === null) {
      return;
    }
    const start = row.startYear * 12 + (row.startMonth ?? 1);
    const end = row.graduationYear * 12 + (row.endMonth ?? 12);
    if (end < start) {
      ctx.addIssue({
        code: "custom",
        path: ["graduationYear"],
        message: "End date cannot be before the start date",
      });
    }
  });

export const educationSectionSchema = z.object({
  rows: z.array(educationRowSchema).max(15, "At most 15 education entries"),
});

export type EducationRowInput = z.infer<typeof educationRowSchema>;

/* ─── Projects ───────────────────────────────────────────────────────────── */

const projectRowSchema = z.object({
  title: z.string().trim().min(1, "Project name is required").max(200),
  description: nullableText(4000),
  techStack: z
    .array(z.string().trim().min(1).max(60))
    .max(20, "At most 20 stack entries")
    .default([]),
  repoUrl: nullableUrl,
  liveUrl: nullableUrl,
});

export const projectSectionSchema = z.object({
  rows: z.array(projectRowSchema).max(25, "At most 25 projects"),
});

export type ProjectRowInput = z.infer<typeof projectRowSchema>;

/* ─── Skills ─────────────────────────────────────────────────────────────── */

/**
 * A claim is a skill id plus an optional self-rating. `selfRated` is the
 * candidate's own assessment and is never mixed with `evidenceScore` /
 * `verified`, which are derived from `SkillEvidence` alone.
 */
const skillClaimSchema = z.object({
  skillId: z.string().cuid(),
  selfRated: z.preprocess(
    emptyToNull,
    z.enum(SkillProficiency).nullable().default(null),
  ),
});

export const skillSectionSchema = z.object({
  claims: z
    .array(skillClaimSchema)
    .max(60, "At most 60 skills")
    .refine(
      (rows) => new Set(rows.map((r) => r.skillId)).size === rows.length,
      "Duplicate skill",
    ),
});

export type SkillClaimInput = z.infer<typeof skillClaimSchema>;

/* ─── Certifications ─────────────────────────────────────────────────────── */

const certificationRowSchema = z
  .object({
    name: z.string().trim().min(1, "Certification name is required").max(200),
    issuer: z.string().trim().min(1, "Issuer is required").max(200),
    issuedMonth: nullableMonth,
    issuedYear: nullableYear,
    expiresMonth: nullableMonth,
    expiresYear: nullableYear,
    credentialUrl: nullableUrl,
  })
  .superRefine((row, ctx) => {
    if (row.issuedYear === null || row.expiresYear === null) return;
    const issued = row.issuedYear * 12 + (row.issuedMonth ?? 1);
    const expires = row.expiresYear * 12 + (row.expiresMonth ?? 12);
    if (expires < issued) {
      ctx.addIssue({
        code: "custom",
        path: ["expiresYear"],
        message: "Expiry cannot be before the issue date",
      });
    }
  });

export const certificationSectionSchema = z.object({
  rows: z.array(certificationRowSchema).max(30, "At most 30 certifications"),
});

export type CertificationRowInput = z.infer<typeof certificationRowSchema>;

/* ─── Links ──────────────────────────────────────────────────────────────── */

const extraLinkSchema = z
  .object({
    type: z.enum(CandidateLinkType),
    label: nullableText(80),
    url: z.string().trim().url("Must be a valid URL").max(500),
  })
  .superRefine((row, ctx) => {
    if (row.type === CandidateLinkType.OTHER && !row.label) {
      ctx.addIssue({
        code: "custom",
        path: ["label"],
        message: "Add a label for this link",
      });
    }
  });

export const linksSectionSchema = z.object({
  linkedinUrl: nullableUrl,
  githubUsername: githubField,
  portfolioUrl: nullableUrl,
  /**
   * Optional, and absent from the Links form since plan 106 moved the resume
   * into its own profile section. It stays in the schema so any older client
   * still round-trips it, but a Links save that omits it must NOT clear the
   * resume the candidate uploaded — see `saveLinks`.
   */
  resumeUrl: nullableUrl.optional(),
  extra: z.array(extraLinkSchema).max(15, "At most 15 additional links"),
});

export type ExtraLinkInput = z.infer<typeof extraLinkSchema>;
export type LinksInput = z.infer<typeof linksSectionSchema>;

/* ─── Career preferences ─────────────────────────────────────────────────── */

/**
 * Employment preference only. This section can never change recruiter
 * discoverability — that is `CandidateVisibility.searchableByRecruiters`, which
 * no field here touches.
 */
export const preferencesSchema = z.object({
  openToWork: z.coerce.boolean().default(false),
  preferredRoles: z
    .array(z.string().trim().min(1).max(120))
    .max(10, "At most 10 roles")
    .default([]),
  preferredLocations: z
    .array(z.string().trim().min(1).max(120))
    .max(10, "At most 10 locations")
    .default([]),
  opportunityTypes: z.array(z.enum(OpportunityType)).max(5).default([]),
  remotePreference: nullableText(40),
  willingToRelocate: z.coerce.boolean().default(false),
  noticePeriodDays: z.preprocess(
    emptyToNull,
    z.coerce.number().int().min(0).max(365).nullable().default(null),
  ),
  availableFromMonth: nullableMonth,
  availableFromYear: nullableYear,
});

export type PreferencesInput = z.infer<typeof preferencesSchema>;
