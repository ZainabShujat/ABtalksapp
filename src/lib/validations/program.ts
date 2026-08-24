import { z } from "zod";
import { PROGRAM_TOTAL_DAYS } from "@/features/program/constants";
import { optionalPhoneSchema } from "./phone";
import { legalAcceptanceSchema } from "./legal";

const githubUsernameRegex = /^[a-zA-Z0-9-]{1,39}$/;
const githubRepoRegex =
  /^https:\/\/github\.com\/([a-zA-Z0-9-]{1,39})\/([a-zA-Z0-9._-]{1,100})\/?$/;

export const applyProfileSchema = z
  .object({
    fullName: z.string().trim().min(1, "Full name is required").max(120),
    jobRole: z.string().trim().min(1, "Current role is required").max(120),
    company: z.string().trim().min(1, "Company is required").max(120),
    yearsExperience: z.coerce
      .number({ error: "Enter your years of experience" })
      .int("Enter a whole number")
      .min(0, "Cannot be negative")
      .max(40, "Max 40 years"),
    education: z.string().trim().max(160).optional().or(z.literal("")),
    university: z.string().trim().max(160).optional().or(z.literal("")),
    graduationYear: z
      .union([
        z.literal(""),
        z.coerce.number().int().min(1950, "Invalid year").max(2035, "Invalid year"),
      ])
      .optional(),
    skills: z
      .array(z.string().trim().min(1).max(40))
      .min(1, "Add at least one skill")
      .max(8, "Max 8 skills"),
    linkedinUrl: z
      .string()
      .trim()
      .url("Enter a valid URL")
      .refine((v) => /linkedin\.com/i.test(v), "Enter your LinkedIn profile URL"),
    resumeUrl: z
      .union([z.literal(""), z.string().trim().url("Enter a valid URL")])
      .optional(),
    phone: optionalPhoneSchema,
    githubUsername: z
      .string()
      .trim()
      .regex(githubUsernameRegex, "Enter a valid GitHub username"),
    githubRepoUrl: z
      .string()
      .trim()
      .regex(
        githubRepoRegex,
        "Enter a public repo URL like https://github.com/owner/repo",
      ),
    hasLaptop8Gb: z.literal(true, {
      error: "Confirm you have a laptop with at least 8 GB RAM",
    }),
    // Accepted if a stale client still posts it; ignored. Not a candidate preference.
    recruiterVisibilityConsent: z.boolean().optional(),
  })
  .merge(legalAcceptanceSchema)
  .refine(
    (data) => {
      const match = data.githubRepoUrl.match(githubRepoRegex);
      if (!match) return false;
      return match[1]!.toLowerCase() === data.githubUsername.toLowerCase();
    },
    {
      path: ["githubRepoUrl"],
      message: "The repo owner must match your GitHub username",
    },
  );

export type ApplyProfileInput = z.infer<typeof applyProfileSchema>;

export const joinCodeSchema = z
  .string()
  .trim()
  .min(4, "Enter a valid join code")
  .max(16, "Enter a valid join code")
  .transform((v) => v.toUpperCase().replace(/[^A-Z0-9]/g, ""));

export const applyToProgramSchema = applyProfileSchema.and(
  z.object({ joinCode: joinCodeSchema }),
);

export type ApplyToProgramInput = z.infer<typeof applyToProgramSchema>;

export const entrySubmitSchema = z.object({
  attemptId: z.string().cuid(),
  answers: z
    .array(z.number().int().min(0).max(3).nullable())
    .length(20, "Expected 20 answers"),
});

export type EntrySubmitInput = z.infer<typeof entrySubmitSchema>;

export const missionDaySchema = z.object({
  dayNumber: z.number().int().min(1).max(PROGRAM_TOTAL_DAYS),
});

export const codeSprintPayloadSchema = z.object({
  code: z.string().max(20_000),
  hiddenOutputs: z.array(z.string().max(20_000)).max(20),
});

export const dataRoomPayloadSchema = z.object({
  answers: z
    .array(z.union([z.string().max(500), z.number()]))
    .max(20),
});

export const promptForgePayloadSchema = z.object({
  prompt: z.string().max(4_000),
});

export const bossBuildPayloadSchema = z.object({
  repoUrl: z.string().url().max(500),
  writeup: z.string().max(10_000),
});

export const submitMissionSchema = z.object({
  dayNumber: z.number().int().min(1).max(PROGRAM_TOTAL_DAYS),
  payload: z.union([
    codeSprintPayloadSchema,
    dataRoomPayloadSchema,
    promptForgePayloadSchema,
    bossBuildPayloadSchema,
    z.object({}),
  ]),
});

export const conceptStartSchema = z.object({
  dayNumber: z.number().int().min(1).max(PROGRAM_TOTAL_DAYS),
});

export const conceptSubmitSchema = z.object({
  attemptId: z.string().cuid(),
  answers: z.array(z.number().int().min(0).max(3).nullable()).length(3),
});

export const mentorReviewSchema = z.object({
  dayNumber: z.number().int().min(1).max(PROGRAM_TOTAL_DAYS),
});

export const gradeProjectSchema = z.object({
  projectId: z.string().cuid(),
});

export const overrideProjectScoreSchema = z.object({
  projectId: z.string().cuid(),
  score: z.number().int().min(0).max(100),
  reason: z.string().trim().min(1).max(500),
});

export const generateRecommendationsSchema = z.object({
  cohortId: z.string().cuid(),
});

export const interviewTranscriptLineSchema = z.object({
  role: z.enum(["ai", "candidate"]),
  text: z.string().max(5000),
  ts: z.number(),
});

export const completeInterviewSchema = z.object({
  transcript: z.array(interviewTranscriptLineSchema).max(400),
  durationSec: z.number().int().min(0).max(1200),
});

export const adminEvaluateInterviewSchema = z.object({
  interviewId: z.string().cuid(),
});

export const adminResetInterviewSchema = z.object({
  memberId: z.string().cuid(),
  reason: z.string().trim().min(1).max(500),
});

export const cohortFormSchema = z
  .object({
    cohortId: z.string().cuid().optional(),
    name: z.string().trim().min(1).max(120),
    startsAt: z.string().min(1),
    endsAt: z.string().min(1),
    capacity: z.coerce.number().int().min(1).max(100),
    requiresJoinCode: z.boolean().default(true),
  })
  .refine((d) => new Date(d.startsAt) < new Date(d.endsAt), {
    message: "Start must be before end.",
    path: ["endsAt"],
  });

export const cohortStatusSchema = z.object({
  cohortId: z.string().cuid(),
  status: z.enum(["DRAFT", "ENROLLING", "ACTIVE", "COMPLETED", "ARCHIVED"]),
});

export const cohortIdSchema = z.object({
  cohortId: z.string().cuid(),
});

export const regenerateJoinCodeSchema = z.object({
  cohortId: z.string().cuid(),
});

export const adminMemberActionSchema = z.object({
  memberId: z.string().cuid(),
  reason: z.string().trim().min(1).max(500),
});

export const adminUnlockDaySchema = z.object({
  memberId: z.string().cuid(),
  day: z.number().int().min(1).max(PROGRAM_TOTAL_DAYS),
  reason: z.string().trim().min(1).max(500),
});

export const adminMemberIdSchema = z.object({
  memberId: z.string().cuid(),
});
