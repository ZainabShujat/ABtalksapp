import "server-only";
import { Prisma, Role } from "@prisma/client";
import { prisma, writeClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import { createCandidateIdentity } from "@/repositories/candidate-identity";
import { upsertResume, type ResumeUpsert } from "@/repositories/candidate-resume";
import { applyVisibilityChange } from "@/repositories/visibility";
import {
  clearRegisterRequest,
  getImportForRegistration,
  markImportNeedsReview,
  markImportRegisteredTx,
  type ImportForRegistration,
} from "@/repositories/resume-import";
import { generateUniqueReferralCode } from "@/features/registration/generate-referral-code";
import { applyParsedResumeToProfile } from "@/features/resume/service";
import { identityFromParsedResume } from "@/features/resume/import/identity-mapping";
import type { ParsedResume, ResumeAnalysis } from "@/features/resume/types";

/**
 * Turn a PARSED import into a recruiter-visible candidate (plan 154).
 *
 * New email → one transaction creates a `User` with NO `Account` and no
 * password (nobody can sign in as it until the student's verified Google
 * sign-in claims it), the `CandidateProfile`, the READY `CandidateResume` and
 * the recruiter-visibility row. Then the same additive merge a self-upload uses
 * fills education, experience, projects, skills and links.
 *
 * Existing email → nothing is created. The résumé is attached only if the
 * account has none, and the merge only adds — existing data is never
 * overwritten. Visibility is left as the account already has it.
 */

export type RegisterOutcome =
  | "REGISTERED"
  | "CLAIMED"
  | "NEEDS_REVIEW"
  | "SKIPPED";

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;
const LOST_RACE = "__resume_import_lost_race__";

function resumeFromImport(imp: ImportForRegistration, parsed: ParsedResume, analysis: ResumeAnalysis): ResumeUpsert {
  return {
    sourceType: "UPLOAD",
    sourceUrl: null,
    blobPathname: imp.blobPathname,
    fileName: imp.originalFilename.slice(0, 120),
    fileType: "application/pdf",
    fileSizeBytes: imp.fileSizeBytes,
    contentHash: imp.contentHash,
    status: "READY",
    failureReason: null,
    parsedData: parsed,
    analysis,
    overallScore: analysis.overallScore,
    parsedAt: imp.parsedAt ?? new Date(),
  };
}

async function findUserByEmail(email: string) {
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      role: true,
      deletedAt: true,
      disabledAt: true,
      candidateProfile: { select: { id: true } },
      resume: { select: { id: true } },
      _count: { select: { accounts: true } },
    },
  });
}

async function mergeQuietly(userId: string, importId: string, parsed: ParsedResume): Promise<void> {
  try {
    await applyParsedResumeToProfile(userId, parsed);
  } catch (error) {
    // The account and résumé already exist; only enrichment was lost, and the
    // candidate's own /profile save or a re-upload repairs it.
    logger.error("[resume-import] merge after registration failed", {
      importId,
      userId,
      error: String(error),
    });
  }
}

async function attachToExisting(
  imp: ImportForRegistration,
  parsed: ParsedResume,
  analysis: ResumeAnalysis,
  user: NonNullable<Awaited<ReturnType<typeof findUserByEmail>>>,
): Promise<RegisterOutcome> {
  if (user.role !== Role.STUDENT || user.deletedAt || user.disabledAt) {
    await markImportNeedsReview(imp.id, {
      reason: "This email belongs to a non-student or closed account.",
    });
    await clearRegisterRequest(imp.id, "This email belongs to a non-student or closed account.");
    return "NEEDS_REVIEW";
  }

  const attachResume = user.resume === null;
  // An account that can already sign in is by definition claimed.
  const status = user._count.accounts > 0 ? "CLAIMED" : "REGISTERED";

  const moved = await writeClient()
    .$transaction(async (tx) => {
      if (attachResume) await upsertResume(user.id, resumeFromImport(imp, parsed, analysis), tx);
      const ok = await markImportRegisteredTx(tx, imp.id, {
        status,
        userId: user.id,
        linkedExisting: true,
        clearDocument: attachResume,
      });
      if (!ok) throw new Error(LOST_RACE); // roll the résumé attach back too
      return true;
    }, TX_OPTIONS)
    .catch((error: unknown) => {
      if (error instanceof Error && error.message === LOST_RACE) return false;
      throw error;
    });
  if (!moved) return "SKIPPED";

  // No profile yet (they signed in but never finished /register): they finish
  // it themselves, and registration's own deferred merge reads this résumé.
  if (user.candidateProfile) await mergeQuietly(user.id, imp.id, parsed);
  logger.info("[resume-import] attached to existing account", { importId: imp.id, userId: user.id, status });
  return status;
}

export async function registerImportedStudent(importId: string): Promise<RegisterOutcome> {
  const imp = await getImportForRegistration(importId);
  if (!imp || imp.status !== "PARSED") {
    if (imp) await clearRegisterRequest(imp.id, null);
    return "SKIPPED";
  }
  if (!imp.parsedData || !imp.analysis || !imp.normalizedEmail) {
    await clearRegisterRequest(imp.id, "Parsed résumé is missing — parse it again.");
    return "SKIPPED";
  }
  const parsed = imp.parsedData;
  const analysis = imp.analysis;
  const email = imp.normalizedEmail;

  const mapped = identityFromParsedResume(parsed);
  if (!mapped.ok) {
    await markImportNeedsReview(imp.id, { reason: "No name found on the résumé." });
    await clearRegisterRequest(imp.id, "No name found on the résumé.");
    return "NEEDS_REVIEW";
  }

  const existing = await findUserByEmail(email);
  if (existing) return attachToExisting(imp, parsed, analysis, existing);

  const referralCode = await generateUniqueReferralCode();
  let userId: string | null;
  try {
    userId = await writeClient().$transaction(async (tx) => {
      // No Account, no password: this row cannot be signed into until the
      // student's verified Google sign-in links to it (see claim.ts).
      const user = await tx.user.create({
        data: { email, name: mapped.identity.fullName, role: Role.STUDENT },
        select: { id: true },
      });
      await createCandidateIdentity(tx, {
        userId: user.id,
        fullName: mapped.identity.fullName,
        userType: mapped.identity.userType,
        referralCode,
        phone: null,
        phoneVerified: false,
        college: null,
        collegeId: null,
        organization: null,
        role: null,
        yearsExperience: null,
        headline: mapped.identity.headline,
        locationCity: null,
        locationRegion: null,
        countryCode: null,
        synergyPoints: 0,
      });
      await upsertResume(user.id, resumeFromImport(imp, parsed, analysis), tx);
      await applyVisibilityChange(tx, { userId: user.id, kind: "admin_import" });
      const moved = await markImportRegisteredTx(tx, imp.id, {
        status: "REGISTERED",
        userId: user.id,
        linkedExisting: false,
        clearDocument: true,
      });
      // Someone else registered it first. Throwing (not returning) is what
      // rolls the User and profile back — a returned value would commit them.
      if (!moved) throw new Error(LOST_RACE);
      return user.id;
    }, TX_OPTIONS).catch((error: unknown) => {
      if (error instanceof Error && error.message === LOST_RACE) return null;
      throw error;
    });
  } catch (error) {
    // The email appeared between our lookup and the insert (a Google signup,
    // or another import). Treat it as the existing-account case.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const now = await findUserByEmail(email);
      if (now) return attachToExisting(imp, parsed, analysis, now);
    }
    throw error;
  }

  if (!userId) return "SKIPPED";
  await mergeQuietly(userId, imp.id, parsed);
  logger.info("[resume-import] registered", { importId: imp.id, userId });
  return "REGISTERED";
}
