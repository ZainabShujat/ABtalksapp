import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { VIDEOTHON } from "@/features/hackathon-video/config";

export type AdminVideoRegistration = {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  phone: string;
  city: string;
  employment: "LEARNER" | "WORKING";
  currentCtc: string | null;
  portfolioUrl: string;
  sourceSlug: string | null;
  submissionUrl: string | null;
  submissionNotes: string | null;
  submissionUpdatedAtIso: string | null;
  createdAtIso: string;
  /** When the ABTalks account itself was created. */
  accountCreatedAtIso: string;
  /** True when the account was created for VideoThon (see NEW_USER_WINDOW_MS). */
  isNewUser: boolean;
};

export type AdminVideoRegistrationsData = {
  total: number;
  learnerCount: number;
  workingCount: number;
  submittedCount: number;
  newUserCount: number;
  existingUserCount: number;
  rows: AdminVideoRegistration[];
};

export type VideoRegistrationUserType = "all" | "old" | "new";

/**
 * A registrant counts as NEW when their ABTalks account was created at most
 * this long before they registered for VideoThon — i.e. they signed up in
 * order to join. There is no last-login column, so account age at
 * registration time is the signal. Anyone whose account is older is OLD.
 */
const NEW_USER_WINDOW_MS = 24 * 60 * 60 * 1000;

function isNewUser(accountCreatedAt: Date, registeredAt: Date): boolean {
  return registeredAt.getTime() - accountCreatedAt.getTime() <= NEW_USER_WINDOW_MS;
}

/** Normalises the `?cohort=` search param (same param as the code-hackathon page). */
export function parseVideoRegistrationUserType(raw: unknown): VideoRegistrationUserType {
  return raw === "old" || raw === "new" ? raw : "all";
}

const querySchema = z.string().trim().max(120).optional();

/** Normalises the `?q=` search param; invalid or empty input means no filter. */
export function parseVideoRegistrationQuery(raw: unknown): string | undefined {
  const parsed = querySchema.safeParse(raw);
  return parsed.success && parsed.data ? parsed.data : undefined;
}

/**
 * Every VideoThon registration for the current event, newest first. Stats
 * are computed over the whole event; `rows` honours the optional search.
 */
export async function getAdminVideoRegistrations({
  q,
  userType = "all",
}: {
  q?: string;
  userType?: VideoRegistrationUserType;
}): Promise<AdminVideoRegistrationsData> {
  const eventWhere = { eventId: VIDEOTHON.eventId };
  const rowsWhere = q
    ? {
        ...eventWhere,
        OR: [
          { fullName: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { city: { contains: q, mode: "insensitive" as const } },
          { phoneNumber: { contains: q } },
        ],
      }
    : eventWhere;

  const [rows, total, working, submitted, accountAges] = await Promise.all([
    prisma.hackathonVideoRegistration.findMany({
      where: rowsWhere,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userId: true,
        fullName: true,
        email: true,
        phoneCountryCode: true,
        phoneNumber: true,
        city: true,
        employment: true,
        currentCtc: true,
        portfolioUrl: true,
        sourceSlug: true,
        submissionUrl: true,
        submissionNotes: true,
        submissionUpdatedAt: true,
        createdAt: true,
        user: { select: { createdAt: true } },
      },
    }),
    prisma.hackathonVideoRegistration.count({ where: eventWhere }),
    prisma.hackathonVideoRegistration.count({
      where: { ...eventWhere, employment: "WORKING" },
    }),
    prisma.hackathonVideoRegistration.count({
      where: { ...eventWhere, submissionUrl: { not: null } },
    }),
    // New vs old compares two columns across tables, which Prisma cannot
    // express in `where` — so the split is computed here over the event.
    prisma.hackathonVideoRegistration.findMany({
      where: eventWhere,
      select: { createdAt: true, user: { select: { createdAt: true } } },
    }),
  ]);

  const newUserCount = accountAges.filter((r) =>
    isNewUser(r.user.createdAt, r.createdAt),
  ).length;

  const mapped = rows.map((r) => {
    const rowIsNew = isNewUser(r.user.createdAt, r.createdAt);
    return { r, rowIsNew };
  });
  const visible =
    userType === "all"
      ? mapped
      : mapped.filter(({ rowIsNew }) => (userType === "new" ? rowIsNew : !rowIsNew));

  return {
    total,
    learnerCount: total - working,
    workingCount: working,
    submittedCount: submitted,
    newUserCount,
    existingUserCount: total - newUserCount,
    rows: visible.map(({ r, rowIsNew }) => ({
      id: r.id,
      userId: r.userId,
      fullName: r.fullName,
      email: r.email,
      phone: `${r.phoneCountryCode} ${r.phoneNumber}`,
      city: r.city,
      employment: r.employment,
      currentCtc: r.currentCtc,
      portfolioUrl: r.portfolioUrl,
      sourceSlug: r.sourceSlug,
      submissionUrl: r.submissionUrl,
      submissionNotes: r.submissionNotes,
      submissionUpdatedAtIso: r.submissionUpdatedAt?.toISOString() ?? null,
      createdAtIso: r.createdAt.toISOString(),
      accountCreatedAtIso: r.user.createdAt.toISOString(),
      isNewUser: rowIsNew,
    })),
  };
}
