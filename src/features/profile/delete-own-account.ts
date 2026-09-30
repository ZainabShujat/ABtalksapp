import "server-only";

import { PlatformRole, RoleScopeType, type Prisma } from "@prisma/client";
import { writeAudit } from "@/features/admin/audit";

type Tx = Prisma.TransactionClient;

export class DeleteOwnAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeleteOwnAccountError";
  }
}

export async function deleteOwnCandidateAccount(
  tx: Tx,
  input: { userId: string; leaveReason: string; feedback: string | null },
): Promise<{ email: string; name: string | null }> {
  const { userId, leaveReason, feedback } = input;

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
    throw new DeleteOwnAccountError("Platform admin accounts cannot be deleted here.");
  }

  const recruiter = await tx.recruiterProfile.findFirst({
    where: { userId },
    select: { id: true },
  });
  if (recruiter) {
    throw new DeleteOwnAccountError(
      "Recruiter accounts cannot be deleted from this screen.",
    );
  }

  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      deletedAt: true,
      password: true,
      candidateProfile: { select: { fullName: true } },
    },
  });
  if (!user) {
    throw new DeleteOwnAccountError("User not found");
  }
  if (user.deletedAt) {
    throw new DeleteOwnAccountError("This account is already deleted.");
  }

  const emailDomain = user.email.includes("@")
    ? (user.email.split("@")[1] ?? null)
    : null;
  const displayName =
    user.candidateProfile?.fullName?.trim() || user.name?.trim() || null;

  await writeAudit(tx, {
    actorUserId: userId,
    adminUserId: null,
    targetUserId: userId,
    entityType: "User",
    entityId: userId,
    actionType: "ACCOUNT_SELF_DELETE",
    // Reason + feedback go in `reason` so they show (and are searchable) on
    // /admin/actions; `metadata` keeps them structured.
    reason: feedback
      ? `Candidate requested account deletion. Reason: ${leaveReason}. Feedback: "${feedback}"`
      : `Candidate requested account deletion. Reason: ${leaveReason}.`,
    previousState: {
      emailDomain,
      role: user.role,
      hadPassword: Boolean(user.password),
    },
    newState: { deleted: true },
    // Product decision (2026-09-29): keep who left so admins can follow up.
    // The user row is hard-deleted below, so this snapshot is the only
    // record of the name and address. Pending security-owner review.
    metadata: {
      leaveReason,
      feedback,
      deletedUser: { name: displayName, email: user.email },
    },
  });

  await tx.creditTransaction.updateMany({
    where: { candidateUserId: userId },
    data: { candidateUserId: null },
  });
  await tx.talentEngagementRequest.updateMany({
    where: { candidateUserId: userId },
    data: { candidateUserId: null },
  });

  await tx.user.delete({ where: { id: userId } });

  return { email: user.email, name: displayName };
}
