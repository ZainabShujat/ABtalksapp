import "server-only";
import { studentProfile } from "@/repositories/legacy/student-profile";
import { buildChallengeContext } from "@/features/interview/challenge-context";
import { buildResumeContext } from "@/features/interview/resume-context";
import type { CandidateContext } from "@/features/interview/types";

/**
 * Single deterministic entry point for everything the interviewer agent knows
 * about a candidate. No LLM involvement — retrieval only.
 */
export async function buildCandidateContext(
  userId: string,
): Promise<CandidateContext | null> {
  const [profile, challenge, resume] = await Promise.all([
    // Plan 078 seam. NOT getCandidateProfile(): CandidateProfileView carries
    // no domain/role/organization/yearsExperience/college, which the
    // interviewer needs, so this stays on the legacy shim.
    studentProfile.findUnique({
      where: { userId },
      select: {
        fullName: true,
        domain: true,
        role: true,
        organization: true,
        yearsExperience: true,
        college: true,
      },
    }),
    buildChallengeContext(userId),
    buildResumeContext(userId),
  ]);

  if (!profile) return null;

  return {
    userId,
    fullName: profile.fullName,
    domain: profile.domain,
    role: profile.role,
    organization: profile.organization,
    yearsExperience: profile.yearsExperience,
    college: profile.college,
    challenge,
    resume,
  };
}
