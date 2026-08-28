import { cache } from "react";
import type { Domain } from "@prisma/client";
import { EnrollmentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

/** Shared select for dashboard + challenge day data + submissions */
export const sessionEnrollmentSelect = {
  id: true,
  userId: true,
  challengeId: true,
  domain: true,
  startedAt: true,
  daysCompleted: true,
  currentStreak: true,
  longestStreak: true,
  lastSubmittedDay: true,
  status: true,
  challenge: {
    select: {
      id: true,
      domain: true,
      title: true,
      totalDays: true,
      startsAt: true,
    },
  },
} as const;

/**
 * Resolves the enrollment shown on the dashboard.
 * - Optional `enrollmentId` must belong to the user; when present it is honoured
 *   at any status so track pages never silently fall back across domains.
 * - Default: oldest ACTIVE enrollment, then legacy profile-domain match, then any enrollment.
 *
 * Wrapped in React `cache()` so repeat calls within one render dedupe to a
 * single DB hit (defense-in-depth; the dashboard resolves once and threads it down).
 */
export const resolveDashboardEnrollment = cache(async function resolveDashboardEnrollment(
  userId: string,
  enrollmentId: string | undefined,
  profileDomain: Domain | null,
) {
  const trimmed = enrollmentId?.trim();
  if (trimmed) {
    // Caller named an enrollment (track pages pass the row for their own domain).
    // Honour it at ANY status — a COMPLETED or ABANDONED track must render its own
    // data, never silently fall back to a different domain.
    return prisma.enrollment.findFirst({
      where: { id: trimmed, userId },
      select: sessionEnrollmentSelect,
    });
  }

  let row = await prisma.enrollment.findFirst({
    where: { userId, status: EnrollmentStatus.ACTIVE },
    orderBy: { startedAt: "asc" },
    select: sessionEnrollmentSelect,
  });
  if (row) return row;

  if (profileDomain) {
    row = await prisma.enrollment.findFirst({
      where: { userId, domain: profileDomain },
      orderBy: { startedAt: "desc" },
      select: sessionEnrollmentSelect,
    });
    if (row) return row;
  }

  return prisma.enrollment.findFirst({
    where: { userId },
    orderBy: { startedAt: "desc" },
    select: sessionEnrollmentSelect,
  });
});

/**
 * Challenge / submission flows: allow ACTIVE or other non-ABANDONED statuses
 * so completed tracks still load when linked directly.
 */
export async function resolveChallengeEnrollment(
  userId: string,
  enrollmentId: string | undefined,
) {
  const trimmed = enrollmentId?.trim();
  if (trimmed) {
    const picked = await prisma.enrollment.findFirst({
      where: {
        id: trimmed,
        userId,
        status: { not: EnrollmentStatus.ABANDONED },
      },
      select: sessionEnrollmentSelect,
    });
    if (picked) return picked;
  }

  let row = await prisma.enrollment.findFirst({
    where: { userId, status: EnrollmentStatus.ACTIVE },
    orderBy: { startedAt: "asc" },
    select: sessionEnrollmentSelect,
  });
  if (row) return row;

  return prisma.enrollment.findFirst({
    where: { userId, status: { not: EnrollmentStatus.ABANDONED } },
    orderBy: { startedAt: "desc" },
    select: sessionEnrollmentSelect,
  });
}
