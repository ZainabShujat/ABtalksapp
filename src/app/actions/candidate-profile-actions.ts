"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { auth } from "@/auth";
import { logger } from "@/lib/logger";
import {
  basicInfoSchema,
  certificationSectionSchema,
  educationSectionSchema,
  experienceSectionSchema,
  linksSectionSchema,
  preferencesSchema,
  projectSectionSchema,
  skillSectionSchema,
} from "@/lib/validations/candidate-profile";
import {
  saveBasicInfo,
  saveCertifications,
  saveEducation,
  saveExperience,
  saveLinks,
  savePreferences,
  saveProjects,
  saveSkillClaims,
} from "@/repositories/candidate-detail";

export type ActionResult = { ok: true } | { ok: false; message: string };

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid input";
  // Row index is far more useful than a bare field name in a repeatable list.
  const rowIndex = issue.path.find((p) => typeof p === "number");
  const field = [...issue.path].reverse().find((p) => typeof p === "string");
  const where =
    typeof rowIndex === "number" ? `Entry ${rowIndex + 1}: ` : "";
  return field ? `${where}${String(field)} — ${issue.message}` : `${where}${issue.message}`;
}

/**
 * Every section save runs through here: authenticate, validate at the boundary,
 * write, revalidate. Sections are saved independently so a validation error in
 * one repeatable list never discards a candidate's work in another.
 */
async function runSection<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  label: string,
  write: (userId: string, value: z.infer<S>) => Promise<void>,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "You must be signed in." };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: firstIssue(parsed.error) };
  }

  try {
    await write(session.user.id, parsed.data);
  } catch (error) {
    logger.error(`[profile] ${label} save failed`, {
      userId: session.user.id,
      error: String(error),
    });
    return { ok: false, message: "Could not save. Please try again." };
  }

  revalidatePath("/profile");
  return { ok: true };
}

export async function saveBasicInfoAction(raw: unknown): Promise<ActionResult> {
  return runSection(basicInfoSchema, raw, "basic-info", (userId, value) =>
    saveBasicInfo(userId, {
      fullName: value.fullName,
      // `optionalPhoneSchema` yields "" for absent; the column is nullable.
      phone: value.phone === "" ? null : value.phone,
      headline: value.headline,
      summary: value.summary,
      locationCity: value.locationCity,
      locationRegion: value.locationRegion,
      countryCode: value.countryCode,
      primaryPersona: value.primaryPersona,
    }),
  );
}

export async function saveExperienceAction(
  raw: unknown,
): Promise<ActionResult> {
  return runSection(experienceSectionSchema, raw, "experience", (userId, value) =>
    saveExperience(userId, value.rows),
  );
}

export async function saveEducationAction(raw: unknown): Promise<ActionResult> {
  return runSection(educationSectionSchema, raw, "education", (userId, value) =>
    saveEducation(userId, value.rows),
  );
}

export async function saveProjectsAction(raw: unknown): Promise<ActionResult> {
  return runSection(projectSectionSchema, raw, "projects", (userId, value) =>
    saveProjects(userId, value.rows),
  );
}

export async function saveSkillsAction(raw: unknown): Promise<ActionResult> {
  return runSection(skillSectionSchema, raw, "skills", (userId, value) =>
    saveSkillClaims(userId, value.claims),
  );
}

export async function saveCertificationsAction(
  raw: unknown,
): Promise<ActionResult> {
  return runSection(
    certificationSectionSchema,
    raw,
    "certifications",
    (userId, value) => saveCertifications(userId, value.rows),
  );
}

export async function saveLinksAction(raw: unknown): Promise<ActionResult> {
  return runSection(linksSectionSchema, raw, "links", (userId, value) =>
    saveLinks(userId, {
      linkedinUrl: value.linkedinUrl,
      githubUsername: value.githubUsername,
      portfolioUrl: value.portfolioUrl,
      resumeUrl: value.resumeUrl,
      extra: value.extra,
    }),
  );
}

export async function savePreferencesAction(
  raw: unknown,
): Promise<ActionResult> {
  return runSection(preferencesSchema, raw, "preferences", (userId, value) =>
    savePreferences(userId, value),
  );
}
