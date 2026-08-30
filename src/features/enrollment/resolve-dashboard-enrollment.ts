import { cache } from "react";
import type { Domain } from "@prisma/client";
import {
  resolveChallengeSessionEnrollment,
  resolveSessionEnrollment,
  type SessionEnrollment,
} from "@/repositories/learning";

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

export type DashboardEnrollment = SessionEnrollment;

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
): Promise<SessionEnrollment | null> {
  return resolveSessionEnrollment(userId, enrollmentId, profileDomain);
});

/**
 * Challenge / submission flows: allow ACTIVE or other non-ABANDONED statuses
 * so completed tracks still load when linked directly.
 */
export async function resolveChallengeEnrollment(
  userId: string,
  enrollmentId: string | undefined,
): Promise<SessionEnrollment | null> {
  return resolveChallengeSessionEnrollment(userId, enrollmentId);
}
