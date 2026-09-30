import "server-only";

import { PlatformRole, RoleScopeType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/features/admin/audit";

type Tx = Prisma.TransactionClient;

export class DeleteRecruiterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeleteRecruiterError";
  }
}

export type PurgeRecruiterInput = {
  userId: string;
  actorUserId: string;
  /** False when the recruiter is deleting themselves. */
  byAdmin: boolean;
  reason: string;
};

export type PurgeRecruiterResult = {
  organizationId: string | null;
  /** Deleted by the caller AFTER the commit — a blob cannot join a transaction. */
  logoUrl: string | null;
};

/**
 * Permanently delete a recruiter account (plan 160).
 *
 * **Why this purges instead of deleting the row.** `user.delete()` on a
 * recruiter fails in the database. Three foreign keys are RESTRICT, all of them
 * the credit ledger — `CreditTransaction.recruiterUserId`,
 * `CreditTransaction.organizationId` and `CreditAccount.organizationId` — and
 * that is what enforces the ledger's append-only guarantee ("Rows are never
 * updated and never deleted"). Every recruiter carries at least the onboarding
 * grant, so no recruiter is row-deletable without first weakening a financial
 * table. So the account is emptied and anonymised instead, and the ledger is
 * left exactly as it was.
 *
 * **Nothing here can rely on a cascade.** `TalentRequest`, `OutreachThread`,
 * `TalentList` and the rest cascade from `User` or `Organization` — but both of
 * those rows survive, so none of those cascades fire. Every child row is deleted
 * by name below, and `delete-recruiter-account.test.ts` fails if the schema
 * grows a recruiter-owned table that this function does not name.
 *
 * Call only inside `writeClient().$transaction`.
 */
export async function purgeRecruiterAccount(
  tx: Tx,
  input: PurgeRecruiterInput,
): Promise<PurgeRecruiterResult> {
  const { userId, actorUserId, byAdmin } = input;

  // 1. An admin deletes other people here. Deleting themselves is a different
  //    decision with a different blast radius, and deleteUserAccountAction
  //    refuses it for the same reason.
  if (byAdmin && userId === actorUserId) {
    throw new DeleteRecruiterError("You cannot delete your own account here.");
  }

  // 2. Never from a product surface. Same rule as anonymizeUser and
  //    deleteOwnCandidateAccount.
  const adminRow = await tx.userRoleAssignment.findFirst({
    where: {
      userId,
      role: PlatformRole.ADMIN,
      scopeType: RoleScopeType.GLOBAL,
      revokedAt: null,
    },
    select: { id: true },
  });
  if (adminRow) {
    throw new DeleteRecruiterError("Platform admin accounts cannot be deleted here.");
  }

  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, deletedAt: true },
  });
  if (!user) throw new DeleteRecruiterError("Account not found.");
  if (user.deletedAt) {
    throw new DeleteRecruiterError("This account is already deleted.");
  }

  // 3. A candidate's deletion is a different shape entirely — this routine must
  //    not be pointed at one.
  const profile = await tx.recruiterProfile.findUnique({
    where: { userId },
    select: { id: true, company: true },
  });
  if (!profile) {
    throw new DeleteRecruiterError("This is not a recruiter account.");
  }

  const membership = await tx.organizationMember.findFirst({
    where: { userId },
    select: { organizationId: true },
  });
  const organizationId = membership?.organizationId ?? null;

  // 4. Money. A recruiter must not destroy a balance they paid for with one
  //    click; an admin can, and the audit row records the forfeiture.
  const account = organizationId
    ? await tx.creditAccount.findUnique({
        where: { organizationId },
        select: { balance: true },
      })
    : null;
  const purchased = organizationId
    ? await tx.creditTransaction.aggregate({
        where: { organizationId, type: "PURCHASE" },
        _sum: { amount: true },
      })
    : null;
  const balanceMinor = account?.balance ?? 0;
  const purchasedMinor = purchased?._sum.amount ?? 0;

  if (!byAdmin && purchasedMinor > 0 && balanceMinor > 0) {
    throw new DeleteRecruiterError(
      "This workspace still holds purchased credits. Contact support to close the account.",
    );
  }

  const now = new Date();
  // Domain only, never the address — the same thing deleteOwnCandidateAccount
  // records, for the same reason.
  const emailDomain = user.email.includes("@")
    ? (user.email.split("@")[1] ?? null)
    : null;

  // 5. Audit FIRST, while the company name and the email domain are still
  //    readable. After the wipe below, neither is.
  await writeAudit(tx, {
    actorUserId,
    adminUserId: byAdmin ? actorUserId : null,
    targetUserId: userId,
    entityType: "RecruiterProfile",
    entityId: profile.id,
    organizationId,
    actionType: "RECRUITER_ACCOUNT_DELETED",
    reason: input.reason,
    previousState: {
      emailDomain,
      role: user.role,
      company: profile.company,
      organizationId,
      balanceMinor,
      purchasedMinor,
    },
    newState: { deleted: true },
    metadata: { byAdmin, ledgerPreserved: true },
  });

  // 6. The organization's children. They cascade from Organization, and the
  //    Organization is NOT being deleted — it survives to hold the ledger.
  let logoUrl: string | null = null;
  if (organizationId) {
    const org = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { logoUrl: true },
    });
    logoUrl = org?.logoUrl ?? null;

    await tx.recruiterAssessment.deleteMany({ where: { organizationId } });
    await tx.talentList.deleteMany({ where: { organizationId } });
    await tx.candidateNote.deleteMany({ where: { organizationId } });
    await tx.outreachThread.deleteMany({ where: { organizationId } });
  }

  // 7. The recruiter's own rows. They cascade from User, and the User is NOT
  //    being deleted either.
  await tx.talentRequest.deleteMany({ where: { recruiterUserId: userId } });
  await tx.talentEngagementRequest.deleteMany({ where: { recruiterUserId: userId } });
  // Their sourcing asks, which carry `recruiterNote` in their own words. The
  // shared `VirtualCandidate` profile is deliberately NOT deleted — it can be
  // another recruiter's requirement too; only the per-recruiter ask is theirs.
  // `VirtualCandidateEvent` cascades from the request.
  await tx.virtualCandidateRequest.deleteMany({ where: { recruiterUserId: userId } });
  await tx.recruiterShortlistItem.deleteMany({ where: { recruiterUserId: userId } });
  await tx.outreachThread.deleteMany({ where: { recruiterUserId: userId } });
  await tx.recruiterProfile.deleteMany({ where: { userId } });
  await tx.organizationMember.deleteMany({ where: { userId } });

  // Revoked rather than deleted, matching anonymizeUser: who held what, and
  // when, is worth keeping.
  await tx.userRoleAssignment.updateMany({
    where: { userId, revokedAt: null },
    data: {
      revokedAt: now,
      revokedReason: byAdmin
        ? "Recruiter account deleted by admin"
        : "Recruiter account deleted by the account holder",
    },
  });

  // 8. The workspace survives only as a ledger anchor, so it must stop carrying
  //    company identity.
  if (organizationId) {
    await tx.organization.update({
      where: { id: organizationId },
      data: {
        name: "Deleted workspace",
        websiteUrl: null,
        industry: null,
        sizeBucket: null,
        location: null,
        logoUrl: null,
        isVerified: false,
      },
      select: { id: true },
    });
  }

  // 9. The account itself. Renaming the email releases the real address for
  //    re-registration, which is what makes this a deletion rather than a ban.
  await tx.user.update({
    where: { id: userId },
    data: {
      deletedAt: now,
      anonymizedAt: now,
      email: `deleted+${userId}@deleted.local`,
      name: "Deleted User",
      image: null,
      password: null,
      emailVerified: null,
      sessionInvalidatedAt: now,
    },
    select: { id: true },
  });

  // Password is null, the Google link is gone, and the address no longer exists
  // — so no credential and no live session survives this.
  await tx.account.deleteMany({ where: { userId } });
  await tx.session.deleteMany({ where: { userId } });

  return { organizationId, logoUrl };
}

/**
 * The balance that blocks a self-service deletion, or 0 when nothing does.
 *
 * Deliberately the same condition as guard 4 in `purgeRecruiterAccount` — the
 * settings page uses this to disable the button, and a UI that disagreed with
 * the server would either dead-end the recruiter or promise something the
 * server then refuses.
 */
export async function blockingPurchasedBalanceMinor(
  organizationId: string,
): Promise<number> {
  const [account, purchased] = await Promise.all([
    prisma.creditAccount.findUnique({
      where: { organizationId },
      select: { balance: true },
    }),
    prisma.creditTransaction.aggregate({
      where: { organizationId, type: "PURCHASE" },
      _sum: { amount: true },
    }),
  ]);
  const balanceMinor = account?.balance ?? 0;
  const purchasedMinor = purchased._sum.amount ?? 0;
  return purchasedMinor > 0 && balanceMinor > 0 ? balanceMinor : 0;
}
