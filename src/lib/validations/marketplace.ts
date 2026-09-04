import { z } from "zod";

/**
 * A Redemption's primary key, which is NOT one shape.
 *
 * The schema declares `id String @id @default(cuid())`, but `redeemItem` has
 * supplied its own id since the Points write-authority invert (ffce6235):
 *
 *   const redemptionId = randomUUID();
 *   await tx.redemption.create({ data: { id: redemptionId, ... } })
 *
 * An explicit id means the column default never runs, so every redemption made
 * from that commit onward is a UUID and every one before it is a cuid. Both are
 * live in production.
 *
 * `z.string().cuid()` alone was rejecting the UUIDs, and it is the FIRST thing
 * `updateRedemptionStatusAction` does — so Mark Shipped, Mark Fulfilled and
 * Cancel all failed on any recent order with Zod's own default message,
 * "Invalid cuid". Cancel failing also meant the SP refund never ran, since that
 * lives past this gate.
 *
 * Accepting both is the honest fix. Regenerating the ids is not an option: they
 * are already written into PointsLedger as `sourceId` and into its idempotency
 * keys (`redeem:<id>`, `redeem-refund:<id>`), so changing one would be a data
 * migration across the ledger, to correct nothing that is actually wrong.
 */
const redemptionId = z.union([z.string().uuid(), z.string().cuid()], {
  message: "Invalid redemption",
});

export const redeemItemSchema = z.object({
  // Unlike Redemption above, MarketplaceItem ids are left to the column
  // default, so they really are cuids.
  itemId: z.string().cuid("Invalid item"),
  shippingAddress: z.string().min(20, "Address looks too short").max(1000),
  recipientPhone: z.string().min(7, "Enter a valid phone").max(20),
});

export const updateRedemptionStatusSchema = z.object({
  redemptionId,
  nextStatus: z.enum(["SHIPPED", "FULFILLED", "CANCELLED"]),
  trackingNote: z.string().max(500).optional(),
});
