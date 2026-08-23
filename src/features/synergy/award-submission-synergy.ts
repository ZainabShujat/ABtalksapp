import type { Prisma } from "@prisma/client";
import { PointsSourceType } from "@prisma/client";
import { computeSubmissionSynergy } from "./scoring";
import { dualWritePoints } from "@/repositories/dual-write";

export async function awardSubmissionSynergy(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    submissionId: string;
    enrollmentId: string;
    challengeId: string;
    dayNumber: number;
    hasGithub: boolean;
    hasLinkedin: boolean;
  },
): Promise<number> {
  const { points } = computeSubmissionSynergy({
    hasGithub: args.hasGithub,
    hasLinkedin: args.hasLinkedin,
  });

  await tx.synergyEvent.create({
    data: {
      userId: args.userId,
      points,
      type: "SUBMISSION",
      submissionId: args.submissionId,
      enrollmentId: args.enrollmentId,
      dayNumber: args.dayNumber,
      rankAtAward: null,
    },
  });
  await tx.user.update({
    where: { id: args.userId },
    data: { synergyPoints: { increment: points } },
  });
  await tx.studentProfile.updateMany({
    where: { userId: args.userId },
    data: { synergyPoints: { increment: points } },
  });
  await dualWritePoints(tx, {
    userId: args.userId,
    amount: points,
    sourceType: PointsSourceType.ACTIVITY_ATTEMPT,
    sourceId: args.submissionId,
    idempotencyKey: `submission:${args.submissionId}`,
    reason: `submission day ${args.dayNumber}`,
  });
  return points;
}
