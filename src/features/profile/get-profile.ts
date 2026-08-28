import type { Domain, UserType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCandidateProfile } from "@/repositories/candidate";

export type ProfileUser = {
  email: string;
  image: string | null;
  createdAt: Date;
};

export type ProfileData = {
  fullName: string;
  userType: UserType;
  college: string | null;
  collegeId: string | null;
  graduationYear: number | null;
  organization: string | null;
  role: string | null;
  yearsExperience: number | null;
  domain: Domain | null;
  skills: string[];
  resumeUrl: string | null;
  phone: string | null;
  phoneVerified: boolean;
  linkedinUrl: string | null;
  githubUsername: string | null;
  referralCode: string;
  referralCount: number;
  isReadyForInterview: boolean;
};

export async function getProfile(userId: string): Promise<{
  user: ProfileUser;
  profile: ProfileData | null;
}> {
  const [user, candidate] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        image: true,
        createdAt: true,
        studentProfile: { select: { domain: true } },
      },
    }),
    getCandidateProfile(userId),
  ]);

  if (!user) {
    throw new Error("User not found");
  }

  const { studentProfile, ...userFields } = user;

  // Challenge registration gate stays on StudentProfile. Identity fields come
  // through the candidate repository (legacy SP or CandidateProfile by flag).
  if (!studentProfile || !candidate) {
    return {
      user: userFields,
      profile: null,
    };
  }

  const referralCount = await prisma.referral.count({
    where: { referrerId: userId },
  });

  return {
    user: userFields,
    profile: {
      fullName: candidate.fullName,
      userType: candidate.userType as UserType,
      college: candidate.college,
      collegeId: candidate.collegeId,
      graduationYear: candidate.graduationYear,
      organization: candidate.organization,
      role: candidate.role,
      yearsExperience: candidate.yearsExperience,
      domain: studentProfile.domain,
      skills: candidate.skills,
      resumeUrl: candidate.resumeUrl,
      phone: candidate.phone,
      phoneVerified: candidate.phoneVerified,
      linkedinUrl: candidate.linkedinUrl,
      githubUsername: candidate.githubUsername,
      referralCode: candidate.referralCode,
      referralCount,
      isReadyForInterview: candidate.isReadyForInterview,
    },
  };
}
