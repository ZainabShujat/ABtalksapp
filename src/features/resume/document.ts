import { z } from "zod";
import type { ParsedResume, ResumeAnalysis } from "@/features/resume/types";

/**
 * The résumé document contract.
 *
 * Follows `InterviewReport` / `MockInterviewReport`: the stored JSON is
 * validated **on write AND on read**, and the row carries a `documentVersion`
 * column. A row written by an older deploy fails `readResumeDocument` and the
 * section degrades to "unavailable" — the same trade those models make, and the
 * reason they make it: half a rendered page is worse than an honest empty one.
 *
 * `normalizeParsedResume` (the port of the agent's `normalize_resume_parsed`)
 * runs first and is what makes a model's loose output conform. This schema is
 * the guard AFTER it, and the guard for anything already in the database.
 *
 * Pure — no `server-only` — so the test file can round-trip documents directly.
 */

/** Bumped when the document shape changes. Rows below this are unreadable. */
export const RESUME_DOCUMENT_VERSION = 1;

const nullableString = z.string().nullable();
const stringList = z.array(z.string());

const projectSchema = z.object({
  title: nullableString,
  description: nullableString,
  technologies: stringList,
  github: nullableString,
  demo: nullableString,
  contributions: stringList,
});

const experienceSchema = z.object({
  title: nullableString,
  company: nullableString,
  employmentType: nullableString,
  duration: nullableString,
  responsibilities: stringList,
  achievements: stringList,
  technologies: stringList,
});

const educationSchema = z.object({
  degree: nullableString,
  branch: nullableString,
  institution: nullableString,
  year: nullableString,
  cgpa: nullableString,
});

const internshipSchema = z.object({
  company: nullableString,
  role: nullableString,
  duration: nullableString,
  summary: nullableString,
});

/**
 * Strict on shape, permissive on content. An unknown key is a schema drift and
 * is rejected; an empty résumé is perfectly valid and scores accordingly.
 */
export const resumeDocumentSchema = z
  .object({
    candidateName: nullableString,
    headline: nullableString,
    email: nullableString,
    phone: nullableString,
    location: nullableString,
    linkedin: nullableString,
    github: nullableString,
    portfolio: nullableString,
    website: nullableString,
    summary: nullableString,
    careerLevel: nullableString,
    primaryDomain: nullableString,
    estimatedExperienceYears: z.number().min(0).max(60),
    skills: stringList,
    technicalSkills: stringList,
    softSkills: stringList,
    programmingLanguages: stringList,
    frameworks: stringList,
    databases: stringList,
    cloudPlatforms: stringList,
    tools: stringList,
    certifications: stringList,
    achievements: stringList,
    languages: stringList,
    projects: z.array(projectSchema),
    experience: z.array(experienceSchema),
    education: z.array(educationSchema),
    internships: z.array(internshipSchema),
  })
  .strict();

const categoriesSchema = z
  .object({
    completeness: z.number().int().min(0).max(100),
    contentQuality: z.number().int().min(0).max(100),
    impact: z.number().int().min(0).max(100),
    structure: z.number().int().min(0).max(100),
    skillsEvidence: z.number().int().min(0).max(100),
    experienceProjectStrength: z.number().int().min(0).max(100),
    professionalReadiness: z.number().int().min(0).max(100),
  })
  .strict();

export const resumeAnalysisSchema = z
  .object({
    overallScore: z.number().int().min(0).max(100),
    categories: categoriesSchema,
    strengths: stringList,
    weaknesses: stringList,
    recommendations: stringList,
    version: z.number().int(),
  })
  .strict();

/**
 * Compile-time proof that the schema and the hand-written type cannot drift.
 * If either side gains a field the other lacks, this stops compiling.
 */
type SchemaResume = z.infer<typeof resumeDocumentSchema>;
type SchemaAnalysis = z.infer<typeof resumeAnalysisSchema>;
const _resumeMatches: SchemaResume extends ParsedResume ? true : never = true;
const _resumeMatchesBack: ParsedResume extends SchemaResume ? true : never = true;
const _analysisMatches: SchemaAnalysis extends ResumeAnalysis ? true : never = true;
const _analysisMatchesBack: ResumeAnalysis extends SchemaAnalysis ? true : never = true;
void _resumeMatches;
void _resumeMatchesBack;
void _analysisMatches;
void _analysisMatchesBack;

/** Read guard. Returns null rather than throwing, so a bad row degrades. */
export function readResumeDocument(
  value: unknown,
  version: number,
): ParsedResume | null {
  if (version !== RESUME_DOCUMENT_VERSION) return null;
  const parsed = resumeDocumentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function readResumeAnalysis(value: unknown): ResumeAnalysis | null {
  const parsed = resumeAnalysisSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
