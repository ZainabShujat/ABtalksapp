import type { Domain } from "@prisma/client";
import { EnrollmentStatus } from "@prisma/client";
import { listChallengeEnrollments } from "@/repositories/learning";

export interface UserEnrollmentSummary {
  id: string;
  domain: Domain;
  challengeTitle: string;
  daysCompleted: number;
  currentStreak: number;
}

export async function getUserActiveEnrollments(
  userId: string,
): Promise<UserEnrollmentSummary[]> {
  const enrollments = await listChallengeEnrollments(userId);
  return enrollments
    .filter((e) => e.status === EnrollmentStatus.ACTIVE)
    .map((e) => ({
      id: e.id,
      domain: e.domain,
      challengeTitle: e.challengeTitle,
      daysCompleted: e.daysCompleted,
      currentStreak: e.currentStreak,
    }));
}
