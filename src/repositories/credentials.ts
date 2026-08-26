import "server-only";
import { prisma } from "@/lib/db";
import { isNewCredentialRepoEnabled } from "@/lib/feature-flags";
import type { CredentialView } from "@/repositories/types";

export async function getByPublicId(
  credentialId: string,
): Promise<CredentialView | null> {
  if (isNewCredentialRepoEnabled()) {
    const row = await prisma.credential.findUnique({
      where: { credentialId },
      select: {
        credentialId: true,
        userId: true,
        type: true,
        title: true,
        recipientName: true,
        status: true,
        issuedAt: true,
        metadata: true,
      },
    });
    if (!row) return null;
    return row;
  }

  const row = await prisma.certificate.findUnique({
    where: { certificateId: credentialId },
    select: {
      certificateId: true,
      userId: true,
      type: true,
      recipientName: true,
      status: true,
      issuedAt: true,
      metadata: true,
    },
  });
  if (!row) return null;
  return {
    credentialId: row.certificateId,
    userId: row.userId,
    type: row.type,
    title: row.type,
    recipientName: row.recipientName,
    status: row.status,
    issuedAt: row.issuedAt,
    metadata: row.metadata,
  };
}

export async function listForUser(userId: string): Promise<CredentialView[]> {
  if (isNewCredentialRepoEnabled()) {
    const rows = await prisma.credential.findMany({
      where: { userId },
      orderBy: [{ issuedAt: "desc" }, { credentialId: "asc" }],
      select: {
        credentialId: true,
        userId: true,
        type: true,
        title: true,
        recipientName: true,
        status: true,
        issuedAt: true,
        metadata: true,
      },
    });
    return rows;
  }

  const rows = await prisma.certificate.findMany({
    where: { userId },
    orderBy: [{ issuedAt: "desc" }, { certificateId: "asc" }],
    select: {
      certificateId: true,
      userId: true,
      type: true,
      recipientName: true,
      status: true,
      issuedAt: true,
      metadata: true,
    },
  });
  return rows.map((row) => ({
    credentialId: row.certificateId,
    userId: row.userId,
    type: row.type,
    title: row.type,
    recipientName: row.recipientName,
    status: row.status,
    issuedAt: row.issuedAt,
    metadata: row.metadata,
  }));
}
