import "server-only";

import type { Prisma } from "@prisma/client";

export type AuditInput = {
  actorUserId: string;
  adminUserId?: string | null;
  targetUserId?: string | null;
  entityType: string;
  entityId: string;
  actionType: string;
  reason: string;
  previousState?: Prisma.InputJsonValue | null;
  newState?: Prisma.InputJsonValue | null;
  metadata?: Prisma.InputJsonValue | null;
  organizationId?: string | null;
};

/**
 * Name + email saved on an ACCOUNT_SELF_DELETE row. The user row is gone
 * by the time anyone reads it, so this is the only way to show who left.
 */
export function deletedUserSnapshot(
  metadata: Prisma.JsonValue,
): { name: string | null; email: string } | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const raw = metadata.deletedUser;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const email = typeof raw.email === "string" ? raw.email : null;
  if (!email) return null;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name : null;
  return { name, email };
}

export async function writeAudit(
  tx: Prisma.TransactionClient,
  input: AuditInput,
): Promise<void> {
  await tx.adminAction.create({
    data: {
      actorUserId: input.actorUserId,
      adminUserId: input.adminUserId ?? null,
      targetUserId: input.targetUserId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      actionType: input.actionType,
      reason: input.reason,
      previousState: input.previousState ?? undefined,
      newState: input.newState ?? undefined,
      metadata: input.metadata ?? undefined,
      organizationId: input.organizationId ?? null,
    },
    select: { id: true },
  });
}
