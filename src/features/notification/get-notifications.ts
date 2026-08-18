import "server-only";
import { prisma } from "@/lib/db";
import { isProgramEnabled } from "@/lib/feature-flags";
import { deriveEventNotifications } from "./derive-event-notifications";
import type {
  AppNotification,
  NotificationCategoryKey,
  NotificationFeed,
} from "./types";

/**
 * Hard cap on how many items the bell ever shows. Older notifications drop off
 * the bottom automatically once newer ones arrive — this is why there is no
 * manual dismiss.
 */
const FEED_LIMIT = 5;

/**
 * Announcements also expire by age, not just by being pushed off the list.
 *
 * Without this, deleting or deactivating the two newest announcements would pull
 * whatever was sitting at positions 6 and 7 back into view — and because those
 * were never displayed, they would arrive UNREAD and re-light the badge with
 * stale news. The age cutoff means anything genuinely old stays gone no matter
 * what happens above it.
 *
 * Applies to admin announcements only. Derived event notifications carry their
 * own explicit windows (a hackathon registration notice may legitimately run
 * longer than this) and are filtered by those instead.
 */
const ANNOUNCEMENT_MAX_AGE_DAYS = 14;

/**
 * Builds one merged feed from two sources:
 *   - admin-authored `Notification` rows (audience-filtered), and
 *   - automated event notifications derived at read time.
 *
 * This is a pure read path: it never writes. Read state is joined in from
 * `NotificationRead` by string key, which is why derived items — with no row of
 * their own — can still be marked read.
 */
export async function getNotificationsForUser(
  userId: string,
): Promise<NotificationFeed> {
  const now = new Date();
  const programEnabled = isProgramEnabled();
  const announcementCutoff = new Date(
    now.getTime() - ANNOUNCEMENT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
  );

  const [
    adminRows,
    enrollingCohorts,
    readRows,
    challengeMembership,
    programMemberships,
    hackathonMembership,
    workshopRegistrations,
  ] = await Promise.all([
    prisma.notification.findMany({
      where: {
        isActive: true,
        publishedAt: { lte: now, gte: announcementCutoff },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: {
        id: true,
        title: true,
        body: true,
        href: true,
        category: true,
        audience: true,
        publishedAt: true,
      },
      orderBy: { publishedAt: "desc" },
      take: FEED_LIMIT,
    }),
    programEnabled
      ? prisma.programCohort.findMany({
          where: { status: "ENROLLING" },
          select: { id: true, name: true, startsAt: true },
        })
      : Promise.resolve([]),
    prisma.notificationRead.findMany({
      where: { userId },
      select: { notificationKey: true },
    }),
    prisma.enrollment.findFirst({ where: { userId }, select: { id: true } }),
    // Doubles as the PROGRAM audience check and the "already joined this cohort"
    // suppression list, so it stays one query.
    prisma.programMember.findMany({
      where: { userId },
      select: { cohortId: true },
    }),
    prisma.hackathonParticipant.findFirst({
      where: { userId },
      select: { id: true },
    }),
    prisma.workshopRegistration.findMany({
      where: { userId },
      select: { eventId: true },
    }),
  ]);

  const audiences = new Set<string>(["ALL"]);
  if (challengeMembership) audiences.add("CHALLENGE");
  if (programMemberships.length > 0) audiences.add("PROGRAM");
  if (hackathonMembership) audiences.add("HACKATHON");

  const readKeys = new Set(readRows.map((r) => r.notificationKey));

  const adminItems = adminRows
    .filter((row) => audiences.has(row.audience))
    .map((row) => ({
      key: `admin:${row.id}`,
      title: row.title,
      body: row.body,
      href: row.href,
      category: row.category as NotificationCategoryKey,
      publishedAt: row.publishedAt.toISOString(),
    }));

  const derivedItems = deriveEventNotifications({
    now,
    enrollingCohorts,
    programEnabled,
    registeredWorkshopEventIds: new Set(
      workshopRegistrations.map((r) => r.eventId),
    ),
    isHackathonRegistered: Boolean(hackathonMembership),
    joinedCohortIds: new Set(programMemberships.map((m) => m.cohortId)),
  });

  const items: AppNotification[] = [...adminItems, ...derivedItems]
    .map((item) => ({ ...item, isRead: readKeys.has(item.key) }))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, FEED_LIMIT);

  return {
    signedIn: true,
    items,
    unreadCount: items.filter((i) => !i.isRead).length,
  };
}
