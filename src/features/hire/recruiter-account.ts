import "server-only";

import { prisma } from "@/lib/db";
import { candidatePublicId } from "@/features/hire/public-id";
import type { RecruiterAccountSnapshot } from "@/features/hire/recruiter-account-types";

export type { RecruiterAccountSnapshot } from "@/features/hire/recruiter-account-types";

/**
 * Header-menu payload for an approved recruiter.
 *
 * Candidate names are never included — the menu uses the same public AB-####
 * labels as the rest of the portal. Identity is released only on the requests
 * page after CONTACT_SHARED.
 */
export async function getRecruiterAccountSnapshot(
  userId: string,
): Promise<RecruiterAccountSnapshot | null> {
  const profile = await prisma.recruiterProfile.findUnique({
    where: { userId },
    select: {
      fullName: true,
      company: true,
      approved: true,
      user: { select: { email: true } },
    },
  });
  if (!profile?.approved) return null;

  const [cartItems, cartCount, requestItems, requestCount] = await Promise.all([
    prisma.recruiterShortlistItem.findMany({
      where: { recruiterUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        memberId: true,
        member: { select: { jobRole: true } },
      },
    }),
    prisma.recruiterShortlistItem.count({
      where: { recruiterUserId: userId },
    }),
    prisma.talentEngagementRequest.findMany({
      where: { recruiterUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        candidatePublicId: true,
        status: true,
        programMember: { select: { jobRole: true } },
      },
    }),
    prisma.talentEngagementRequest.count({
      where: { recruiterUserId: userId },
    }),
  ]);

  return {
    fullName: profile.fullName,
    company: profile.company,
    email: profile.user.email,
    cartCount,
    requestCount,
    cart: cartItems.map((item) => ({
      memberId: item.memberId,
      publicId: candidatePublicId(item.memberId),
      jobRole: item.member.jobRole,
    })),
    requests: requestItems.map((item) => ({
      id: item.id,
      publicId: item.candidatePublicId,
      status: item.status,
      jobRole: item.programMember?.jobRole ?? null,
    })),
  };
}
