import type { Prisma } from "@prisma/client";
import { PointsSourceType } from "@prisma/client";
import { computeSubmissionSynergy } from "./scoring";
import { applyPointsChange } from "@/repositories/points";

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

  const applied = await applyPointsChange(tx, {
    userId: args.userId,
    amount: points,
    mode: "credit",
    sourceType: PointsSourceType.ACTIVITY_ATTEMPT,
    sourceId: args.submissionId,
    idempotencyKey: `submission:${args.submissionId}`,
    reason: `submission day ${args.dayNumber}`,
    legacyEvent: {
      type: "SUBMISSION",
      submissionId: args.submissionId,
      enrollmentId: args.enrollmentId,
      dayNumber: args.dayNumber,
    },
  });
  if (!applied.ok) {
    throw new Error("Failed to award submission synergy");
  }
  return points;
}
