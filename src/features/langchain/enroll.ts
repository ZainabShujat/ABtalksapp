import "server-only";
import { EnrollmentStatusV2 } from "@prisma/client";
import { writeClient } from "@/lib/db";
import {
  LANGCHAIN_MAX_MISSION_POINTS,
  LANGCHAIN_TOTAL_DAYS,
} from "@/features/langchain/constants";
import type { LangchainEnrollInput } from "@/lib/validations/langchain";
import { getProfileSummary, updateCandidateLinks } from "@/repositories/candidate";
import {
  createLangchainEnrollmentRow,
  findLangchainEnrollment,
  getLangchainCohort,
} from "@/repositories/langchain";

export type LangchainEntryState =
  | { screen: "needs_profile" }
  | { screen: "closed" }
  | { screen: "form" }
  | { screen: "enrolled"; enrollmentId: string };

export async function getLangchainEntryState(
  userId: string,
): Promise<LangchainEntryState> {
  const existing = await findLangchainEnrollment(userId);
  if (
    existing &&
    (existing.status === EnrollmentStatusV2.ACTIVE ||
      existing.status === EnrollmentStatusV2.COMPLETED)
  ) {
    return { screen: "enrolled", enrollmentId: existing.id };
  }

  const profile = await getProfileSummary(userId);
  if (!profile) return { screen: "needs_profile" };

  const cohort = await getLangchainCohort();
  if (
    !cohort ||
    (cohort.status !== "ENROLLING" && cohort.status !== "ACTIVE")
  ) {
    return { screen: "closed" };
  }

  return { screen: "form" };
}

export async function createLangchainEnrollment(
  userId: string,
  input: LangchainEnrollInput,
): Promise<{ ok: true; enrollmentId: string } | { ok: false; message: string }> {
  const profile = await getProfileSummary(userId);
  if (!profile) {
    return { ok: false, message: "Complete your registration first." };
  }

  const cohort = await getLangchainCohort();
  if (
    !cohort ||
    (cohort.status !== "ENROLLING" && cohort.status !== "ACTIVE")
  ) {
    return { ok: false, message: "This cohort is not open for enrolment." };
  }

  const existing = await findLangchainEnrollment(userId);
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
    const row = await createLangchainEnrollmentRow(tx, {
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
        totalActivities: LANGCHAIN_TOTAL_DAYS,
        percentCompleteBp: 0,
        pointsEarned: 0,
        pointsPossible: LANGCHAIN_MAX_MISSION_POINTS,
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
