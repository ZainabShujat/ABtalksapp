import "server-only";

import { prisma } from "@/lib/db";
import { studentProfile } from "@/repositories/legacy/student-profile";

/**
 * Earliest registration date per user across StudentProfile, HackathonParticipant
 * and WorkshopRegistration, for anyone whose first touch in ANY of those falls
 * at/after `since`. One entry per person — someone who did a workshop and later
 * joined a challenge appears once, at the earlier date.
 *
 * Two passes on purpose: the first finds who was active in the window, the
 * second reads their dates unbounded, so a user whose real first registration
 * predates `since` is correctly excluded by the caller's window filter.
 */
export async function getRegistrationDatesSince(since: Date): Promise<Date[]> {
  const [profileHits, participantHits, workshopHits] = await Promise.all([
    studentProfile.findMany({
      where: { createdAt: { gte: since } },
      select: { userId: true },
    }),
    prisma.hackathonParticipant.findMany({
      where: { createdAt: { gte: since } },
      select: { userId: true },
    }),
    prisma.workshopRegistration.findMany({
      where: { createdAt: { gte: since } },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);

  const candidates = new Set<string>();
  for (const r of [...profileHits, ...participantHits, ...workshopHits]) {
    candidates.add(r.userId);
  }
  if (candidates.size === 0) return [];

  const userIds = [...candidates];

  const [profiles, participants, workshops] = await Promise.all([
    studentProfile.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, createdAt: true },
    }),
    prisma.hackathonParticipant.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, createdAt: true },
    }),
    // A person can hold many workshop rows — only their first one matters here.
    prisma.workshopRegistration.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds } },
      _min: { createdAt: true },
    }),
  ]);

  const earliestByUser = new Map<string, Date>();

  const note = (userId: string, date: Date | null | undefined) => {
    if (!date) return;
    const prev = earliestByUser.get(userId);
    if (!prev || date < prev) {
      earliestByUser.set(userId, date);
    }
  };

  for (const row of profiles) note(row.userId, row.createdAt);
  for (const row of participants) note(row.userId, row.createdAt);
  for (const row of workshops) note(row.userId, row._min.createdAt);

  return [...earliestByUser.values()];
}

/**
 * Count of distinct people who have registered for anything (all time) —
 * challenge students, hackathon participants, and workshop attendees.
 * Counted per person: attending three workshops still counts once.
 */
export async function countRegisteredUsers(): Promise<number> {
  return prisma.user.count({
    where: {
      OR: [
        { studentProfile: { isNot: null } },
        { hackathonParticipant: { isNot: null } },
        { workshopRegistrations: { some: {} } },
      ],
    },
  });
}
