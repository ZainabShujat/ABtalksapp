import type { Prisma } from "@prisma/client";
import { PointsSourceType } from "@prisma/client";
import { SYNERGY_DAILY_SUBMISSION_CAP } from "./scoring";
import { logger } from "@/lib/logger";
import {
  applyPointsChange,
  hasEarnedSubmissionPointsOnIstDate,
  lockWalletBalance,
} from "@/repositories/points";

export async function awardSubmissionSynergy(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    submissionId: string;
    enrollmentId: string;
    challengeId: string;
    dayNumber: number;
    istDateKey: string;
  },
): Promise<number> {
  // Plan 111: one paid submission per IST calendar day, across every
  // enrollment. The first submission of the day wins; later ones award 0.
  //
  // Lock the wallet row before the read. Without it two concurrent submissions
  // in different challenges both see "unpaid" under READ COMMITTED and both
  // grant — which is the exact stacking this cap exists to stop.
  await lockWalletBalance(tx, args.userId);
  const alreadyPaid = await hasEarnedSubmissionPointsOnIstDate(tx, {
    userId: args.userId,
    istDateKey: args.istDateKey,
  });
  if (alreadyPaid) {
    logger.info("[synergy] daily submission cap reached; awarding 0", {
      userId: args.userId,
      submissionId: args.submissionId,
      istDateKey: args.istDateKey,
    });
    return 0;
  }

  const applied = await applyPointsChange(tx, {
    userId: args.userId,
    amount: SYNERGY_DAILY_SUBMISSION_CAP,
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
  return SYNERGY_DAILY_SUBMISSION_CAP;
}
