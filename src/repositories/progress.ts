import "server-only";
import { prisma } from "@/lib/db";
import { isNewProgressRepoEnabled } from "@/lib/feature-flags";
import {
  challengeSlugForDomain,
  findActiveMembership,
  listChallengeEnrollments,
} from "@/repositories/learning";
import type { EnrolledProgramCard } from "@/repositories/types";

export async function getDashboardPrograms(
  userId: string,
): Promise<EnrolledProgramCard[]> {
  if (isNewProgressRepoEnabled()) {
    const rows = await prisma.programEnrollment.findMany({
      where: { userId, status: { in: ["ACTIVE", "COMPLETED"] } },
      orderBy: [{ status: "asc" }, { enrolledAt: "desc" }],
      select: {
        id: true,
        status: true,
        progress: {
          select: {
            percentCompleteBp: true,
            pointsEarned: true,
            currentStreak: true,
            currentActivityId: true,
            nextActivityId: true,
          },
        },
        cohort: {
          select: {
            name: true,
            endsAt: true,
            programVersion: {
              select: {
                program: {
                  select: { slug: true, title: true, cardImageUrl: true },
                },
              },
            },
          },
        },
      },
    });

    const activityIds = rows.flatMap((r) =>
      [r.progress?.currentActivityId, r.progress?.nextActivityId].filter(
        (id): id is string => Boolean(id),
      ),
    );
    const activities =
      activityIds.length === 0
        ? []
        : await prisma.activity.findMany({
            where: { id: { in: activityIds } },
            select: { id: true, title: true, dayNumber: true },
          });
    const byId = new Map(activities.map((a) => [a.id, a]));

    return rows.map((r) => {
      const next = r.progress?.nextActivityId
        ? byId.get(r.progress.nextActivityId)
        : undefined;
      const status =
        r.status === "COMPLETED"
          ? "COMPLETED"
          : r.status === "DROPPED"
            ? "DROPPED"
            : "ACTIVE";
      return {
        enrollmentId: r.id,
        programSlug: r.cohort.programVersion.program.slug,
        programTitle: r.cohort.programVersion.program.title,
        cardImageUrl: r.cohort.programVersion.program.cardImageUrl,
        cohortName: r.cohort.name,
        status,
        percentComplete: Math.round((r.progress?.percentCompleteBp ?? 0) / 100),
        pointsEarned: r.progress?.pointsEarned ?? 0,
        currentStreak: r.progress?.currentStreak ?? 0,
        nextActivity: next
          ? { id: next.id, title: next.title, dayNumber: next.dayNumber }
          : null,
        dueAt: r.cohort.endsAt,
      };
    });
  }

  const enrollments = await listChallengeEnrollments(userId);
  const cards: EnrolledProgramCard[] = enrollments
    .filter((e) => e.status === "ACTIVE" || e.status === "COMPLETED")
    .map((e) => ({
      enrollmentId: e.id,
      programSlug: challengeSlugForDomain(e.domain),
      programTitle: e.challengeTitle,
      cardImageUrl: null,
      cohortName: e.challengeTitle,
      status: e.status === "COMPLETED" ? "COMPLETED" : "ACTIVE",
      percentComplete:
        e.totalDays > 0
          ? Math.min(100, Math.round((e.daysCompleted / e.totalDays) * 100))
          : 0,
      pointsEarned: e.daysCompleted * 10,
      currentStreak: e.currentStreak,
      nextActivity: null,
      dueAt: null,
    }));

  const membership = await findActiveMembership(userId);
  if (membership) {
    cards.push({
      enrollmentId: membership.member.id,
      programSlug: "ai-cohort-program",
      programTitle: "AI Cohort Program",
      cardImageUrl: null,
      cohortName: membership.cohort.name,
      status: membership.member.status === "COMPLETED" ? "COMPLETED" : "ACTIVE",
      percentComplete: Math.min(
        100,
        Math.round((membership.member.highestUnlockedDay / 31) * 100),
      ),
      pointsEarned: 0,
      currentStreak: 0,
      nextActivity: null,
      dueAt: membership.cohort.endsAt,
    });
  }

  return cards;
}
