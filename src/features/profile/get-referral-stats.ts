import { prisma } from "@/lib/db";
import {
  getCandidateProfile,
  listCandidateProfiles,
} from "@/repositories/candidate";

export type ReferralBadgeTier = "none" | "bronze" | "silver" | "gold" | "platinum";

export type ReferralStatsNextBadge = {
  name: string;
  requiredCount: number;
};

export type ReferralListItem = {
  id: string;
  referredName: string;
  referredDomain: string;
  joinedAt: string;
  completedDay7: boolean;
};

export type ReferralStats = {
  referralCode: string;
  totalReferrals: number;
  rewardedReferrals: number;
  pendingReferrals: number;
  currentBadge: ReferralBadgeTier;
  nextBadge: ReferralStatsNextBadge | null;
  referrals: ReferralListItem[];
};

function badgeFromRewarded(rewarded: number): ReferralBadgeTier {
  if (rewarded >= 25) return "platinum";
  if (rewarded >= 10) return "gold";
  if (rewarded >= 5) return "silver";
  if (rewarded >= 1) return "bronze";
  return "none";
}

function nextBadgeForRewarded(
  rewarded: number,
): ReferralStatsNextBadge | null {
  if (rewarded >= 25) return null;
  if (rewarded >= 10) return { name: "Platinum", requiredCount: 25 };
  if (rewarded >= 5) return { name: "Gold", requiredCount: 10 };
  if (rewarded >= 1) return { name: "Silver", requiredCount: 5 };
  return { name: "Bronze", requiredCount: 1 };
}

export async function getReferralStats(
  userId: string,
): Promise<ReferralStats | null> {
  const profile = await getCandidateProfile(userId);

  if (!profile) {
    return null;
  }

  const rows = await prisma.referral.findMany({
    where: { referrerId: userId },
    orderBy: { createdAt: "desc" },
    include: {
      referred: {
        select: {
          id: true,
          email: true,
          studentProfile: {
            select: { domain: true },
          },
        },
      },
    },
  });

  const identities = await listCandidateProfiles(rows.map((r) => r.referred.id));

  const totalReferrals = rows.length;
  const rewardedReferrals = rows.filter((r) => r.rewardGiven).length;
  const pendingReferrals = Math.max(0, totalReferrals - rewardedReferrals);

  const currentBadge = badgeFromRewarded(rewardedReferrals);
  const nextBadge = nextBadgeForRewarded(rewardedReferrals);

  const referrals: ReferralListItem[] = rows.map((r) => {
    const identity = identities.get(r.referred.id);
    const referredName =
      identity?.fullName?.trim() || r.referred.email || "Unknown";
    const referredDomain = r.referred.studentProfile?.domain ?? "-";
    return {
      id: r.id,
      referredName,
      referredDomain,
      joinedAt: r.createdAt.toISOString(),
      completedDay7: r.rewardGiven,
    };
  });

  return {
    referralCode: profile.referralCode,
    totalReferrals,
    rewardedReferrals,
    pendingReferrals,
    currentBadge,
    nextBadge,
    referrals,
  };
}
