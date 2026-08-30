import "server-only";
import { CandidatePersona, UserType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isNewCandidateRepoEnabled } from "@/lib/feature-flags";
import {
  educationIdForStudentProfile,
  experienceIdForStudentProfile,
} from "@/repositories/dual-write";
import { studentProfile } from "@/repositories/legacy/student-profile";
import type { CandidateProfileView } from "@/repositories/types";

const legacyIdentitySelect = {
  userId: true,
  fullName: true,
  userType: true,
  college: true,
  collegeId: true,
  graduationYear: true,
  organization: true,
  role: true,
  yearsExperience: true,
  phone: true,
  phoneVerified: true,
  linkedinUrl: true,
  githubUsername: true,
  resumeUrl: true,
  referralCode: true,
  skills: true,
  isReadyForInterview: true,
  isCampusAmbassadorCandidate: true,
  ambassadorDismissedAt: true,
} as const;

const newIdentitySelect = {
  userId: true,
  fullName: true,
  headline: true,
  primaryPersona: true,
  phone: true,
  phoneVerified: true,
  linkedinUrl: true,
  githubUsername: true,
  resumeUrl: true,
  referralCode: true,
  isReadyForInterview: true,
  isCampusAmbassadorCandidate: true,
  ambassadorDismissedAt: true,
  education: {
    where: { id: { startsWith: "edu_sp_" } },
    select: {
      id: true,
      institutionName: true,
      collegeId: true,
      graduationYear: true,
      sortOrder: true,
    },
  },
  experience: {
    where: { id: { startsWith: "exp_sp_" } },
    select: {
      id: true,
      companyName: true,
      title: true,
      totalMonths: true,
    },
  },
  skills: { select: { skill: { select: { name: true } } } },
} as const;

function userTypeFromPersona(persona: string): "STUDENT" | "PROFESSIONAL" {
  return persona === "PROFESSIONAL" ? "PROFESSIONAL" : "STUDENT";
}

function viewFromLegacy(row: {
  userId: string;
  fullName: string;
  userType: UserType;
  college: string | null;
  collegeId: string | null;
  graduationYear: number | null;
  organization: string | null;
  role: string | null;
  yearsExperience: number | null;
  phone: string | null;
  phoneVerified: boolean;
  linkedinUrl: string | null;
  githubUsername: string | null;
  resumeUrl: string | null;
  referralCode: string;
  skills: string[];
  isReadyForInterview: boolean;
  isCampusAmbassadorCandidate: boolean;
  ambassadorDismissedAt: Date | null;
}): CandidateProfileView {
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
    userType: userTypeFromPersona(row.userType),
    college: row.college,
    collegeId: row.collegeId,
    graduationYear: row.graduationYear,
    organization: row.organization,
    role: row.role,
    yearsExperience: row.yearsExperience,
    isCampusAmbassadorCandidate: row.isCampusAmbassadorCandidate,
    ambassadorDismissedAt: row.ambassadorDismissedAt,
  };
}

function viewFromNew(
  row: {
    userId: string;
    fullName: string;
    headline: string | null;
    primaryPersona: CandidatePersona;
    phone: string | null;
    phoneVerified: boolean;
    linkedinUrl: string | null;
    githubUsername: string | null;
    resumeUrl: string | null;
    referralCode: string;
    isReadyForInterview: boolean;
    isCampusAmbassadorCandidate: boolean;
    ambassadorDismissedAt: Date | null;
    education: Array<{
      id: string;
      institutionName: string;
      collegeId: string | null;
      graduationYear: number | null;
      sortOrder: number;
    }>;
    experience: Array<{
      id: string;
      companyName: string;
      title: string;
      totalMonths: number;
    }>;
    skills: Array<{ skill: { name: string } }>;
  },
): CandidateProfileView {
  const education = row.education.find(
    (e) => e.id === educationIdForStudentProfile(row.userId),
  );
  const experience = row.experience.find(
    (e) => e.id === experienceIdForStudentProfile(row.userId),
  );

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
    userType: userTypeFromPersona(row.primaryPersona),
    college: unspecifiedToNull(education?.institutionName),
    collegeId: education?.collegeId ?? null,
    graduationYear: education?.graduationYear ?? null,
    organization: unspecifiedToNull(experience?.companyName),
    role: unspecifiedToNull(experience?.title),
    yearsExperience: experience
      ? Math.max(0, Math.round(experience.totalMonths / 12))
      : null,
    isCampusAmbassadorCandidate: row.isCampusAmbassadorCandidate,
    ambassadorDismissedAt: row.ambassadorDismissedAt,
  };
}

function unspecifiedToNull(value: string | undefined): string | null {
  if (!value || value === "Not specified") return null;
  return value;
}

export async function getCandidateProfile(
  userId: string,
): Promise<CandidateProfileView | null> {
  if (isNewCandidateRepoEnabled()) {
    const row = await prisma.candidateProfile.findUnique({
      where: { userId },
      select: newIdentitySelect,
    });
    if (!row) return null;
    return viewFromNew(row);
  }

  const row = await studentProfile.findUnique({
    where: { userId },
    select: legacyIdentitySelect,
  });
  if (!row) return null;
  return viewFromLegacy(row);
}

export async function listCandidateProfiles(
  userIds: string[],
): Promise<Map<string, CandidateProfileView>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  if (isNewCandidateRepoEnabled()) {
    const rows = await prisma.candidateProfile.findMany({
      where: { userId: { in: ids } },
      select: newIdentitySelect,
    });
    return new Map(rows.map((row) => [row.userId, viewFromNew(row)]));
  }

  const rows = await studentProfile.findMany({
    where: { userId: { in: ids } },
    select: legacyIdentitySelect,
  });
  return new Map(rows.map((row) => [row.userId, viewFromLegacy(row)]));
}

export async function getProfileSummary(userId: string): Promise<{
  fullName: string;
  referralCode: string;
} | null> {
  const profile = await getCandidateProfile(userId);
  if (!profile) return null;
  return { fullName: profile.fullName, referralCode: profile.referralCode };
}

/**
 * Resolve a pasted/shared referral code to a user.
 * Flag off: StudentProfile (legacy unique). Flag on: CandidateProfile
 * (canonical unique). Both tables must hold the same live code.
 */
export async function findUserIdByReferralCode(
  code: string,
): Promise<string | null> {
  if (isNewCandidateRepoEnabled()) {
    const row = await prisma.candidateProfile.findUnique({
      where: { referralCode: code },
      select: { userId: true },
    });
    return row?.userId ?? null;
  }
  const row = await studentProfile.findUnique({
    where: { referralCode: code },
    select: { userId: true },
  });
  return row?.userId ?? null;
}

export async function updateStudentFields(
  userId: string,
  data: Prisma.StudentProfileUpdateInput,
) {
  return studentProfile.update({ where: { userId }, data });
}

/* ─── Candidate availability (078 `CandidatePreference`) ────────────────────
 *
 * `/hire` used to carry its own `CandidateAvailability` model. Every column it
 * held already exists on `CandidatePreference`, which shipped with the 078
 * additive schema, so the duplicate was dropped rather than merged and later
 * unwound in Phase 8. Three names differ; the mapping is here and nowhere else:
 *
 *   preferredWorkMode  → CandidatePreference.remotePreference
 *   preferredCities    → CandidatePreference.preferredLocations
 *   openToRelocate     → CandidatePreference.willingToRelocate
 *
 * `openToWork` lives here and is INDEPENDENT of recruiter discoverability,
 * which is `CandidateVisibility.searchableByRecruiters` and is enforced only in
 * `repositories/talent.ts`. A candidate can be searchable and not looking.
 */

/** The shape `/hire` reads. Deliberately the hire vocabulary, not the schema's. */
export type CandidateAvailabilityView = {
  userId: string;
  openToWork: boolean;
  expectedSalaryMin: number | null;
  expectedSalaryMax: number | null;
  salaryCurrency: string;
  noticePeriodDays: number | null;
  preferredWorkMode: string | null;
  preferredCities: string[];
  openToRelocate: boolean;
};

export type CandidateAvailabilityWrite = {
  openToWork: boolean;
  expectedSalaryMin: number | null;
  expectedSalaryMax: number | null;
  salaryCurrency: string;
  noticePeriodDays: number | null;
  preferredWorkMode: string | null;
  preferredCities: string[];
  openToRelocate: boolean;
};

/**
 * Batched read. Returns an empty map rather than throwing: a dossier is still
 * worth showing without logistics, and one unreadable table must not take the
 * whole search down.
 */
export async function listCandidateAvailability(
  userIds: string[],
): Promise<Map<string, CandidateAvailabilityView>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const rows = await prisma.candidatePreference.findMany({
    where: { userId: { in: ids } },
    select: {
      userId: true,
      openToWork: true,
      expectedSalaryMin: true,
      expectedSalaryMax: true,
      salaryCurrency: true,
      noticePeriodDays: true,
      remotePreference: true,
      preferredLocations: true,
      willingToRelocate: true,
    },
  });

  return new Map(
    rows.map((r) => [
      r.userId,
      {
        userId: r.userId,
        openToWork: r.openToWork,
        expectedSalaryMin: r.expectedSalaryMin,
        expectedSalaryMax: r.expectedSalaryMax,
        salaryCurrency: r.salaryCurrency ?? "INR",
        noticePeriodDays: r.noticePeriodDays,
        preferredWorkMode: r.remotePreference,
        preferredCities: r.preferredLocations,
        openToRelocate: r.willingToRelocate,
      },
    ]),
  );
}

const REFERRAL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomReferralCode(): string {
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += REFERRAL_ALPHABET[Math.floor(Math.random() * REFERRAL_ALPHABET.length)]!;
  }
  return out;
}

async function mintHireOnlyReferralCode(tx: Prisma.TransactionClient): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = randomReferralCode();
    const [onCandidate, onStudent] = await Promise.all([
      tx.candidateProfile.findUnique({
        where: { referralCode: code },
        select: { userId: true },
      }),
      tx.studentProfile.findUnique({
        where: { referralCode: code },
        select: { userId: true },
      }),
    ]);
    if (!onCandidate && !onStudent) return code;
  }
  throw new Error("Could not mint unique hire-only referral code");
}

/**
 * `CandidatePreference.userId` is an FK to `CandidateProfile`, not to `User`.
 * If StudentProfile exists, CandidateProfile copies that live referral code.
 * 8-character codes are only for users with no StudentProfile (hire-only).
 */
async function ensureCandidateProfile(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const existing = await tx.candidateProfile.findUnique({
    where: { userId },
    select: { userId: true },
  });
  if (existing) return;

  const [user, sp] = await Promise.all([
    tx.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    }),
    tx.studentProfile.findUnique({
      where: { userId },
      select: {
        fullName: true,
        referralCode: true,
        userType: true,
        phone: true,
        phoneVerified: true,
        phoneVerifiedAt: true,
        linkedinUrl: true,
        githubUsername: true,
        resumeUrl: true,
        isReadyForInterview: true,
      },
    }),
  ]);

  const fullName =
    sp?.fullName?.trim() ||
    user?.name?.trim() ||
    user?.email?.split("@")[0] ||
    "Unknown";

  let referralCode: string;
  if (sp?.referralCode) {
    referralCode = sp.referralCode;
  } else {
    referralCode = await mintHireOnlyReferralCode(tx);
  }

  await tx.candidateProfile.create({
    data: {
      userId,
      fullName,
      primaryPersona: sp?.userType === "PROFESSIONAL" ? "PROFESSIONAL" : "STUDENT",
      phone: sp?.phone ?? null,
      phoneVerified: sp?.phoneVerified ?? false,
      phoneVerifiedAt: sp?.phoneVerifiedAt ?? null,
      linkedinUrl: sp?.linkedinUrl ?? null,
      githubUsername: sp?.githubUsername ?? null,
      resumeUrl: sp?.resumeUrl ?? null,
      referralCode,
      isReadyForInterview: sp?.isReadyForInterview ?? false,
    },
  });
}

/**
 * Write the candidate's own logistics. Never touches `CandidateVisibility` —
 * stating you are open to work is not consent to be discovered, and the two
 * must not be wired to each other.
 */
export async function upsertCandidateAvailability(
  userId: string,
  input: CandidateAvailabilityWrite,
): Promise<void> {
  const data = {
    openToWork: input.openToWork,
    expectedSalaryMin: input.expectedSalaryMin,
    expectedSalaryMax: input.expectedSalaryMax,
    salaryCurrency: input.salaryCurrency,
    noticePeriodDays: input.noticePeriodDays,
    remotePreference: input.preferredWorkMode,
    preferredLocations: input.preferredCities,
    willingToRelocate: input.openToRelocate,
  };

  await prisma.$transaction(async (tx) => {
    await ensureCandidateProfile(tx, userId);
    await tx.candidatePreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  });
}
