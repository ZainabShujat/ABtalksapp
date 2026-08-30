"use server";

import { RedemptionStatus, PointsSourceType } from "@prisma/client";
import { requireAdmin } from "@/lib/admin-auth";
import { writeClient } from "@/lib/db";
import { updateRedemptionStatusSchema } from "@/lib/validations/marketplace";
import { applyPointsChange, withLegacyPointsMirrorFlush } from "@/repositories/points";

export async function updateRedemptionStatusAction(formData: FormData) {
  await requireAdmin();
  const parsed = updateRedemptionStatusSchema.safeParse({
    redemptionId: formData.get("redemptionId"),
    nextStatus: formData.get("nextStatus"),
    trackingNote: formData.get("trackingNote") ?? undefined,
  });
  if (!parsed.success) {
    return {
      ok: false as const,
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const { redemptionId, nextStatus, trackingNote } = parsed.data;

  return withLegacyPointsMirrorFlush(() =>
    writeClient().$transaction(async (tx) => {
    const current = await tx.redemption.findUnique({
      where: { id: redemptionId },
      select: { status: true, userId: true, costSP: true },
    });
    if (!current)
      return { ok: false as const, message: "Redemption not found" };

    const allowed: Record<RedemptionStatus, RedemptionStatus[]> = {
      PENDING: ["SHIPPED", "FULFILLED", "CANCELLED"],
      SHIPPED: ["FULFILLED", "CANCELLED"],
      FULFILLED: [],
      CANCELLED: [],
    };
    if (!allowed[current.status].includes(nextStatus)) {
      return {
        ok: false as const,
        message: `Cannot transition ${current.status} → ${nextStatus}`,
      };
    }

    const transition = await tx.redemption.updateMany({
      where: { id: redemptionId, status: current.status },
      data: { status: nextStatus, trackingNote: trackingNote ?? undefined },
    });
    if (transition.count === 0) {
      return {
        ok: false as const,
        message: "Redemption status changed; refresh and try again",
      };
    }

    if (
      nextStatus === RedemptionStatus.CANCELLED &&
      current.status !== RedemptionStatus.CANCELLED
    ) {
      const applied = await applyPointsChange(tx, {
        userId: current.userId,
        amount: current.costSP,
        mode: "credit",
        sourceType: PointsSourceType.REDEMPTION_REFUND,
        sourceId: redemptionId,
        idempotencyKey: `redeem-refund:${redemptionId}`,
        reason: `Refund for cancelled redemption ${redemptionId}`,
        legacyEvent: { type: "REDEEM_REFUND" },
      });
      if (!applied.ok) {
        throw new Error("Failed to refund points");
      }
    }

    return { ok: true as const };
  }),
  );
}
