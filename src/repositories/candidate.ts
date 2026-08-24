import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isNewCandidateRepoEnabled } from "@/lib/feature-flags";
import { studentProfile } from "@/repositories/legacy/student-profile";
import type { CandidateProfileView } from "@/repositories/types";

export async function getCandidateProfile(
  userId: string,
): Promise<CandidateProfileView | null> {
  if (isNewCandidateRepoEnabled()) {
    const row = await prisma.candidateProfile.findUnique({
      where: { userId },
      select: {
        userId: true,
        fullName: true,
        headline: true,
        phone: true,
        phoneVerified: true,
        linkedinUrl: true,
        githubUsername: true,
        resumeUrl: true,
        referralCode: true,
        isReadyForInterview: true,
        skills: { select: { skill: { select: { name: true } } } },
      },
    });
    if (!row) return null;
    return {
      userId: row.userId,
      fullName: row.fullName,
      headline: row.headline,
      phone: row.phone,
      phoneVerified: row.phoneVerified,
      linkedinUrl: row.linkedinUrl,
      githubUsername: row.githubUsername,
      resumeUrl: row.resumeUrl,
      referralCode: row.referralCode,
      skills: row.skills.map((s) => s.skill.name),
      isReadyForInterview: row.isReadyForInterview,
    };
  }

  const row = await studentProfile.findUnique({
    where: { userId },
    select: {
      userId: true,
      fullName: true,
      phone: true,
      phoneVerified: true,
      linkedinUrl: true,
      githubUsername: true,
      resumeUrl: true,
      referralCode: true,
      skills: true,
      isReadyForInterview: true,
    },
  });
  if (!row) return null;
  return {
    userId: row.userId,
    fullName: row.fullName,
    headline: null,
    phone: row.phone,
    phoneVerified: row.phoneVerified,
    linkedinUrl: row.linkedinUrl,
    githubUsername: row.githubUsername,
    resumeUrl: row.resumeUrl,
    referralCode: row.referralCode,
    skills: row.skills,
    isReadyForInterview: row.isReadyForInterview,
  };
}

export async function getProfileSummary(userId: string): Promise<{
  fullName: string;
  referralCode: string;
} | null> {
  const profile = await getCandidateProfile(userId);
  if (!profile) return null;
  return { fullName: profile.fullName, referralCode: profile.referralCode };
}

export async function updateStudentFields(
  userId: string,
  data: Prisma.StudentProfileUpdateInput,
) {
  return studentProfile.update({ where: { userId }, data });
}
