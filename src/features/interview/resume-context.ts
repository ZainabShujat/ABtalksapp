import "server-only";
import { prisma } from "@/lib/db";
import {
  parseExperience,
  parseProjects,
  parseSkillGroups,
} from "@/lib/validations/recruiter";
import type { ResumeContext } from "@/features/interview/types";

/**
 * ABTalks has no parsed resume. `StudentProfile.resumeUrl` is a user-typed link
 * that is never fetched or parsed, and no text-extraction path exists (see
 * docs/plans/066). Resume context is therefore an OPTIONAL, degrading input:
 *
 *   1. RecruiterReview  — structured, but admin-entered and rare
 *   2. StudentProfile   — self-reported skills/role/experience
 *   3. nothing
 *
 * Challenge context is the primary signal and is always present. `hasStructuredResume`
 * lets the planner avoid asking resume-grounded questions it cannot ground.
 */
export async function buildResumeContext(
  userId: string,
): Promise<ResumeContext> {
  const [profile, review] = await Promise.all([
    prisma.studentProfile.findUnique({
      where: { userId },
      select: { skills: true, role: true, resumeUrl: true },
    }),
    prisma.recruiterReview.findUnique({
      where: { userId },
      select: {
        targetRole: true,
        headline: true,
        summary: true,
        skillGroups: true,
        experience: true,
        projects: true,
      },
    }),
  ]);

  const profileSkills = profile?.skills ?? [];
  const resumeUrl = profile?.resumeUrl ?? null;

  if (!review) {
    return {
      hasStructuredResume: false,
      headline: null,
      summary: null,
      targetRole: profile?.role ?? null,
      skills: profileSkills,
      experience: [],
      projects: [],
      resumeUrl,
    };
  }

  const skillGroups = parseSkillGroups(review.skillGroups);
  const experience = parseExperience(review.experience);
  const projects = parseProjects(review.projects);

  const reviewSkills = skillGroups.flatMap((g) => g.skills);
  const skills = [...new Set([...reviewSkills, ...profileSkills])];

  const hasStructuredResume =
    experience.length > 0 || projects.length > 0 || reviewSkills.length > 0;

  return {
    hasStructuredResume,
    headline: review.headline || null,
    summary: review.summary || null,
    targetRole: review.targetRole || profile?.role || null,
    skills,
    experience: experience.map((e) => ({
      title: e.title,
      company: e.company,
      highlights: e.bullets,
    })),
    projects: projects.map((p) =>
      p.tech ? `${p.title} (${p.tech})` : p.title,
    ),
    resumeUrl,
  };
}
