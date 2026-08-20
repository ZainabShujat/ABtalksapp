import { cache } from "react";
import { prisma } from "@/lib/db";

/**
 * Canonical user + studentProfile lookup for the dashboard. Wrapped in React
 * `cache()` so repeat calls within a single render collapse to one DB hit.
 */
export const getUserWithProfile = cache(async (userId: string) => {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      studentProfile: {
        select: {
          fullName: true,
          domain: true,
          userType: true,
          college: true,
          organization: true,
          role: true,
          referralCode: true,
          isReadyForInterview: true,
          isCampusAmbassadorCandidate: true,
          ambassadorDismissedAt: true,
          phone: true,
          phoneVerified: true,
        },
      },
    },
  });
});
