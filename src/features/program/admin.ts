import "server-only";
import type {
  Prisma,
  ProgramCohortStatus,
  ProgramMemberStatus,
} from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { prisma, writeClient } from "@/lib/db";
import { formatDateTimeIST } from "@/lib/date-utils";
import { PROGRAM_TOTAL_DAYS, PROGRAM_TZ } from "@/features/program/constants";
import { bootstrapMemberStartDay } from "@/features/program/bootstrap-start-day";
import { getAtRiskMembers, getMemberAtRiskStatus } from "@/features/program/commits";
import {
  collectPassSkipSets,
  getBehindByDays,
  getMemberCalendarDay,
  getMemberProgressDay,
} from "@/features/program/progression";
import { askClaudeJson } from "@/lib/anthropic";
import {
  getInterviewSignal,
  getInterviewSignals,
} from "@/features/interview/read-model";
import { generateProgramJoinCode } from "@/lib/program-auth";
import {
  applyProgramMembershipChange,
  applyProgramRecommendationChange,
  applyProgramUnlockChange,
  compareProgramScoreRows,
  countCanonicalMembersByStatus,
  countEnrolledProgramMembers,
  findAiCohortMembershipByMemberId,
  listAiCohortMemberships,
  listCanonicalProgramMemberIds,
} from "@/repositories/program-state";
import {
  cohortSlugForProgramCohort,
  memberIdFromPe,
  peIdForMember,
} from "@/repositories/ids";
import { logger } from "@/lib/logger";
import { listCanonicalMissionAttempts } from "@/repositories/progress";

export type CohortOverview = {
  cohort: {
    id: string;
    name: string;
    joinCode: string;
    requiresJoinCode: boolean;
    status: ProgramCohortStatus;
    startsAt: string;
    endsAt: string;
    /** Null = unlimited. Read from the canonical Cohort, the row that is enforced. */
    capacity: number | null;
    resultsPublishedAt: string | null;
    enrolled: number;
    waitlisted: number;
    dropped: number;
  };
  scoreBuckets: { bucket: string; count: number }[];
  moduleProgress: { moduleNumber: number; title: string; avgPct: number }[];
  dailyEngagement: { day: number; missionRuns: number; commitDays: number }[];
  missionFunnel: {
    dayNumber: number;
    passRate: number;
    avgRuns: number;
  }[];
  experienceMix: { band: string; count: number }[];
  atRisk: {
    memberId: string;
    fullName: string;
    reasons: string[];
    behindBy: number;
  }[];
};

export type AdminMemberRow = {
  id: string;
  fullName: string;
  company: string | null;
  jobRole: string | null;
  status: ProgramMemberStatus;
  totalScore: number;
  highestUnlockedDay: number;
  behindBy: number;
  entryTotalScore: number | null;
  interviewStatus: string | null;
  interviewOverall: number | null;
};

function experienceBand(years: number | null): string {
  if (years == null) return "—";
  if (years <= 2) return "0–2 yrs";
  if (years <= 5) return "3–5 yrs";
  if (years <= 10) return "6–10 yrs";
  return "10+ yrs";
}

const cohortAdminSelect = {
  id: true,
  name: true,
  joinCode: true,
  requiresJoinCode: true,
  status: true,
  startsAt: true,
  endsAt: true,
  capacity: true,
  resultsPublishedAt: true,
  createdAt: true,
} as const;

export type AdminCohortListItem = {
  id: string;
  name: string;
  joinCode: string;
  requiresJoinCode: boolean;
  status: ProgramCohortStatus;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  resultsPublishedAt: Date | null;
  createdAt: Date;
};

/** Newest non-archived cohort (fallback when no cohortId in URL). */
export async function getAdminProgramCohort() {
  return prisma.programCohort.findFirst({
    where: { status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" },
    select: cohortAdminSelect,
  });
}

export async function listAdminCohorts(): Promise<AdminCohortListItem[]> {
  const rows = await prisma.programCohort.findMany({
    orderBy: { createdAt: "desc" },
    select: cohortAdminSelect,
  });
  return [
    ...rows.filter((c) => c.status !== "ARCHIVED"),
    ...rows.filter((c) => c.status === "ARCHIVED"),
  ];
}

/** Resolve cohort by id, else newest non-archived. */
export async function resolveAdminProgramCohort(cohortId?: string | null) {
  if (cohortId) {
    const byId = await prisma.programCohort.findUnique({
      where: { id: cohortId },
      select: cohortAdminSelect,
    });
    if (byId) return byId;
  }
  return getAdminProgramCohort();
}

async function allocateUniqueJoinCode(
  tx: Prisma.TransactionClient,
): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const joinCode = generateProgramJoinCode();
    const clash = await tx.programCohort.findUnique({
      where: { joinCode },
      select: { id: true },
    });
    if (!clash) return joinCode;
  }
  throw new Error("Could not generate a unique join code.");
}

/**
 * Placeholder end date for `ProgramCohort`, whose `endsAt` is non-nullable in
 * the schema. Nothing gates on it any more (plan 157) — the canonical `Cohort`
 * row members read carries a real null.
 */
const ROLLING_COHORT_FAR_END = new Date("2099-12-31T00:00:00.000Z");

/**
 * Same idea for `ProgramCohort.capacity`, a non-nullable Int that cannot say
 * "unlimited". Nothing enforces it — `enrollOrWaitlist` and `promoteWaitlisted`
 * both read the canonical `Cohort.capacity`, where null means unlimited.
 */
const UNLIMITED_CAPACITY_PLACEHOLDER = 1_000_000;

/**
 * Mirror an admin cohort edit onto the canonical `Cohort` row (plan 157).
 *
 * Admin writes used to land on `ProgramCohort` alone, which no member-facing
 * read ever touches — every learner path reads `Cohort` through
 * `getCohortByJoinCode` / `getOpenEnrollmentCohort` / `findActiveMembership`.
 * So the cohort dates and status could not be corrected from /admin/program at
 * all. Anything the admin changes must reach both rows.
 *
 * The canonical row is absent only for a `ProgramCohort` created after the 078
 * migration, which has no `programVersionId` to attach to; we log and skip
 * rather than invent one.
 */
async function mirrorToCanonicalCohort(
  tx: Prisma.TransactionClient,
  programCohortId: string,
  data: Prisma.CohortUpdateInput,
): Promise<void> {
  const slug = cohortSlugForProgramCohort(programCohortId);
  const existing = await tx.cohort.findUnique({
    where: { slug },
    select: { slug: true },
  });
  if (!existing) {
    logger.warn("[program] no canonical Cohort to mirror to", {
      programCohortId,
      slug,
    });
    return;
  }
  await tx.cohort.update({ where: { slug }, data });
}

export async function createOrUpdateCohort(
  adminId: string,
  data: {
    cohortId?: string;
    name: string;
    /** Both optional: a rolling cohort has no shared start or end (plan 157). */
    startsAt: Date | null;
    endsAt: Date | null;
    /** Null = unlimited. The canonical Cohort row carries the null (plan 157). */
    capacity: number | null;
    requiresJoinCode: boolean;
  },
): Promise<{ ok: true; cohortId: string } | { ok: false; message: string }> {
  if (data.startsAt && data.endsAt && data.startsAt >= data.endsAt) {
    return { ok: false, message: "Start date must be before end date." };
  }

  try {
    const cohortId = await prisma.$transaction(async (tx) => {
      if (data.cohortId) {
        const existing = await tx.programCohort.findUnique({
          where: { id: data.cohortId },
          select: { id: true },
        });
        if (!existing) throw new Error("Cohort not found.");
        await tx.programCohort.update({
          where: { id: data.cohortId },
          data: {
            name: data.name,
            // ProgramCohort.startsAt/.endsAt are non-nullable in the schema, so
            // a blank date keeps whatever is stored there. The canonical row
            // below is the one members read, and it takes the null.
            ...(data.startsAt ? { startsAt: data.startsAt } : {}),
            ...(data.endsAt ? { endsAt: data.endsAt } : {}),
            capacity: data.capacity ?? UNLIMITED_CAPACITY_PLACEHOLDER,
            requiresJoinCode: data.requiresJoinCode,
          },
        });
        await mirrorToCanonicalCohort(tx, data.cohortId, {
          name: data.name,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          capacity: data.capacity,
          requiresJoinCode: data.requiresJoinCode,
          startMode: "ROLLING",
        });
        await tx.adminAction.create({
          data: {
            adminUserId: adminId,
            actorUserId: adminId,
            targetUserId: adminId,
            actionType: "PROGRAM_UPDATE_COHORT",
            metadata: {
              cohortId: data.cohortId,
              name: data.name,
              startsAt: data.startsAt,
              endsAt: data.endsAt,
              capacity: data.capacity,
              requiresJoinCode: data.requiresJoinCode,
            },
          },
        });
        return data.cohortId;
      }

      const joinCode = await allocateUniqueJoinCode(tx);
      // ProgramCohort.startsAt/.endsAt are non-nullable in the schema. A rolling
      // cohort has no real window, so a blank date becomes "now" for the start
      // and a far date for the end; the canonical row members read carries the
      // null (plan 157).
      const created = await tx.programCohort.create({
        data: {
          name: data.name,
          joinCode,
          startsAt: data.startsAt ?? new Date(),
          endsAt: data.endsAt ?? ROLLING_COHORT_FAR_END,
          capacity: data.capacity ?? UNLIMITED_CAPACITY_PLACEHOLDER,
          requiresJoinCode: data.requiresJoinCode,
          status: "ENROLLING",
        },
        select: { id: true },
      });
      await mirrorToCanonicalCohort(tx, created.id, {
        name: data.name,
        joinCode,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        capacity: data.capacity,
        requiresJoinCode: data.requiresJoinCode,
        startMode: "ROLLING",
      });
      await tx.adminAction.create({
        data: {
          adminUserId: adminId,
          actorUserId: adminId,
          targetUserId: adminId,
          actionType: "PROGRAM_CREATE_COHORT",
          metadata: {
            cohortId: created.id,
            joinCode,
            requiresJoinCode: data.requiresJoinCode,
          },
        },
      });
      return created.id;
    });
    return { ok: true, cohortId };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Could not save cohort.",
    };
  }
}

export async function regenerateJoinCode(
  adminId: string,
  cohortId: string,
): Promise<{ ok: true; joinCode: string } | { ok: false; message: string }> {
  try {
    const joinCode = await prisma.$transaction(async (tx) => {
      const existing = await tx.programCohort.findUnique({
        where: { id: cohortId },
        select: { id: true, joinCode: true },
      });
      if (!existing) throw new Error("Cohort not found.");

      const next = await allocateUniqueJoinCode(tx);
      await tx.programCohort.update({
        where: { id: cohortId },
        data: { joinCode: next },
      });
      await mirrorToCanonicalCohort(tx, cohortId, { joinCode: next });
      await tx.adminAction.create({
        data: {
          adminUserId: adminId,
          actorUserId: adminId,
          targetUserId: adminId,
          actionType: "PROGRAM_REGENERATE_JOIN_CODE",
          metadata: {
            cohortId,
            previousJoinCode: existing.joinCode,
            joinCode: next,
          },
        },
      });
      return next;
    });
    return { ok: true, joinCode };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Could not regenerate code.",
    };
  }
}

export async function setCohortStatus(
  adminId: string,
  cohortId: string,
  status: ProgramCohortStatus,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const cohort = await prisma.programCohort.findUnique({
    where: { id: cohortId },
    select: { id: true, status: true },
  });
  if (!cohort) return { ok: false, message: "Cohort not found." };

  await prisma.$transaction(async (tx) => {
    await tx.programCohort.update({
      where: { id: cohortId },
      data: { status },
    });
    await mirrorToCanonicalCohort(tx, cohortId, { status });
    await tx.adminAction.create({
      data: {
        adminUserId: adminId,
        actorUserId: adminId,
        targetUserId: adminId,
        actionType: "PROGRAM_SET_COHORT_STATUS",
        metadata: { cohortId, from: cohort.status, to: status },
      },
    });
  });
  return { ok: true };
}

export async function publishResults(
  adminId: string,
  cohortId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const cohort = await prisma.programCohort.findUnique({
    where: { id: cohortId },
    select: { id: true, resultsPublishedAt: true },
  });
  if (!cohort) return { ok: false, message: "Cohort not found." };
  if (cohort.resultsPublishedAt) {
    return { ok: false, message: "Results are already published." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.programCohort.update({
      where: { id: cohortId },
      data: { resultsPublishedAt: new Date(), status: "COMPLETED" },
    });
    await mirrorToCanonicalCohort(tx, cohortId, {
      resultsPublishedAt: new Date(),
      status: "COMPLETED",
    });
    await tx.adminAction.create({
      data: {
        adminUserId: adminId,
        actorUserId: adminId,
        targetUserId: adminId,
        actionType: "PROGRAM_PUBLISH_RESULTS",
        metadata: { cohortId },
      },
    });
  });
  return { ok: true };
}

export async function getCohortOverview(
  cohortId: string,
): Promise<CohortOverview | null> {
  // Capacity comes from the canonical row because that is the one enrolment
  // enforces; ProgramCohort.capacity is a non-nullable placeholder (plan 157).
  const canonical = await prisma.cohort.findUnique({
    where: { slug: cohortSlugForProgramCohort(cohortId) },
    select: { capacity: true },
  });
  const cohort = await prisma.programCohort.findUnique({
    where: { id: cohortId },
    select: {
      id: true,
      name: true,
      joinCode: true,
      requiresJoinCode: true,
      status: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      resultsPublishedAt: true,
    },
  });
  if (!cohort) return null;

  const [statusCounts, members, modules, commitRows, atRisk] =
    await Promise.all([
      countCanonicalMembersByStatus(cohortId),
      listAiCohortMemberships({
        programCohortId: cohortId,
        statuses: ["ENROLLED", "COMPLETED"] as ProgramMemberStatus[],
      }),
      prisma.programModule.findMany({
        orderBy: { number: "asc" },
        select: {
          number: true,
          title: true,
          startDay: true,
          endDay: true,
        },
      }),
      prisma.programCommitDay.findMany({
        where: {
          programEnrollmentId: {
            in: (await listCanonicalProgramMemberIds({ programCohortId: cohortId })).map(
              peIdForMember,
            ),
          },
          commitCount: { gt: 0 },
        },
        select: { date: true, programEnrollmentId: true },
      }),
      getAtRiskMembers(cohortId),
    ]);
  const submissions = await listCanonicalMissionAttempts({
    memberIds: members.map((m) => m.id),
  });

  const enrolled =
    statusCounts.find((s) => s.status === "ENROLLED")?._count.id ?? 0;
  const completed =
    statusCounts.find((s) => s.status === "COMPLETED")?._count.id ?? 0;
  const waitlisted =
    statusCounts.find((s) => s.status === "WAITLISTED")?._count.id ?? 0;
  const dropped =
    statusCounts.find((s) => s.status === "DROPPED")?._count.id ?? 0;

  const bucketMap = new Map<string, number>();
  for (const m of members) {
    const bucketStart = Math.floor(m.totalScore / 50) * 50;
    const label =
      bucketStart >= 1000
        ? "1000+"
        : `${bucketStart}–${bucketStart + 49}`;
    bucketMap.set(label, (bucketMap.get(label) ?? 0) + 1);
  }
  const scoreBuckets = [...bucketMap.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => {
      const na = Number.parseInt(a.bucket, 10);
      const nb = Number.parseInt(b.bucket, 10);
      return na - nb;
    });

  const passedByMemberDay = new Set<string>();
  for (const s of submissions) {
    if (s.passed) passedByMemberDay.add(`${s.memberId}:${s.dayNumber}`);
  }

  const moduleProgress = modules.map((mod) => {
    const dayNumbers: number[] = [];
    for (let d = mod.startDay; d <= mod.endDay; d++) dayNumbers.push(d);
    const totalDays = dayNumbers.length;
    if (members.length === 0 || totalDays === 0) {
      return { moduleNumber: mod.number, title: mod.title, avgPct: 0 };
    }
    let sumPct = 0;
    for (const m of members) {
      const passed = dayNumbers.filter((dn) =>
        passedByMemberDay.has(`${m.id}:${dn}`),
      ).length;
      sumPct += (passed / totalDays) * 100;
    }
    return {
      moduleNumber: mod.number,
      title: mod.title,
      avgPct: Math.round(sumPct / members.length),
    };
  });

  // Rolling cohort (plan 157): there is no single cohort day, so engagement is
  // bucketed by each member's own day offset from their `startedAt`, and the
  // chart runs out to the furthest-along member.
  const startKeyByMember = new Map(
    members.map((m) => [
      m.id,
      formatInTimeZone(m.startedAt, PROGRAM_TZ, "yyyy-MM-dd"),
    ]),
  );
  const dayOffsetFor = (memberId: string, at: Date): number | null => {
    const startKey = startKeyByMember.get(memberId);
    if (!startKey) return null;
    const key = formatInTimeZone(at, PROGRAM_TZ, "yyyy-MM-dd");
    return (
      Math.floor(
        (new Date(key).getTime() - new Date(startKey).getTime()) / 86_400_000,
      ) + 1
    );
  };

  const calendarDay = members.reduce(
    (max, m) => Math.max(max, getMemberCalendarDay(m)),
    1,
  );
  const dailyEngagement: CohortOverview["dailyEngagement"] = [];
  for (let d = 1; d <= Math.min(PROGRAM_TOTAL_DAYS, calendarDay); d++) {
    const missionRuns = submissions.filter(
      (s) => dayOffsetFor(s.memberId, s.createdAt) === d,
    ).length;
    dailyEngagement.push({
      day: d,
      missionRuns,
      commitDays: 0,
    });
  }
  for (const row of commitRows) {
    const memberId = memberIdFromPe(row.programEnrollmentId);
    if (!memberId) continue;
    const dayOffset = dayOffsetFor(memberId, row.date);
    if (dayOffset !== null && dayOffset >= 1 && dayOffset <= PROGRAM_TOTAL_DAYS) {
      const cell = dailyEngagement.find((e) => e.day === dayOffset);
      if (cell) cell.commitDays += 1;
    }
  }

  const missionFunnel: CohortOverview["missionFunnel"] = [];
  for (let dayNumber = 1; dayNumber <= PROGRAM_TOTAL_DAYS; dayNumber++) {
    const daySubs = submissions.filter((s) => s.dayNumber === dayNumber);
    const membersAttempted = new Set(daySubs.map((s) => s.memberId));
    const membersPassed = new Set(
      daySubs.filter((s) => s.passed).map((s) => s.memberId),
    );
    const passRate =
      membersAttempted.size > 0
        ? Math.round((membersPassed.size / membersAttempted.size) * 100)
        : 0;
    const avgRuns =
      membersAttempted.size > 0
        ? Math.round((daySubs.length / membersAttempted.size) * 10) / 10
        : 0;
    missionFunnel.push({ dayNumber, passRate, avgRuns });
  }

  const expMap = new Map<string, number>();
  for (const m of members) {
    const band = experienceBand(m.yearsExperience);
    expMap.set(band, (expMap.get(band) ?? 0) + 1);
  }
  const experienceMix = [...expMap.entries()].map(([band, count]) => ({
    band,
    count,
  }));

  const atRiskDetailed = await Promise.all(
    atRisk.map(async (m) => {
      const status = await getMemberAtRiskStatus(m.memberId);
      return {
        memberId: m.memberId,
        fullName: m.fullName,
        reasons: m.reasons,
        behindBy: status.behindBy,
      };
    }),
  );

  return {
    cohort: {
      id: cohort.id,
      name: cohort.name,
      joinCode: cohort.joinCode,
      requiresJoinCode: cohort.requiresJoinCode,
      status: cohort.status,
      startsAt: formatDateTimeIST(cohort.startsAt),
      endsAt: formatDateTimeIST(cohort.endsAt),
      capacity: canonical?.capacity ?? null,
      resultsPublishedAt: cohort.resultsPublishedAt
        ? formatDateTimeIST(cohort.resultsPublishedAt)
        : null,
      enrolled: enrolled + completed,
      waitlisted,
      dropped,
    },
    scoreBuckets,
    moduleProgress,
    dailyEngagement,
    missionFunnel,
    experienceMix,
    atRisk: atRiskDetailed,
  };
}

export async function getCohortMembers(
  cohortId: string,
  filters: { q?: string; status?: ProgramMemberStatus },
): Promise<AdminMemberRow[]> {
  const cohort = await prisma.programCohort.findUnique({
    where: { id: cohortId },
    select: { startsAt: true },
  });
  if (!cohort) return [];

  const q = filters.q?.trim();

  const members = await listAiCohortMemberships({ programCohortId: cohortId });
  const filtered = q
    ? members.filter((m) => {
        const hay = `${m.fullName} ${m.company ?? ""} ${m.jobRole ?? ""}`.toLowerCase();
        return hay.includes(q.toLowerCase());
      })
    : members;
  const scoped = filters.status
    ? filtered.filter((m) => m.status === filters.status)
    : filtered;
  scoped.sort(compareProgramScoreRows);

  const userIds = scoped.map((m) => m.userId);
  const memberIds = scoped.map((m) => m.id);
  // Resolved via the interview read model (DAY_31 → DAY_15 → legacy).
  const interviewSignals = await getInterviewSignals(memberIds);
  const [entryAttempts, missionSubs] = await Promise.all([
    prisma.programEntryAttempt.findMany({
      where: { userId: { in: userIds }, cohortId },
      select: {
        userId: true,
        aptitudeScore: true,
        technicalScore: true,
        answers: true,
      },
      orderBy: { attemptNumber: "desc" },
    }),
    listCanonicalMissionAttempts({ memberIds }),
  ]);

  const subsByMember = new Map<string, typeof missionSubs>();
  for (const s of missionSubs) {
    const list = subsByMember.get(s.memberId) ?? [];
    list.push(s);
    subsByMember.set(s.memberId, list);
  }

  const entryByUser = new Map<string, number>();
  for (const a of entryAttempts) {
    if (a.answers === null) continue;
    if (!entryByUser.has(a.userId)) {
      entryByUser.set(a.userId, a.aptitudeScore + a.technicalScore);
    }
  }

  return scoped.map((m) => {
    const subs = subsByMember.get(m.id) ?? [];
    const { passedDays, skippedDays } = collectPassSkipSets(subs);
    const progressDay = getMemberProgressDay(passedDays);
    return {
      id: m.id,
      fullName: m.fullName,
      company: m.company,
      jobRole: m.jobRole,
      status: m.status,
      totalScore: m.totalScore,
      highestUnlockedDay: Math.max(m.highestUnlockedDay, progressDay),
      behindBy: getBehindByDays(m, progressDay),
      entryTotalScore: entryByUser.get(m.userId) ?? null,
      interviewStatus: interviewSignals.get(m.id)?.status ?? null,
      interviewOverall: interviewSignals.get(m.id)?.overallScore ?? null,
    };
  });
}

export async function promoteWaitlisted(
  adminId: string,
  memberId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const member = await findAiCohortMembershipByMemberId(memberId);
  if (!member) return { ok: false, message: "Member not found." };
  if (member.status !== "WAITLISTED") {
    return { ok: false, message: "Member is not waitlisted." };
  }

  try {
    await writeClient().$transaction(async (tx) => {
      // Null capacity means unlimited (plan 157). This used to read
      // `capacity ?? 0`, which turned "no cap" into "full" and would have made
      // every promotion fail with a misleading "Cohort is at capacity."
      const capacity = member.cohort.capacity;
      if (capacity !== null) {
        const enrolled = await countEnrolledProgramMembers(tx, member.cohortId);
        if (enrolled >= capacity) {
          throw new Error("Cohort is at capacity.");
        }
      }
      await applyProgramMembershipChange(tx, {
        memberId,
        userId: member.userId,
        programCohortId: member.cohortId,
        status: "ENROLLED",
        enrolledAt: new Date(),
      });
      await bootstrapMemberStartDay(tx, memberId);
      await tx.adminAction.create({
        data: {
          adminUserId: adminId,
          actorUserId: adminId,
          targetUserId: member.userId,
          actionType: "PROGRAM_PROMOTE_WAITLIST",
          metadata: { memberId },
        },
      });
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Promotion failed.",
    };
  }
}

export async function dropMember(
  adminId: string,
  memberId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const member = await findAiCohortMembershipByMemberId(memberId);
  if (!member) return { ok: false, message: "Member not found." };
  if (member.status === "DROPPED") {
    return { ok: false, message: "Member is already dropped." };
  }

  await writeClient().$transaction(async (tx) => {
    await applyProgramMembershipChange(tx, {
      memberId,
      userId: member.userId,
      programCohortId: member.cohortId,
      status: "DROPPED",
    });
    await tx.adminAction.create({
      data: {
        adminUserId: adminId,
        actorUserId: adminId,
        targetUserId: member.userId,
        actionType: "PROGRAM_DROP_MEMBER",
        reason,
        metadata: { memberId },
      },
    });
  });
  return { ok: true };
}

export async function adminUnlockDay(
  adminId: string,
  memberId: string,
  day: number,
  reason: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (day < 1 || day > PROGRAM_TOTAL_DAYS) {
    return { ok: false, message: `Day must be 1–${PROGRAM_TOTAL_DAYS}.` };
  }

  const member = await findAiCohortMembershipByMemberId(memberId);
  if (!member) return { ok: false, message: "Member not found." };

  const next = Math.min(
    PROGRAM_TOTAL_DAYS,
    Math.max(member.highestUnlockedDay, day),
  );
  if (next === member.highestUnlockedDay) {
    return { ok: false, message: "Day already unlocked." };
  }

  await writeClient().$transaction(async (tx) => {
    await applyProgramUnlockChange(tx, {
      memberId,
      highestUnlockedDay: next,
    });
    await tx.adminAction.create({
      data: {
        adminUserId: adminId,
        actorUserId: adminId,
        targetUserId: member.userId,
        actionType: "PROGRAM_UNLOCK_DAY",
        reason,
        metadata: {
          memberId,
          day,
          previous: member.highestUnlockedDay,
          next,
        },
      },
    });
  });
  return { ok: true };
}

export async function grantSkipToken(
  adminId: string,
  memberId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const member = await findAiCohortMembershipByMemberId(memberId);
  if (!member) return { ok: false, message: "Member not found." };
  if (member.skipTokensUsed <= 0) {
    return { ok: false, message: "No skip tokens used to restore." };
  }

  await writeClient().$transaction(async (tx) => {
    await applyProgramUnlockChange(tx, {
      memberId,
      skipTokensUsed: member.skipTokensUsed - 1,
    });
    await tx.adminAction.create({
      data: {
        adminUserId: adminId,
        actorUserId: adminId,
        targetUserId: member.userId,
        actionType: "PROGRAM_GRANT_SKIP_TOKEN",
        reason,
        metadata: { memberId },
      },
    });
  });
  return { ok: true };
}

export async function regenerateMemberRecommendation(
  adminId: string,
  memberId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const member = await findAiCohortMembershipByMemberId(memberId);
  if (!member) return { ok: false, message: "Member not found." };
  const projects = await prisma.programProject.findMany({
    where: {
      programEnrollmentId: peIdForMember(memberId),
      status: "GRADED",
    },
    select: { moduleNumber: true, adminScore: true, aiScore: true },
  });

  const atRisk = await getMemberAtRiskStatus(memberId);
  const behindBy = atRisk.behindBy;
  const missionsPassed = Math.floor(member.missionPoints / 12);
  const cleanPassPct =
    missionsPassed > 0
      ? Math.round((member.cleanPassCount / missionsPassed) * 100)
      : 0;

  const ai = await askClaudeJson<{ recommendation: string }>({
    system:
      'Write recruiter-readable recommendations. Reply JSON only: {"recommendation":"..."}. 2-3 sentences, concrete.',
    user: [
      `Candidate: ${member.fullName}, ${member.jobRole ?? "—"} at ${member.company ?? "—"}`,
      `Scores: total ${member.totalScore}, missions ${member.missionPoints}, concepts ${member.conceptPoints}, commits ${member.commitPoints}, projects ${member.projectPoints}`,
      `Clean pass rate: ${cleanPassPct}%, behind cohort by ${behindBy} days, skip tokens used ${member.skipTokensUsed}`,
      `Projects: ${projects.map((p) => `M${p.moduleNumber}=${p.adminScore ?? p.aiScore}`).join(", ") || "none"}`,
      atRisk.atRisk ? `At-risk: ${atRisk.reasons.join(", ")}` : "Not at-risk",
    ].join("\n"),
    maxTokens: 512,
  });

  if (!ai.ok) return { ok: false, message: ai.message };

  await prisma.$transaction(async (tx) => {
    await applyProgramRecommendationChange(tx, {
      memberId,
      aiRecommendation: ai.data.recommendation.trim(),
    });
    await tx.adminAction.create({
      data: {
        adminUserId: adminId,
        actorUserId: adminId,
        targetUserId: member.userId,
        actionType: "PROGRAM_REGENERATE_RECOMMENDATION",
        metadata: { memberId },
      },
    });
  });
  return { ok: true };
}

export async function getMemberAdminDetail(memberId: string) {
  const member = await findAiCohortMembershipByMemberId(memberId);
  if (!member) return null;
  const peId = peIdForMember(memberId);
  const [
    user,
    missionSubmissions,
    conceptAttempts,
    commitDays,
    exerciseCompletions,
    projects,
    entryAttempts,
    atRisk,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: member.userId },
      select: { email: true, image: true },
    }),
    listCanonicalMissionAttempts({ memberIds: [memberId] }),
    prisma.programConceptAttempt.findMany({
      where: { programEnrollmentId: peId },
      select: { dayNumber: true, score: true, answers: true },
      orderBy: { dayNumber: "asc" },
    }),
    prisma.programCommitDay.findMany({
      where: { programEnrollmentId: peId, commitCount: { gt: 0 } },
      select: { date: true, commitCount: true },
      orderBy: { date: "asc" },
    }),
    prisma.programExerciseCompletion.findMany({
      where: { programEnrollmentId: peId },
      select: {
        completedAt: true,
        exercise: { select: { slug: true, title: true } },
      },
      orderBy: { completedAt: "desc" },
    }),
    prisma.programProject.findMany({
      where: { programEnrollmentId: peId },
      select: {
        moduleNumber: true,
        repoUrl: true,
        status: true,
        aiScore: true,
        adminScore: true,
        aiFeedback: true,
      },
      orderBy: { moduleNumber: "asc" },
    }),
    prisma.programEntryAttempt.findMany({
      where: { userId: member.userId, cohortId: member.cohortId },
      orderBy: { attemptNumber: "asc" },
      select: {
        attemptNumber: true,
        aptitudeScore: true,
        technicalScore: true,
        passed: true,
        submittedAt: true,
      },
    }),
    getMemberAtRiskStatus(member.id),
  ]);

  const signal = await getInterviewSignal(member.id);
  const interview = signal
    ? {
        status: signal.status,
        overallScore: signal.overallScore,
        commScore: signal.communicationScore,
        techScore: signal.technicalDepthScore,
        problemScore: signal.problemSolvingScore,
        summary: signal.summary,
        durationSec: signal.durationSec,
      }
    : null;

  const { passedDays, skippedDays } = collectPassSkipSets(missionSubmissions);
  const progressDay = getMemberProgressDay(passedDays);
  const calendarDay = getMemberCalendarDay(member);
  const behindBy = getBehindByDays(member, progressDay);

  const dayStates = Array.from({ length: PROGRAM_TOTAL_DAYS }, (_, i) => {
    const dayNumber = i + 1;
    const dayPassed = passedDays.has(dayNumber);
    const daySkipped = skippedDays.has(dayNumber);
    return {
      dayNumber,
      state: dayPassed
        ? ("PASSED" as const)
        : daySkipped
          ? ("SKIPPED" as const)
          : dayNumber <= member.highestUnlockedDay
            ? ("AVAILABLE" as const)
            : ("LOCKED" as const),
    };
  });

  return {
    ...member,
    user,
    missionSubmissions,
    conceptAttempts,
    commitDays,
    exerciseCompletions,
    projects,
    interview,
    entryAttempts,
    atRiskReasons: atRisk.reasons,
    behindBy,
    progressDay,
    calendarDay,
    dayStates,
  };
}

export async function getProgramContentTree() {
  const [modules, exercises] = await Promise.all([
    prisma.programModule.findMany({
      orderBy: { number: "asc" },
      select: {
        number: true,
        title: true,
        subtitle: true,
        days: {
          orderBy: { dayNumber: "asc" },
          select: {
            dayNumber: true,
            title: true,
            missionType: true,
            missionPoints: true,
            _count: { select: { conceptQuestions: true, videos: true } },
          },
        },
      },
    }),
    prisma.programExercise.findMany({
      orderBy: [{ moduleNumber: "asc" }, { order: "asc" }],
      select: {
        slug: true,
        title: true,
        language: true,
        moduleNumber: true,
      },
    }),
  ]);

  return { modules, exercises };
}
