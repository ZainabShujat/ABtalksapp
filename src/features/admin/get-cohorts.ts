/**
 * Plan 156 — admin cohort enrollment reads.
 *
 * Answers "how many candidates are in which cohort, and when did they join".
 *
 * JOIN DATE WARNING: the join date is `ProgramEnrollment.joinedAt`, never
 * `createdAt`. `createdAt` is the plan-078 backfill timestamp — in production
 * all 3,340 `pe_enr_*` rows carry the same 2026-08-24 value, while `joinedAt`
 * spans 2026-04-30 → 2026-09-12. Anything that reports `createdAt` as a join
 * date is reporting the migration, not the candidate.
 */
import type { EnrollmentStatusV2 } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDateIST } from "@/lib/date-utils";
import { listCandidateProfiles } from "@/repositories/candidate";

export const COHORT_STATUSES = [
  "APPLIED",
  "WAITLISTED",
  "ACTIVE",
  "COMPLETED",
  "DROPPED",
  "REMOVED",
] as const;

export type CohortEnrollmentStatus = (typeof COHORT_STATUSES)[number];

export type CohortStatusCounts = Record<CohortEnrollmentStatus, number>;

/** Default roster page size. Larger cohorts are truncated and say so. */
const ROSTER_LIMIT = 200;

/**
 * Names live in CandidateProfile, not User, so a name search cannot run in SQL
 * against ProgramEnrollment. When searching we pull a wider window and filter
 * after the identity overlay. The widest production cohort is 2,836 rows.
 */
const SEARCH_SCAN_CAP = 3_000;

export function emptyStatusCounts(): CohortStatusCounts {
  return {
    APPLIED: 0,
    WAITLISTED: 0,
    ACTIVE: 0,
    COMPLETED: 0,
    DROPPED: 0,
    REMOVED: 0,
  };
}

export function foldStatusCounts(
  rows: { status: EnrollmentStatusV2; count: number }[],
): CohortStatusCounts {
  const counts = emptyStatusCounts();
  for (const row of rows) {
    counts[row.status as CohortEnrollmentStatus] += row.count;
  }
  return counts;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-05" -> "May 2026". Returns the key unchanged if it is not a month key. */
export function monthLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return key;
  return `${MONTH_NAMES[month - 1]} ${match[1]}`;
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

const cohortSelect = {
  id: true,
  slug: true,
  name: true,
  status: true,
  startMode: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
  capacity: true,
  programVersion: {
    select: {
      versionNumber: true,
      program: { select: { slug: true, title: true, format: true } },
    },
  },
} as const;

export type CohortIndexRow = {
  id: string;
  slug: string;
  name: string;
  programSlug: string;
  programTitle: string;
  programFormat: string;
  status: string;
  startMode: string;
  timezone: string;
  startsAtLabel: string | null;
  capacity: number | null;
  total: number;
  byStatus: CohortStatusCounts;
  joinedLast7: number;
  joinedLast30: number;
  firstJoinedLabel: string | null;
  lastJoinedLabel: string | null;
};

export type CohortIndex = {
  rows: CohortIndexRow[];
  totals: {
    cohorts: number;
    enrollments: number;
    active: number;
    joinedLast30: number;
  };
};

/**
 * Cohort index. Four queries total, independent of how many cohorts exist —
 * never one query per cohort.
 */
export async function getCohortIndex(): Promise<CohortIndex> {
  const [cohorts, statusGroups, spanGroups, last7Groups, last30Groups] =
    await Promise.all([
      prisma.cohort.findMany({
        select: cohortSelect,
        orderBy: { createdAt: "asc" },
      }),
      prisma.programEnrollment.groupBy({
        by: ["cohortId", "status"],
        _count: { _all: true },
      }),
      prisma.programEnrollment.groupBy({
        by: ["cohortId"],
        _min: { joinedAt: true },
        _max: { joinedAt: true },
      }),
      prisma.programEnrollment.groupBy({
        by: ["cohortId"],
        where: { joinedAt: { gte: daysAgo(7) } },
        _count: { _all: true },
      }),
      prisma.programEnrollment.groupBy({
        by: ["cohortId"],
        where: { joinedAt: { gte: daysAgo(30) } },
        _count: { _all: true },
      }),
    ]);

  const statusByCohort = new Map<
    string,
    { status: EnrollmentStatusV2; count: number }[]
  >();
  for (const group of statusGroups) {
    const list = statusByCohort.get(group.cohortId) ?? [];
    list.push({ status: group.status, count: group._count._all });
    statusByCohort.set(group.cohortId, list);
  }

  const spanByCohort = new Map(
    spanGroups.map((g) => [
      g.cohortId,
      { min: g._min.joinedAt, max: g._max.joinedAt },
    ]),
  );
  const last7ByCohort = new Map(
    last7Groups.map((g) => [g.cohortId, g._count._all]),
  );
  const last30ByCohort = new Map(
    last30Groups.map((g) => [g.cohortId, g._count._all]),
  );

  const rows: CohortIndexRow[] = cohorts.map((cohort) => {
    const byStatus = foldStatusCounts(statusByCohort.get(cohort.id) ?? []);
    const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
    const span = spanByCohort.get(cohort.id);
    return {
      id: cohort.id,
      slug: cohort.slug,
      name: cohort.name,
      programSlug: cohort.programVersion.program.slug,
      programTitle: cohort.programVersion.program.title,
      programFormat: cohort.programVersion.program.format,
      status: cohort.status,
      startMode: cohort.startMode,
      timezone: cohort.timezone,
      startsAtLabel: cohort.startsAt ? formatDateIST(cohort.startsAt) : null,
      capacity: cohort.capacity,
      total,
      byStatus,
      joinedLast7: last7ByCohort.get(cohort.id) ?? 0,
      joinedLast30: last30ByCohort.get(cohort.id) ?? 0,
      firstJoinedLabel: span?.min ? formatDateIST(span.min) : null,
      lastJoinedLabel: span?.max ? formatDateIST(span.max) : null,
    };
  });

  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  return {
    rows,
    totals: {
      cohorts: rows.length,
      enrollments: rows.reduce((sum, r) => sum + r.total, 0),
      active: rows.reduce((sum, r) => sum + r.byStatus.ACTIVE, 0),
      joinedLast30: rows.reduce((sum, r) => sum + r.joinedLast30, 0),
    },
  };
}

export type CohortRosterRow = {
  enrollmentId: string;
  userId: string;
  fullName: string;
  email: string;
  status: string;
  joinedAtLabel: string;
  joinedAtIso: string;
  completedActivities: number;
  totalActivities: number;
  currentStreak: number;
  githubRepoUrl: string | null;
};

export type CohortMonthlyBucket = {
  key: string;
  label: string;
  count: number;
};

export type CohortDetail = {
  cohort: {
    id: string;
    slug: string;
    name: string;
    programTitle: string;
    programFormat: string;
    status: string;
    startMode: string;
    timezone: string;
    startsAtLabel: string | null;
    endsAtLabel: string | null;
    capacity: number | null;
  };
  statusCounts: CohortStatusCounts;
  total: number;
  monthly: CohortMonthlyBucket[];
  rows: CohortRosterRow[];
  truncated: boolean;
};

export async function getCohortDetail(input: {
  cohortId: string;
  search?: string;
  status?: CohortEnrollmentStatus | "ALL";
  limit?: number;
}): Promise<CohortDetail | null> {
  const limit = input.limit ?? ROSTER_LIMIT;
  const search = input.search?.trim().toLowerCase();
  const statusFilter =
    input.status && input.status !== "ALL"
      ? (input.status as EnrollmentStatusV2)
      : undefined;

  const cohort = await prisma.cohort.findUnique({
    where: { id: input.cohortId },
    select: cohortSelect,
  });
  if (!cohort) return null;

  // A name search cannot be pushed into SQL (names live in CandidateProfile),
  // so widen the scan and filter after the overlay. The window never shrinks
  // below the caller's limit, or a searched CSV export would silently stop
  // short once a cohort outgrows SEARCH_SCAN_CAP.
  const take = search ? Math.max(SEARCH_SCAN_CAP, limit) : limit + 1;

  const [statusGroups, monthRows, enrollments] = await Promise.all([
    prisma.programEnrollment.groupBy({
      by: ["status"],
      where: { cohortId: cohort.id },
      _count: { _all: true },
    }),
    // Bucket in IST, not UTC. `joinedAt` is `timestamp without time zone`
    // holding UTC, and every row's date is rendered with formatDateIST — a
    // UTC truncation puts 21 production rows in a month their own row does
    // not show.
    prisma.$queryRaw<{ key: string; count: bigint }[]>`
      SELECT to_char(
               date_trunc('month', "joinedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'),
               'YYYY-MM'
             ) AS key,
             count(*) AS count
        FROM "ProgramEnrollment"
       WHERE "cohortId" = ${cohort.id}
       GROUP BY 1
       ORDER BY 1 ASC
    `,
    prisma.programEnrollment.findMany({
      where: {
        cohortId: cohort.id,
        ...(statusFilter ? { status: statusFilter } : {}),
        user: { deletedAt: null },
      },
      orderBy: { joinedAt: "desc" },
      take,
      select: {
        id: true,
        userId: true,
        status: true,
        joinedAt: true,
        githubRepoUrl: true,
        trackCurrentStreak: true,
        progress: {
          select: {
            completedActivities: true,
            totalActivities: true,
            currentStreak: true,
          },
        },
        user: { select: { email: true } },
      },
    }),
  ]);

  const identities = await listCandidateProfiles(
    enrollments.map((row) => row.userId),
  );

  let rows: CohortRosterRow[] = enrollments.map((row) => {
    const identity = identities.get(row.userId);
    return {
      enrollmentId: row.id,
      userId: row.userId,
      fullName: identity?.fullName?.trim() || row.user.email || "Unknown",
      email: row.user.email,
      status: row.status,
      joinedAtLabel: formatDateIST(row.joinedAt),
      joinedAtIso: row.joinedAt.toISOString(),
      completedActivities: row.progress?.completedActivities ?? 0,
      totalActivities: row.progress?.totalActivities ?? 0,
      currentStreak: row.progress?.currentStreak ?? row.trackCurrentStreak,
      githubRepoUrl: row.githubRepoUrl,
    };
  });

  if (search) {
    rows = rows.filter(
      (row) =>
        row.fullName.toLowerCase().includes(search) ||
        row.email.toLowerCase().includes(search),
    );
  }

  const truncated = rows.length > limit;
  if (truncated) rows = rows.slice(0, limit);

  const statusCounts = foldStatusCounts(
    statusGroups.map((g) => ({ status: g.status, count: g._count._all })),
  );

  const monthly = monthRows.slice(-12).map((row) => ({
    key: row.key,
    label: monthLabel(row.key),
    count: Number(row.count),
  }));

  return {
    cohort: {
      id: cohort.id,
      slug: cohort.slug,
      name: cohort.name,
      programTitle: cohort.programVersion.program.title,
      programFormat: cohort.programVersion.program.format,
      status: cohort.status,
      startMode: cohort.startMode,
      timezone: cohort.timezone,
      startsAtLabel: cohort.startsAt ? formatDateIST(cohort.startsAt) : null,
      endsAtLabel: cohort.endsAt ? formatDateIST(cohort.endsAt) : null,
      capacity: cohort.capacity,
    },
    statusCounts,
    total: Object.values(statusCounts).reduce((sum, n) => sum + n, 0),
    monthly,
    rows,
    truncated,
  };
}
