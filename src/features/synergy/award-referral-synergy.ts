import type { Prisma } from "@prisma/client";
import { PointsSourceType } from "@prisma/client";
import { SYNERGY_REFERRAL } from "./scoring";
import { applyPointsChange } from "@/repositories/points";

export async function awardReferralSynergy(
  tx: Prisma.TransactionClient,
  args: {
    referrerId: string;
    referralId: string;
    referredUserId: string;
  },
): Promise<number> {
  const reason = `Referral signup (referralId=${args.referralId}, referredUserId=${args.referredUserId})`;
  const applied = await applyPointsChange(tx, {
    userId: args.referrerId,
    amount: SYNERGY_REFERRAL,
    mode: "credit",
    sourceType: PointsSourceType.REFERRAL,
    sourceId: args.referralId,
    idempotencyKey: `referral:${args.referralId}`,
    reason,
    legacyEvent: { type: "REFERRAL" },
  });
  if (!applied.ok) {
    throw new Error("Failed to award referral synergy");
  }
  return SYNERGY_REFERRAL;
}
