import type { Prisma } from "@prisma/client";
import { PointsSourceType } from "@prisma/client";
import { SYNERGY_REFERRAL } from "./scoring";
import { dualWritePoints } from "@/repositories/dual-write";
//synergy event for referral
export async function awardReferralSynergy(
  tx: Prisma.TransactionClient,
  args: {
    referrerId: string;
    referralId: string;
    referredUserId: string;
  },
): Promise<number> {
  await tx.synergyEvent.create({
    data: {
      userId: args.referrerId,
      points: SYNERGY_REFERRAL,
      type: "REFERRAL",
      reason: `Referral signup (referralId=${args.referralId}, referredUserId=${args.referredUserId})`,
    },
  });
  await tx.user.update({
    where: { id: args.referrerId },
    data: { synergyPoints: { increment: SYNERGY_REFERRAL } },
  });
  await tx.studentProfile.updateMany({
    where: { userId: args.referrerId },
    data: { synergyPoints: { increment: SYNERGY_REFERRAL } },
  });
  await dualWritePoints(tx, {
    userId: args.referrerId,
    amount: SYNERGY_REFERRAL,
    sourceType: PointsSourceType.REFERRAL,
    sourceId: args.referralId,
    idempotencyKey: `referral:${args.referralId}`,
    reason: `Referral signup (referralId=${args.referralId}, referredUserId=${args.referredUserId})`,
  });
  return SYNERGY_REFERRAL;
}
