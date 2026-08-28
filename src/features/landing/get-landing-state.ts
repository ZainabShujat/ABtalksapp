import "server-only";

import { Domain } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isProgramEnabled } from "@/lib/feature-flags";
import { logger } from "@/lib/logger";
import { resolveProgramMemberForUser } from "@/lib/program-auth";
import { isUserRegistered } from "@/features/hackathon/registration-status";

export type LandingUser = {
  name: string | null;
  email: string;
  image: string | null;
  isAdmin: boolean;
};

/** Per-track CTA override. `null` = keep the card's default href/label. */
export type TrackCta = { href: string; ctaLabel: string } | null;

export type LandingState = {
  user: LandingUser | null;
  challengeCta: TrackCta;
  claudeCta: TrackCta;
  programCta: TrackCta;
  hackathonCta: TrackCta;
  getStartedHref: string;
};

const EMPTY_CTAS = {
  challengeCta: null,
  claudeCta: null,
  programCta: null,
  hackathonCta: null,
  getStartedHref: "/login?from=%2Fregister",
} as const;

export async function getLandingState(): Promise<LandingState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { user: null, ...EMPTY_CTAS };
  }

  const userId = session.user.id;
  const user: LandingUser = {
    name: session.user.name ?? null,
    email: session.user.email ?? "",
    image: session.user.image ?? null,
    isAdmin: session.user.isAdmin ?? false,
  };

  try {
    const [profile, claudeEnrollment, programMember, hackathonRegistered] =
      await Promise.all([
        prisma.studentProfile.findUnique({
          where: { userId },
          select: { id: true },
        }),
        prisma.enrollment.findFirst({
          where: { userId, domain: Domain.CLAUDE },
          select: { id: true },
        }),
        isProgramEnabled()
          ? resolveProgramMemberForUser(userId)
          : Promise.resolve(null),
        isUserRegistered(userId),
      ]);

    return {
      user,
      getStartedHref: profile ? "/dashboard" : "/register",
      challengeCta: profile
        ? { href: "/dashboard", ctaLabel: "Open dashboard" }
        : null,
      claudeCta: claudeEnrollment
        ? {
            href: "/claude",
            ctaLabel: "Open dashboard",
          }
        : null,
      programCta: programMember
        ? { href: "/program/dashboard", ctaLabel: "Open dashboard" }
        : null,
      hackathonCta: hackathonRegistered
        ? { href: "/hackathon/dashboard", ctaLabel: "Open dashboard" }
        : null,
    };
  } catch (error) {
    logger.error("getLandingState failed", { userId, error });
    return { user, ...EMPTY_CTAS };
  }
}
