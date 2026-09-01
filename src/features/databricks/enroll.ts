import "server-only";
import { EnrollmentStatusV2 } from "@prisma/client";
import { writeClient } from "@/lib/db";
import {
  DATABRICKS_MAX_MISSION_POINTS,
  DATABRICKS_TOTAL_DAYS,
} from "@/features/databricks/constants";
import type { DatabricksEnrollInput } from "@/lib/validations/databricks";
import { getProfileSummary, updateCandidateLinks } from "@/repositories/candidate";
import {
  createDatabricksEnrollmentRow,
  findDatabricksEnrollment,
  getDatabricksCohort,
} from "@/repositories/databricks";

export type DatabricksEntryState =
  | { screen: "needs_profile" }
  | { screen: "closed" }
  | { screen: "form" }
  | { screen: "enrolled"; enrollmentId: string };

export async function getDatabricksEntryState(
  userId: string,
): Promise<DatabricksEntryState> {
  const existing = await findDatabricksEnrollment(userId);
  if (
    existing &&
    (existing.status === EnrollmentStatusV2.ACTIVE ||
      existing.status === EnrollmentStatusV2.COMPLETED)
  ) {
    return { screen: "enrolled", enrollmentId: existing.id };
  }

  const profile = await getProfileSummary(userId);
  if (!profile) return { screen: "needs_profile" };

  const cohort = await getDatabricksCohort();
  if (
    !cohort ||
    (cohort.status !== "ENROLLING" && cohort.status !== "ACTIVE")
  ) {
    return { screen: "closed" };
  }

  return { screen: "form" };
}

export async function createDatabricksEnrollment(
  userId: string,
  input: DatabricksEnrollInput,
): Promise<{ ok: true; enrollmentId: string } | { ok: false; message: string }> {
  const profile = await getProfileSummary(userId);
  if (!profile) {
    return { ok: false, message: "Complete your registration first." };
  }

  const cohort = await getDatabricksCohort();
  if (
    !cohort ||
    (cohort.status !== "ENROLLING" && cohort.status !== "ACTIVE")
  ) {
    return { ok: false, message: "This cohort is not open for enrolment." };
  }

  const existing = await findDatabricksEnrollment(userId);
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
    const row = await createDatabricksEnrollmentRow(tx, {
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
        totalActivities: DATABRICKS_TOTAL_DAYS,
        percentCompleteBp: 0,
        pointsEarned: 0,
        pointsPossible: DATABRICKS_MAX_MISSION_POINTS,
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
