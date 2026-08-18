import type { Prisma } from "@prisma/client";
import { SYNERGY_REFERRAL } from "./scoring";
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
  return SYNERGY_REFERRAL;
}
