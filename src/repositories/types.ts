import "server-only";

export type EnrolledProgramCard = {
  enrollmentId: string;
  programSlug: string;
  programTitle: string;
  cardImageUrl: string | null;
  cohortName: string;
  status: "ACTIVE" | "COMPLETED" | "DROPPED";
  percentComplete: number;
  pointsEarned: number;
  currentStreak: number;
  nextActivity: { id: string; title: string; dayNumber: number | null } | null;
  dueAt: Date | null;
};

export type CandidateSearchFilters = {
  q?: string;
  skillIds?: string[];
  minEvidenceScore?: number;
  graduationYearFrom?: number;
  graduationYearTo?: number;
  minExperienceMonths?: number;
  completedProgramIds?: string[];
  minAssessmentScore?: { dimension: string; score: number };
  availableBefore?: Date;
  locationCity?: string;
  countryCode?: string;
  page?: number;
  pageSize?: number;
};

export type RecruiterContext = {
  userId: string;
  recruiterProfileId: string;
  organizationIds: string[];
};

export type CandidateProfileView = {
  userId: string;
  fullName: string;
  headline: string | null;
  phone: string | null;
  phoneVerified: boolean;
  linkedinUrl: string | null;
  githubUsername: string | null;
  resumeUrl: string | null;
  referralCode: string;
  skills: string[];
  isReadyForInterview: boolean;
};

export type CredentialView = {
  credentialId: string;
  userId: string;
  type: string;
  title: string;
  recipientName: string;
  status: string;
  issuedAt: Date;
  metadata: unknown;
};
