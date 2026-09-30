import "server-only";
import { prisma } from "@/lib/db";
import { VIDEOTHON } from "@/features/hackathon-video/config";

export type MyVideoRegistration = {
  id: string;
  fullName: string;
  email: string;
  phoneDisplay: string;
  city: string;
  employment: "LEARNER" | "WORKING";
  currentCtc: string | null;
  portfolioUrl: string;
  submission: {
    url: string;
    notes: string | null;
    updatedAtIso: string;
  } | null;
  createdAtIso: string;
};

/**
 * The one row per user per VideoThon event. Returns null if the visitor
 * has not registered for the current event yet — the landing uses that
 * signal to auto-open the registration dialog.
 */
export async function getMyVideoRegistration(
  userId: string,
): Promise<MyVideoRegistration | null> {
  const row = await prisma.hackathonVideoRegistration.findUnique({
    where: {
      eventId_userId: { eventId: VIDEOTHON.eventId, userId },
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      phoneCountryCode: true,
      phoneNumber: true,
      city: true,
      employment: true,
      currentCtc: true,
      portfolioUrl: true,
      submissionUrl: true,
      submissionNotes: true,
      submissionUpdatedAt: true,
      createdAt: true,
    },
  });

  if (!row) return null;

  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phoneDisplay: `${row.phoneCountryCode} ${row.phoneNumber}`,
    city: row.city,
    employment: row.employment,
    currentCtc: row.currentCtc,
    portfolioUrl: row.portfolioUrl,
    submission:
      row.submissionUrl && row.submissionUpdatedAt
        ? {
            url: row.submissionUrl,
            notes: row.submissionNotes,
            updatedAtIso: row.submissionUpdatedAt.toISOString(),
          }
        : null,
    createdAtIso: row.createdAt.toISOString(),
  };
}
