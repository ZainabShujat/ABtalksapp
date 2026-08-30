/**
 * Targeted production TALENT pre-flip repairs. Two rows only.
 *
 * 1. V4b ProgramMember visibility for cmsan3gva00cekw04ra46kw7s
 * 2. CandidateProfile catch-up for searchable user cmt7d9dbv0000jm044k0chmrc
 *
 * Does not bulk-open historical candidates. PHASE2_ALLOW_PRODUCTION=1 + direct URL.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { assertChildBranch } from "./migrate-078-shared";

config({ path: ".env.local" });
config();

const prisma = new PrismaClient();

const V4B_USER_ID = "cmsan3gva00cekw04ra46kw7s";
const MISSING_PROFILE_USER_ID = "cmt7d9dbv0000jm044k0chmrc";

const REFERRAL_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomReferralCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += REFERRAL_CHARS[Math.floor(Math.random() * REFERRAL_CHARS.length)]!;
  }
  return out;
}

async function mintReferralCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = randomReferralCode();
    const [sp, cp] = await Promise.all([
      prisma.studentProfile.findUnique({
        where: { referralCode: code },
        select: { userId: true },
      }),
      prisma.candidateProfile.findUnique({
        where: { referralCode: code },
        select: { userId: true },
      }),
    ]);
    if (!sp && !cp) return code;
  }
  throw new Error("Could not mint a unique referral code");
}

async function repairV4b(): Promise<{ ok: true } | { skipped: string }> {
  const member = await prisma.programMember.findFirst({
    where: { userId: V4B_USER_ID },
    select: {
      id: true,
      recruiterVisibilityConsentAt: true,
    },
  });
  if (!member) {
    throw new Error(`V4b repair refused: ${V4B_USER_ID} is not a ProgramMember`);
  }

  const vis = await prisma.candidateVisibility.findUnique({
    where: { userId: V4B_USER_ID },
    select: {
      searchableByRecruiters: true,
      withdrawnAt: true,
      consentSource: true,
      consentedAt: true,
    },
  });
  if (!vis) {
    throw new Error(`V4b repair refused: no CandidateVisibility for ${V4B_USER_ID}`);
  }
  if (vis.withdrawnAt) {
    return { skipped: "withdrawnAt is set; leaving closed" };
  }
  if (
    vis.searchableByRecruiters &&
    vis.consentSource === "program_apply_migrated"
  ) {
    return { skipped: "already repaired" };
  }

  const consentedAt = member.recruiterVisibilityConsentAt;
  if (!consentedAt) {
    throw new Error(
      `V4b repair refused: recruiterVisibilityConsentAt is null for ${V4B_USER_ID}`,
    );
  }

  await prisma.candidateVisibility.update({
    where: { userId: V4B_USER_ID },
    data: {
      searchableByRecruiters: true,
      consentSource: "program_apply_migrated",
      consentedAt,
      withdrawnAt: null,
    },
  });
  return { ok: true };
}

async function catchUpMissingProfile(): Promise<{ ok: true } | { skipped: string }> {
  const vis = await prisma.candidateVisibility.findUnique({
    where: { userId: MISSING_PROFILE_USER_ID },
    select: { searchableByRecruiters: true, withdrawnAt: true },
  });
  if (!vis?.searchableByRecruiters || vis.withdrawnAt) {
    throw new Error(
      `Profile catch-up refused: ${MISSING_PROFILE_USER_ID} is not currently searchable`,
    );
  }

  const existing = await prisma.candidateProfile.findUnique({
    where: { userId: MISSING_PROFILE_USER_ID },
    select: { userId: true },
  });
  if (existing) return { skipped: "CandidateProfile already present" };

  const [user, sp] = await Promise.all([
    prisma.user.findUnique({
      where: { id: MISSING_PROFILE_USER_ID },
      select: { name: true, email: true },
    }),
    prisma.studentProfile.findUnique({
      where: { userId: MISSING_PROFILE_USER_ID },
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
        college: true,
        collegeId: true,
        graduationYear: true,
        organization: true,
        role: true,
        yearsExperience: true,
        skills: true,
      },
    }),
  ]);
  if (!user) {
    throw new Error(`Profile catch-up refused: no User ${MISSING_PROFILE_USER_ID}`);
  }

  const fullName =
    sp?.fullName?.trim() ||
    user.name?.trim() ||
    user.email?.split("@")[0] ||
    "Unknown";
  const referralCode = sp?.referralCode ?? (await mintReferralCode());

  await prisma.$transaction(async (tx) => {
    await tx.candidateProfile.create({
      data: {
        id: `cp_${MISSING_PROFILE_USER_ID}`,
        userId: MISSING_PROFILE_USER_ID,
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
  });
  return { ok: true };
}

async function main() {
  assertChildBranch();
  const v4b = await repairV4b();
  const profile = await catchUpMissingProfile();
  console.log(JSON.stringify({ v4b, profile }, null, 2));
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
