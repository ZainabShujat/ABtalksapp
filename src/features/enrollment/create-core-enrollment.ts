import { Domain, EnrollmentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { dualWriteChallengeEnrollment } from "@/repositories/dual-write";

export type CoreDomain = Extract<Domain, "AI" | "DS" | "SE">;

export const CORE_TRACK_PATH: Record<CoreDomain, string> = {
  AI: "/ai",
  DS: "/ds",
  SE: "/se",
};

export function isCoreDomain(value: string | undefined): value is CoreDomain {
  return value === "AI" || value === "DS" || value === "SE";
}

export type CreateCoreEnrollmentResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "no_user"
        | "no_challenge"
        | "already_enrolled"
        | "abandoned"
        | "internal_error";
      message: string;
    };

/**
 * Adds an AI / DS / SE challenge enrollment for an existing user joining a
 * second (or third) core track. Does not modify StudentProfile.domain.
 */
export async function createCoreEnrollment(
  userId: string,
  domain: CoreDomain,
): Promise<CreateCoreEnrollmentResult> {
  const userExists = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!userExists) {
    return {
      ok: false,
      reason: "no_user",
      message: "Session expired. Please sign in again.",
    };
  }

  const challenge = await prisma.challenge.findUnique({
    where: { domain },
    select: { id: true },
  });
  if (!challenge) {
    return {
      ok: false,
      reason: "no_challenge",
      message: "Challenge for this track is not available yet.",
    };
  }

  const existing = await prisma.enrollment.findFirst({
    where: { userId, challengeId: challenge.id },
    select: { id: true, status: true },
  });
  if (existing?.status === EnrollmentStatus.ABANDONED) {
    return {
      ok: false,
      reason: "abandoned",
      message: "You were removed from this track and cannot re-join it.",
    };
  }
  if (existing) {
    return {
      ok: false,
      reason: "already_enrolled",
      message: "You are already enrolled in this track.",
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const enrollment = await tx.enrollment.create({
        data: {
          userId,
          challengeId: challenge.id,
          domain,
          status: EnrollmentStatus.ACTIVE,
          daysCompleted: 0,
          currentStreak: 0,
          longestStreak: 0,
        },
        select: {
          id: true,
          userId: true,
          domain: true,
          status: true,
          startedAt: true,
          completedAt: true,
        },
      });
      await dualWriteChallengeEnrollment(tx, enrollment);
    });
    return { ok: true };
  } catch (e) {
    logger.error("[enrollment] createCoreEnrollment failed", {
      error: String(e),
    });
    return {
      ok: false,
      reason: "internal_error",
      message: "Something went wrong. Please try again.",
    };
  }
}
