import type { Domain, SubmissionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentDayNumber, getElapsedDayNumber } from "@/lib/date-utils";
import { readDayNumberFromMetadata } from "@/lib/admin-action-metadata";
import { resolveChallengeEnrollment } from "@/features/enrollment/resolve-dashboard-enrollment";
import { isWithinRelaxationWindow } from "@/features/submission/submit-day";
import {
  getDailyTaskByChallengeDay,
  type DailyTaskRow,
} from "@/repositories/learning";
import { getChallengeDaySubmission } from "@/repositories/progress";

export type DayData = {
  task: DailyTaskRow;
  existingSubmission: {
    githubUrl: string | null;
    linkedinUrl: string | null;
    status: SubmissionStatus;
    submittedAt: Date;
  } | null;
  currentDayNumber: number;
  isUnlocked: boolean;
  /** Admin rejected this day’s submission (row deleted); user may still resubmit via /challenge/[day]. */
  hasRejectResubmit: boolean;
  /** Past missed day inside the 5-day relaxation window (today + previous 4). */
  isRelaxable: boolean;
  enrollment: { id: string; domain: Domain };
};

export async function getDayData(
  userId: string,
  dayNumber: number,
  enrollmentId?: string | null,
): Promise<DayData | null> {
  const enrollment = await resolveChallengeEnrollment(
    userId,
    enrollmentId ?? undefined,
  );

  if (!enrollment) {
    return null;
  }

  const task = await getDailyTaskByChallengeDay(
    enrollment.challengeId,
    dayNumber,
  );

  if (!task) {
    return null;
  }

  const submission = await getChallengeDaySubmission(enrollment.id, dayNumber);

  const rejectActions = await prisma.adminAction.findMany({
    where: {
      targetUserId: enrollment.userId,
      actionType: "REJECT_SUBMISSION",
    },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
    take: 120,
  });
  const hasRejectResubmit = rejectActions.some(
    (a) => readDayNumberFromMetadata(a.metadata) === dayNumber,
  );

  const currentDayNumber = getCurrentDayNumber(enrollment, enrollment.challenge);
  const elapsedDayNumber = getElapsedDayNumber(enrollment, enrollment.challenge);
  const isUnlocked = dayNumber <= currentDayNumber;
  const isRelaxable =
    !submission && isWithinRelaxationWindow(elapsedDayNumber, dayNumber);

  return {
    task,
    existingSubmission: submission,
    currentDayNumber,
    isUnlocked,
    hasRejectResubmit,
    isRelaxable,
    enrollment: { id: enrollment.id, domain: enrollment.domain },
  };
}
