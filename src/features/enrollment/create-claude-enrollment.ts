import { Domain, EnrollmentStatus } from "@prisma/client";
import { prisma, writeClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import { dualWriteChallengeEnrollment } from "@/repositories/dual-write";
import { findChallengeEnrollment, getChallengeByDomain } from "@/repositories/learning";

export type CreateClaudeEnrollmentResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not_authenticated"
        | "no_user"
        | "no_challenge"
        | "already_enrolled"
        | "abandoned"
        | "internal_error";
      message: string;
    };

/**
 * Adds a CLAUDE challenge enrollment for an existing user (dashboard modal).
 * First track joined backfills a null profile domain; never overwrites an existing one.
 */
export async function createClaudeEnrollment(
  userId: string,
): Promise<CreateClaudeEnrollmentResult> {
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

  const challenge = await getChallengeByDomain(Domain.CLAUDE);
  if (!challenge) {
    return {
      ok: false,
      reason: "no_challenge",
      message: "Claude challenge is not yet available. Please try again later.",
    };
  }

  const existing = await findChallengeEnrollment(userId, { domain: Domain.CLAUDE });
  if (existing?.status === EnrollmentStatus.ABANDONED) {
    return {
      ok: false,
      reason: "abandoned",
      message: "You were removed from the Claude Challenge and cannot re-join it.",
    };
  }
  if (existing) {
    return {
      ok: false,
      reason: "already_enrolled",
      message: "You are already enrolled in the Claude Challenge.",
    };
  }

  try {
    await writeClient().$transaction(async (tx) => {
      const enrollment = await tx.enrollment.create({
        data: {
          userId,
          challengeId: challenge.id,
          domain: Domain.CLAUDE,
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
      // First track joined becomes the profile's primary domain. Never overwrite.
      await tx.studentProfile.updateMany({
        where: { userId, domain: null },
        data: { domain: Domain.CLAUDE },
      });
      await dualWriteChallengeEnrollment(tx, enrollment);
    });
    return { ok: true };
  } catch (e) {
    logger.error("[enrollment] createClaudeEnrollment failed", {
      error: String(e),
    });
    return {
      ok: false,
      reason: "internal_error",
      message: "Something went wrong. Please try again.",
    };
  }
}
