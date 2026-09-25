import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma, writeClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import { upsertResume } from "@/repositories/candidate-resume";
import { applyVisibilityChange } from "@/repositories/visibility";
import {
  claimRegisteredImportTx,
  findParsedImportIdByEmail,
  getImportForRegistration,
  hasUnclaimedImportForUser,
  markImportRegisteredTx,
} from "@/repositories/resume-import";
import { normalizeEmail } from "@/features/resume/import/email";

/**
 * How a student's Google sign-in takes over the candidate an admin imported
 * for them (plan 154).
 *
 * Identity is ONLY what the OAuth callback proves: the provider account and a
 * Google-verified email, compared with the email stored on the imported User.
 * Nothing here accepts a user, profile or import id from a client.
 *
 * Atomicity comes from the database, not from these checks:
 * `Account @@unique([provider, providerAccountId])` and the partial unique index
 * "one Google account per user" make the adapter's link insert the single point
 * where a claim either happens once or fails.
 */

export type LinkDecision = "allow" | "deny";

/** Injectable for tests; production passes nothing and gets the real client. */
type ReadDb = Pick<PrismaClient, "account" | "user" | "resumeImport">;
type WriteDb = Pick<PrismaClient, "$transaction">;

const LOST_RACE = "__resume_import_claim_lost_race__";

/**
 * Called from `callbacks.signIn` for Google, BEFORE the adapter links anything.
 *
 * `allowDangerousEmailAccountLinking` is on for Google so that an imported
 * User (which has no Account) can be linked at all. This function narrows it
 * back to exactly that case. Every other existing-email case is denied, which
 * is precisely what Auth.js did before (`OAuthAccountNotLinked`), so recruiter
 * OTP and dev accounts behave as they always have.
 */
export async function evaluateGoogleLink(input: {
  providerAccountId: string;
  email: string | null | undefined;
  emailVerified: boolean;
}, db: ReadDb = prisma): Promise<LinkDecision> {
  const linked = await db.account.findUnique({
    where: {
      provider_providerAccountId: { provider: "google", providerAccountId: input.providerAccountId },
    },
    select: { id: true },
  });
  if (linked) return "allow"; // a returning user — nothing to link

  const email = normalizeEmail(input.email);
  if (!email) return "allow"; // no email to link by; the adapter creates a user as before

  const user = await db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      deletedAt: true,
      disabledAt: true,
      _count: { select: { accounts: true } },
    },
  });
  if (!user) return "allow"; // a brand-new signup — unchanged behaviour

  const claimable =
    input.emailVerified &&
    !user.deletedAt &&
    !user.disabledAt &&
    user._count.accounts === 0 &&
    (await hasUnclaimedImportForUser(user.id, db as unknown as Prisma.TransactionClient));
  return claimable ? "allow" : "deny";
}

/**
 * `events.linkAccount`: the adapter just linked a Google account to a user.
 * For an imported, unclaimed user that IS the claim: mark it, trust the email,
 * and re-stamp the visibility consent as the student's own.
 *
 * Also fires for every ordinary new Google signup (adapter creates the user,
 * then links) — then there is no REGISTERED import and this is a no-op.
 */
export async function onGoogleAccountLinked(
  userId: string,
  db: WriteDb = writeClient(),
): Promise<boolean> {
  const claimed = await db.$transaction(async (tx) => {
    const moved = await claimRegisteredImportTx(tx, userId);
    if (moved === 0) return false;
    await tx.user.update({
      where: { id: userId },
      data: { emailVerified: new Date() },
      select: { id: true },
    });
    await applyVisibilityChange(tx, { userId, kind: "claim_consent" });
    return true;
  });
  if (claimed) logger.info("[resume-import] claimed by Google sign-in", { userId });
  return claimed;
}

/**
 * `events.createUser` for a new Google user: if an admin uploaded and parsed
 * their résumé but never registered it, attach it now. They still complete
 * /register (phone, consent); the résumé step is simply already done, and
 * registration's own deferred merge fills the profile from it.
 */
export async function attachParsedImportToUser(userId: string, rawEmail: string | null | undefined): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  if (!email) return false;
  const importId = await findParsedImportIdByEmail(email);
  if (!importId) return false;
  const imp = await getImportForRegistration(importId);
  if (!imp?.parsedData || !imp.analysis) return false;
  const parsed = imp.parsedData;
  const analysis = imp.analysis;

  const attached = await writeClient().$transaction(async (tx) => {
    const hasResume = await tx.candidateResume.findUnique({ where: { userId }, select: { id: true } });
    if (!hasResume) {
      await upsertResume(
        userId,
        {
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
        },
        tx,
      );
    }
    const ok = await markImportRegisteredTx(tx, imp.id, {
      status: "CLAIMED",
      userId,
      linkedExisting: true,
      clearDocument: !hasResume,
    });
    if (!ok) throw new Error(LOST_RACE);
    return true;
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === LOST_RACE) return false;
    throw error;
  });
  if (attached) logger.info("[resume-import] parsed import attached at signup", { userId, importId });
  return attached;
}

