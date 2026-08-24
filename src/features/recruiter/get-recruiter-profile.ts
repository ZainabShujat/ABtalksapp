import { EnrollmentStatus, type RecommendationLevel } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  parseCertifications,
  parseCodingChallenges,
  parseCompensation,
  parseEducation,
  parseExperience,
  parseLogistics,
  parseProjects,
  parseSkillGroups,
  type Certification,
  type CodingChallenge,
  type Compensation,
  type Education,
  type Experience,
  type Logistics,
  type Project,
  type SkillGroup,
} from "@/lib/validations/recruiter";

export type RecruiterProfileView = {
  fullName: string;
  image: string | null;
  email: string;
  phone: string | null;
  linkedinUrl: string | null;
  githubUsername: string | null;
  userType: "STUDENT" | "PROFESSIONAL";
  domain: string | null;
  college: string | null;
  graduationYear: number | null;
  organization: string | null;
  role: string | null;
  yearsExperience: number | null;
  skills: string[];
  daysCompleted: number;
  totalDays: number;
  currentStreak: number;
  longestStreak: number;
  isReadyForInterview: boolean;
  targetRole: string | null;
  skillGroups: SkillGroup[];
  education: Education[];
  certifications: Certification[];
  languagesSpoken: string[];
  achievements: string[];
  headline: string | null;
  summary: string | null;
  experience: Experience[];
  projects: Project[];
  communicationScore: number | null;
  programmingScore: number | null;
  behaviorScore: number | null;
  communicationFeedback: string | null;
  programmingFeedback: string | null;
  behaviorFeedback: string | null;
  codingChallenges: CodingChallenge[];
  strengths: string[];
  areasForGrowth: string[];
  recommendation: RecommendationLevel | null;
  assessmentDate: string | null;
  interviewerName: string | null;
  challengeRound: string | null;
  abtalksId: string;
  logistics: Logistics;
  compensation: Compensation;
  assessmentComposite: number | null;
  assessmentMax: number;
};

function deriveAbtalksId(userId: string, override: string | null | undefined) {
  if (override?.trim()) return override.trim();
  return `AB-${userId.slice(0, 8).toUpperCase()}`;
}

function formatAssessmentDate(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

function computeAssessmentComposite(
  communication: number | null,
  programming: number | null,
  behavior: number | null,
): number | null {
  if (
    communication == null ||
    programming == null ||
    behavior == null
  ) {
    return null;
  }
  return communication + programming + behavior;
}

export async function getRecruiterProfileByToken(
  token: string,
): Promise<RecruiterProfileView | null> {
  const review = await prisma.recruiterReview.findUnique({
    where: { shareToken: token },
    select: {
      isPublished: true,
      targetRole: true,
      skillGroups: true,
      education: true,
      certifications: true,
      languagesSpoken: true,
      achievements: true,
      headline: true,
      summary: true,
      experience: true,
      projects: true,
      communicationScore: true,
      programmingScore: true,
      behaviorScore: true,
      communicationFeedback: true,
      programmingFeedback: true,
      behaviorFeedback: true,
      codingChallenges: true,
      strengths: true,
      areasForGrowth: true,
      recommendation: true,
      assessmentDate: true,
      interviewerName: true,
      challengeRound: true,
      abtalksId: true,
      logistics: true,
      compensation: true,
      user: {
        select: {
          id: true,
          image: true,
          email: true,
          studentProfile: {
            select: {
              fullName: true,
              userType: true,
              domain: true,
              college: true,
              graduationYear: true,
              organization: true,
              role: true,
              yearsExperience: true,
              skills: true,
              phone: true,
              linkedinUrl: true,
              githubUsername: true,
              isReadyForInterview: true,
            },
          },
          enrollments: {
            where: { status: { not: EnrollmentStatus.ABANDONED } },
            orderBy: { startedAt: "asc" },
            select: {
              domain: true,
              status: true,
              daysCompleted: true,
              currentStreak: true,
              longestStreak: true,
              challenge: { select: { totalDays: true } },
            },
          },
        },
      },
    },
  });

  if (!review || !review.isPublished || !review.user.studentProfile) return null;
  const p = review.user.studentProfile;
  const enr =
    review.user.enrollments.find(
      (e) => e.domain === p.domain && e.status === "ACTIVE",
    ) ??
    review.user.enrollments.find((e) => e.domain === p.domain) ??
    review.user.enrollments[0] ??
    null;

  return {
    fullName: p.fullName,
    image: review.user.image,
    // Public token pages must not expose direct contact (plan 057 / business decisions).
    email: "",
    phone: null,
    linkedinUrl: p.linkedinUrl,
    githubUsername: p.githubUsername,
    userType: p.userType,
    domain: p.domain,
    college: p.college,
    graduationYear: p.graduationYear,
    organization: p.organization,
    role: p.role,
    yearsExperience: p.yearsExperience,
    skills: p.skills,
    daysCompleted: enr?.daysCompleted ?? 0,
    totalDays: enr?.challenge.totalDays ?? 60,
    currentStreak: enr?.currentStreak ?? 0,
    longestStreak: enr?.longestStreak ?? 0,
    isReadyForInterview: p.isReadyForInterview,
    targetRole: review.targetRole,
    skillGroups: parseSkillGroups(review.skillGroups),
    education: parseEducation(review.education),
    certifications: parseCertifications(review.certifications),
    languagesSpoken: review.languagesSpoken,
    achievements: review.achievements,
    headline: review.headline,
    summary: review.summary,
    experience: parseExperience(review.experience),
    projects: parseProjects(review.projects),
    communicationScore: review.communicationScore,
    programmingScore: review.programmingScore,
    behaviorScore: review.behaviorScore,
    communicationFeedback: review.communicationFeedback,
    programmingFeedback: review.programmingFeedback,
    behaviorFeedback: review.behaviorFeedback,
    codingChallenges: parseCodingChallenges(review.codingChallenges),
    strengths: review.strengths,
    areasForGrowth: review.areasForGrowth,
    recommendation: review.recommendation,
    assessmentDate: formatAssessmentDate(review.assessmentDate),
    interviewerName: review.interviewerName,
    challengeRound: review.challengeRound,
    abtalksId: deriveAbtalksId(review.user.id, review.abtalksId),
    logistics: parseLogistics(review.logistics),
    compensation: parseCompensation(review.compensation),
    assessmentComposite: computeAssessmentComposite(
      review.communicationScore,
      review.programmingScore,
      review.behaviorScore,
    ),
    assessmentMax: 300,
  };
}
