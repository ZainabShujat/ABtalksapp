import type { Domain, UserType } from "@prisma/client";
import { prisma } from "@/lib/db";

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
  domain: Domain;
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
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      image: true,
      createdAt: true,
      studentProfile: {
        select: {
          fullName: true,
          userType: true,
          college: true,
          collegeId: true,
          graduationYear: true,
          organization: true,
          role: true,
          yearsExperience: true,
          domain: true,
          skills: true,
          resumeUrl: true,
          phone: true,
          phoneVerified: true,
          linkedinUrl: true,
          githubUsername: true,
          referralCode: true,
          isReadyForInterview: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const { studentProfile, ...userFields } = user;

  if (!studentProfile) {
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
      ...studentProfile,
      referralCount,
    },
  };
}
