import { EnrollmentStatus, type UserType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCandidateProfile } from "@/repositories/candidate";
import { studentProfile } from "@/repositories/legacy/student-profile";

export type PublicProfile = {
  fullName: string;
  userType: UserType;
  domain: string | null;
  college: string | null;
  graduationYear: number | null;
  organization: string | null;
  role: string | null;
  yearsExperience: number | null;
  skills: string[];
  linkedinUrl: string | null;
  githubUsername: string | null;
  joinedAt: Date;
  daysCompleted: number;
  currentStreak: number;
  longestStreak: number;
  isReadyForInterview: boolean;
};

type ProfileDomainEnrollment = {
  id: string;
  status: EnrollmentStatus;
  daysCompleted: number;
  currentStreak: number;
  longestStreak: number;
};

/** Enrollment for public profile heatmap + stats — matches studentProfile.domain. */
async function resolvePublicProfileEnrollment(
  userId: string,
): Promise<ProfileDomainEnrollment | null> {
  const profile = await studentProfile.findUnique({
    where: { userId },
    select: { domain: true },
  });

  if (!profile?.domain) {
    return null;
  }

  const enrollments = await prisma.enrollment.findMany({
    where: {
      userId,
      domain: profile.domain,
      status: { not: EnrollmentStatus.ABANDONED },
    },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      status: true,
      daysCompleted: true,
      currentStreak: true,
      longestStreak: true,
    },
  });

  if (enrollments.length === 0) {
    return null;
  }

  const active = enrollments.find((e) => e.status === EnrollmentStatus.ACTIVE);
  return active ?? enrollments[0]!;
}

export async function getPublicProfile(
  userId: string,
): Promise<PublicProfile | null> {
  const [user, candidate, domainEnrollment] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        createdAt: true,
        studentProfile: { select: { domain: true } },
      },
    }),
    getCandidateProfile(userId),
    resolvePublicProfileEnrollment(userId),
  ]);

  if (!user?.studentProfile || !candidate) {
    return null;
  }

  return {
    fullName: candidate.fullName,
    userType: candidate.userType as UserType,
    domain: user.studentProfile.domain,
    college: candidate.college,
    graduationYear: candidate.graduationYear,
    organization: candidate.organization,
    role: candidate.role,
    yearsExperience: candidate.yearsExperience,
    skills: candidate.skills,
    linkedinUrl: candidate.linkedinUrl,
    githubUsername: candidate.githubUsername,
    joinedAt: user.createdAt,
    daysCompleted: domainEnrollment?.daysCompleted ?? 0,
    currentStreak: domainEnrollment?.currentStreak ?? 0,
    longestStreak: domainEnrollment?.longestStreak ?? 0,
    isReadyForInterview: candidate.isReadyForInterview,
  };
}

export async function getPublicEnrollmentId(
  userId: string,
): Promise<string | null> {
  const enrollment = await resolvePublicProfileEnrollment(userId);
  return enrollment?.id ?? null;
}
