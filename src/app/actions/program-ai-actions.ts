"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { reviewMission } from "@/features/program/mentor";
import {
  gradeProject,
  overrideProjectScore,
  listProjectsForAdmin,
} from "@/features/program/projects";
import { generateRecommendations } from "@/features/program/recommendations";
import { PROGRAM_AI_COHORT_BASE } from "@/features/program/constants";
import { resolveProgramMemberForUser } from "@/lib/program-auth";
import {
  generateRecommendationsSchema,
  gradeProjectSchema,
  mentorReviewSchema,
  overrideProjectScoreSchema,
} from "@/lib/validations/program";

type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; message: string };

async function requireProgramMemberId(): Promise<
  { ok: true; memberId: string } | { ok: false; message: string }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Please sign in to continue." };
  }

  const resolved = await resolveProgramMemberForUser(session.user.id);
  if (!resolved) return { ok: false, message: "Enrollment required." };
  return { ok: true, memberId: resolved.member.id };
}

export async function requestMentorReviewAction(
  input: unknown,
): Promise<ActionResult<{ feedback: string }>> {
  const authResult = await requireProgramMemberId();
  if (!authResult.ok) return authResult;

  const parsed = mentorReviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid day." };

  const result = await reviewMission(
    authResult.memberId,
    parsed.data.dayNumber,
  );
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/day/${parsed.data.dayNumber}`);
  return { ok: true, data: { feedback: result.feedback } };
}

export async function gradeProjectAction(
  input: unknown,
): Promise<ActionResult<{ score: number; feedback: string }>> {
  await requireAdmin();

  const parsed = gradeProjectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid project." };

  const result = await gradeProject(parsed.data.projectId);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/admin/program/projects");
  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/dashboard`);
  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/leaderboard`);
  return { ok: true, data: { score: result.score, feedback: result.feedback } };
}

export async function gradeAllUngradedAction(
  cohortId: string,
): Promise<ActionResult<{ graded: number; failed: number }>> {
  await requireAdmin();

  const parsed = generateRecommendationsSchema.safeParse({ cohortId });
  if (!parsed.success) return { ok: false, message: "Invalid cohort." };

  const { ungraded } = await listProjectsForAdmin(parsed.data.cohortId);
  let graded = 0;
  let failed = 0;

  for (const row of ungraded) {
    const result = await gradeProject(row.projectId);
    if (result.ok) graded += 1;
    else failed += 1;
  }

  revalidatePath("/admin/program/projects");
  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/dashboard`);
  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/leaderboard`);

  return { ok: true, data: { graded, failed } };
}

export async function overrideProjectScoreAction(
  input: unknown,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const parsed = overrideProjectScoreSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const result = await overrideProjectScore(
    admin.userId,
    parsed.data.projectId,
    parsed.data.score,
    parsed.data.reason,
  );
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/admin/program/projects");
  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/dashboard`);
  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/leaderboard`);
  return { ok: true };
}

export async function generateRecommendationsAction(
  input: unknown,
): Promise<
  ActionResult<{ generated: number; skipped: number; failed: number }>
> {
  await requireAdmin();

  const parsed = generateRecommendationsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid cohort." };

  const result = await generateRecommendations(parsed.data.cohortId);

  revalidatePath(`${PROGRAM_AI_COHORT_BASE}/dashboard`);
  revalidatePath("/admin/program/projects");

  return { ok: true, data: result };
}
