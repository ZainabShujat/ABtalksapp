import { RedemptionStatus, PointsSourceType } from "@prisma/client";
import { writeClient } from "@/lib/db";
import { applyPointsChange, getBalance, withLegacyPointsMirrorFlush } from "@/repositories/points";
import { randomUUID } from "node:crypto";

export type RedeemResult =
  | { ok: true; redemptionId: string; newBalance: number }
  | {
      ok: false;
      reason: "insufficient" | "inactive" | "not_found" | "validation";
      message: string;
    };

export async function redeemItem(input: {
  userId: string;
  itemId: string;
  shippingAddress: string;
  recipientPhone: string;
}): Promise<RedeemResult> {
  return withLegacyPointsMirrorFlush(() =>
    writeClient().$transaction(
    async (tx) => {
      const item = await tx.marketplaceItem.findUnique({
        where: { id: input.itemId },
        select: { id: true, title: true, costSP: true, active: true },
      });
      if (!item)
        return {
          ok: false,
          reason: "not_found",
          message: "Item not found",
        };
      if (!item.active)
        return {
          ok: false,
          reason: "inactive",
          message: "Item is no longer available",
        };
      // Items priced at 0 SP are "Revealing Soon" — not redeemable yet.
      if (item.costSP <= 0)
        return {
          ok: false,
          reason: "inactive",
          message: "This item isn't available for redemption yet.",
        };

      const redemptionId = randomUUID();
      const reason = `Redeemed ${item.title} (redemptionId=${redemptionId})`;
      const applied = await applyPointsChange(tx, {
        userId: input.userId,
        amount: -item.costSP,
        mode: "debit_strict",
        sourceType: PointsSourceType.REDEMPTION,
        sourceId: redemptionId,
        idempotencyKey: `redeem:${redemptionId}`,
        reason,
        legacyEvent: { type: "REDEEM" },
      });

      if (!applied.ok) {
        if (applied.reason === "not_found") {
          return {
            ok: false,
            reason: "not_found",
            message: "Account not found",
          };
        }
        const current = await getBalance(input.userId, tx);
        return {
          ok: false,
          reason: "insufficient",
          message: `You need ${Math.max(item.costSP - current, 0)} more SP for this item.`,
        };
      }

      const redemption = await tx.redemption.create({
        data: {
          id: redemptionId,
          userId: input.userId,
          itemId: item.id,
          costSP: item.costSP,
          itemTitle: item.title,
          status: RedemptionStatus.PENDING,
          shippingAddress: input.shippingAddress.trim(),
          recipientPhone: input.recipientPhone.trim(),
        },
        select: { id: true },
      });

      return {
        ok: true,
        redemptionId: redemption.id,
        newBalance: applied.newBalance,
      };
    },
    { maxWait: 5000, timeout: 10000 },
    ),
  );
}
