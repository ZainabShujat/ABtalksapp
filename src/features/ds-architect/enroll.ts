import "server-only";
import { EnrollmentStatusV2 } from "@prisma/client";
import { writeClient } from "@/lib/db";
import {
  DS_ARCHITECT_MAX_MISSION_POINTS,
  DS_ARCHITECT_TOTAL_DAYS,
} from "@/features/ds-architect/constants";
import type { DsArchitectEnrollInput } from "@/lib/validations/ds-architect";
import { getProfileSummary, updateCandidateLinks } from "@/repositories/candidate";
import {
  createDsArchitectEnrollmentRow,
  findDsArchitectEnrollment,
  getDsArchitectCohort,
} from "@/repositories/ds-architect";

export type DsArchitectEntryState =
  | { screen: "needs_profile" }
  | { screen: "closed" }
  | { screen: "form" }
  | { screen: "enrolled"; enrollmentId: string };

export async function getDsArchitectEntryState(
  userId: string,
): Promise<DsArchitectEntryState> {
  const existing = await findDsArchitectEnrollment(userId);
  if (
    existing &&
    (existing.status === EnrollmentStatusV2.ACTIVE ||
      existing.status === EnrollmentStatusV2.COMPLETED)
  ) {
    return { screen: "enrolled", enrollmentId: existing.id };
  }

  const profile = await getProfileSummary(userId);
  if (!profile) return { screen: "needs_profile" };

  const cohort = await getDsArchitectCohort();
  if (
    !cohort ||
    (cohort.status !== "ENROLLING" && cohort.status !== "ACTIVE")
  ) {
    return { screen: "closed" };
  }

  return { screen: "form" };
}

export async function createDsArchitectEnrollment(
  userId: string,
  input: DsArchitectEnrollInput,
): Promise<{ ok: true; enrollmentId: string } | { ok: false; message: string }> {
  const profile = await getProfileSummary(userId);
  if (!profile) {
    return { ok: false, message: "Complete your registration first." };
  }

  const cohort = await getDsArchitectCohort();
  if (
    !cohort ||
    (cohort.status !== "ENROLLING" && cohort.status !== "ACTIVE")
  ) {
    return { ok: false, message: "This cohort is not open for enrolment." };
  }

  const existing = await findDsArchitectEnrollment(userId);
  if (
    existing &&
    (existing.status === EnrollmentStatusV2.ACTIVE ||
      existing.status === EnrollmentStatusV2.COMPLETED)
  ) {
    return { ok: false, message: "You are already enrolled." };
  }

  await updateCandidateLinks(userId, {
    linkedinUrl: input.linkedinUrl,
    githubUsername: input.githubUsername,
    skills: input.skills,
  });

  const enrollmentId = await writeClient().$transaction(async (tx) => {
    const row = await createDsArchitectEnrollmentRow(tx, {
      userId,
      cohortId: cohort.id,
      githubRepoUrl: input.githubRepoUrl,
    });
    await tx.enrollmentProgress.upsert({
      where: { enrollmentId: row.id },
      create: {
        enrollmentId: row.id,
        cohortId: cohort.id,
        completedActivities: 0,
        totalActivities: DS_ARCHITECT_TOTAL_DAYS,
        percentCompleteBp: 0,
        pointsEarned: 0,
        pointsPossible: DS_ARCHITECT_MAX_MISSION_POINTS,
        currentStreak: 0,
        longestStreak: 0,
        unlockedThroughPosition: 0,
      },
      update: {},
    });
    return row.id;
  });

  return { ok: true, enrollmentId };
}
