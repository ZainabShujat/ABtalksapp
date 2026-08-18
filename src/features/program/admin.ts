import "server-only";
import type {
  Prisma,
  ProgramCohortStatus,
  ProgramMemberStatus,
} from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/db";
import { formatDateTimeIST } from "@/lib/date-utils";
import { PROGRAM_TOTAL_DAYS, PROGRAM_TZ } from "@/features/program/constants";
import { bootstrapMemberStartDay } from "@/features/program/bootstrap-start-day";
import { getAtRiskMembers, getMemberAtRiskStatus } from "@/features/program/commits";
import {
  collectPassSkipSets,
  getBehindByDays,
  getCohortCalendarDay,
  getMemberProgressDay,
} from "@/features/program/progression";
import { askClaudeJson } from "@/lib/anthropic";
import {
  getInterviewSignal,
  getInterviewSignals,
} from "@/features/interview/read-model";
import { generateProgramJoinCode } from "@/lib/program-auth";

export type CohortOverview = {
  cohort: {
    id: string;
    name: string;
    joinCode: string;
    requiresJoinCode: boolean;
    status: ProgramCohortStatus;
    startsAt: string;
    endsAt: string;
    capacity: number;
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
  company: string;
  jobRole: string;
  status: ProgramMemberStatus;
  totalScore: number;
  highestUnlockedDay: number;
  behindBy: number;
  entryTotalScore: number | null;
  interviewStatus: string | null;
  interviewOverall: number | null;
};

function experienceBand(years: number): string {
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

export async function createOrUpdateCohort(
  adminId: string,
  data: {
    cohortId?: string;
    name: string;
    startsAt: Date;
    endsAt: Date;
    capacity: number;
    requiresJoinCode: boolean;
  },
): Promise<{ ok: true; cohortId: string } | { ok: false; message: string }> {
  if (data.startsAt >= data.endsAt) {
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
            startsAt: data.startsAt,
            endsAt: data.endsAt,
            capacity: data.capacity,
            requiresJoinCode: data.requiresJoinCode,
          },
        });
        await tx.adminAction.create({
          data: {
            adminUserId: adminId,
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
      const created = await tx.programCohort.create({
        data: {
          name: data.name,
          joinCode,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          capacity: data.capacity,
          requiresJoinCode: data.requiresJoinCode,
          status: "ENROLLING",
        },
        select: { id: true },
      });
      await tx.adminAction.create({
        data: {
          adminUserId: adminId,
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
      await tx.adminAction.create({
        data: {
          adminUserId: adminId,
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
    await tx.adminAction.create({
      data: {
        adminUserId: adminId,
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
    await tx.adminAction.create({
      data: {
        adminUserId: adminId,
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

  const [statusCounts, members, modules, submissions, commitRows, atRisk] =
    await Promise.all([
      prisma.programMember.groupBy({
        by: ["status"],
        where: { cohortId },
        _count: { id: true },
      }),
      prisma.programMember.findMany({
        where: {
          cohortId,
          status: { in: ["ENROLLED", "COMPLETED"] },
        },
        select: {
          id: true,
          totalScore: true,
          yearsExperience: true,
          highestUnlockedDay: true,
        },
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
      prisma.programMissionSubmission.findMany({
        where: { member: { cohortId } },
        select: {
          memberId: true,
          dayNumber: true,
          passed: true,
          createdAt: true,
        },
      }),
      prisma.programCommitDay.findMany({
        where: {
          member: { cohortId },
          commitCount: { gt: 0 },
        },
        select: { date: true },
      }),
      getAtRiskMembers(cohortId),
    ]);

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

  const calendarDay = getCohortCalendarDay(cohort);
  const dailyEngagement: CohortOverview["dailyEngagement"] = [];
  for (let d = 1; d <= Math.min(PROGRAM_TOTAL_DAYS, calendarDay); d++) {
    const missionRuns = submissions.filter((s) => {
      const key = formatInTimeZone(s.createdAt, PROGRAM_TZ, "yyyy-MM-dd");
      const startKey = formatInTimeZone(cohort.startsAt, PROGRAM_TZ, "yyyy-MM-dd");
      const dayOffset =
        Math.floor(
          (new Date(key).getTime() - new Date(startKey).getTime()) /
            86_400_000,
        ) + 1;
      return dayOffset === d;
    }).length;
    dailyEngagement.push({
      day: d,
      missionRuns,
      commitDays: 0,
    });
  }
  for (const row of commitRows) {
    const key = formatInTimeZone(row.date, PROGRAM_TZ, "yyyy-MM-dd");
    const startKey = formatInTimeZone(cohort.startsAt, PROGRAM_TZ, "yyyy-MM-dd");
    const dayOffset =
      Math.floor(
        (new Date(key).getTime() - new Date(startKey).getTime()) / 86_400_000,
      ) + 1;
    if (dayOffset >= 1 && dayOffset <= PROGRAM_TOTAL_DAYS) {
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
      const status = await getMemberAtRiskStatus(m.memberId, cohort.id);
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
      capacity: cohort.capacity,
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

  const members = await prisma.programMember.findMany({
    where: {
      cohortId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(q
        ? {
            OR: [
              { fullName: { contains: q, mode: "insensitive" } },
              { company: { contains: q, mode: "insensitive" } },
              { jobRole: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ totalScore: "desc" }, { fullName: "asc" }],
    select: {
      id: true,
      fullName: true,
      company: true,
      jobRole: true,
      status: true,
      totalScore: true,
      highestUnlockedDay: true,
      userId: true,
    },
  });

  const userIds = members.map((m) => m.userId);
  const memberIds = members.map((m) => m.id);
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
    prisma.programMissionSubmission.findMany({
      where: { memberId: { in: memberIds } },
      select: {
        memberId: true,
        dayNumber: true,
        passed: true,
        payload: true,
      },
    }),
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

  return members.map((m) => {
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
      behindBy: getBehindByDays(cohort, progressDay),
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
  const member = await prisma.programMember.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      status: true,
      cohortId: true,
      userId: true,
      cohort: { select: { capacity: true } },
    },
  });
  if (!member) return { ok: false, message: "Member not found." };
  if (member.status !== "WAITLISTED") {
    return { ok: false, message: "Member is not waitlisted." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const enrolled = await tx.programMember.count({
        where: { cohortId: member.cohortId, status: "ENROLLED" },
      });
      if (enrolled >= member.cohort.capacity) {
        throw new Error("Cohort is at capacity.");
      }
      await tx.programMember.update({
        where: { id: memberId },
        data: { status: "ENROLLED", enrolledAt: new Date() },
      });
      await bootstrapMemberStartDay(tx, memberId);
      await tx.adminAction.create({
        data: {
          adminUserId: adminId,
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
  const member = await prisma.programMember.findUnique({
    where: { id: memberId },
    select: { id: true, userId: true, status: true },
  });
  if (!member) return { ok: false, message: "Member not found." };
  if (member.status === "DROPPED") {
    return { ok: false, message: "Member is already dropped." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.programMember.update({
      where: { id: memberId },
      data: { status: "DROPPED" },
    });
    await tx.adminAction.create({
      data: {
        adminUserId: adminId,
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

  const member = await prisma.programMember.findUnique({
    where: { id: memberId },
    select: { id: true, userId: true, highestUnlockedDay: true },
  });
  if (!member) return { ok: false, message: "Member not found." };

  const next = Math.min(
    PROGRAM_TOTAL_DAYS,
    Math.max(member.highestUnlockedDay, day),
  );
  if (next === member.highestUnlockedDay) {
    return { ok: false, message: "Day already unlocked." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.programMember.update({
      where: { id: memberId },
      data: { highestUnlockedDay: next },
    });
    await tx.adminAction.create({
      data: {
        adminUserId: adminId,
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
  const member = await prisma.programMember.findUnique({
    where: { id: memberId },
    select: { id: true, userId: true, skipTokensUsed: true },
  });
  if (!member) return { ok: false, message: "Member not found." };
  if (member.skipTokensUsed <= 0) {
    return { ok: false, message: "No skip tokens used to restore." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.programMember.update({
      where: { id: memberId },
      data: { skipTokensUsed: { decrement: 1 } },
    });
    await tx.adminAction.create({
      data: {
        adminUserId: adminId,
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
  const member = await prisma.programMember.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      userId: true,
      fullName: true,
      jobRole: true,
      company: true,
      missionPoints: true,
      conceptPoints: true,
      commitPoints: true,
      projectPoints: true,
      totalScore: true,
      cleanPassCount: true,
      skipTokensUsed: true,
      highestUnlockedDay: true,
      cohort: { select: { id: true, startsAt: true, endsAt: true } },
      projects: {
        where: { status: "GRADED" },
        select: { moduleNumber: true, adminScore: true, aiScore: true },
      },
    },
  });
  if (!member) return { ok: false, message: "Member not found." };

  const atRisk = await getMemberAtRiskStatus(memberId, member.cohort.id);
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
      `Candidate: ${member.fullName}, ${member.jobRole} at ${member.company}`,
      `Scores: total ${member.totalScore}, missions ${member.missionPoints}, concepts ${member.conceptPoints}, commits ${member.commitPoints}, projects ${member.projectPoints}`,
      `Clean pass rate: ${cleanPassPct}%, behind cohort by ${behindBy} days, skip tokens used ${member.skipTokensUsed}`,
      `Projects: ${member.projects.map((p) => `M${p.moduleNumber}=${p.adminScore ?? p.aiScore}`).join(", ") || "none"}`,
      atRisk.atRisk ? `At-risk: ${atRisk.reasons.join(", ")}` : "Not at-risk",
    ].join("\n"),
    maxTokens: 512,
  });

  if (!ai.ok) return { ok: false, message: ai.message };

  await prisma.$transaction(async (tx) => {
    await tx.programMember.update({
      where: { id: memberId },
      data: {
        aiRecommendation: ai.data.recommendation.trim(),
        aiRecommendationAt: new Date(),
      },
    });
    await tx.adminAction.create({
      data: {
        adminUserId: adminId,
        targetUserId: member.userId,
        actionType: "PROGRAM_REGENERATE_RECOMMENDATION",
        metadata: { memberId },
      },
    });
  });
  return { ok: true };
}

export async function getMemberAdminDetail(memberId: string) {
  const member = await prisma.programMember.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      fullName: true,
      jobRole: true,
      company: true,
      yearsExperience: true,
      education: true,
      university: true,
      graduationYear: true,
      skills: true,
      linkedinUrl: true,
      resumeUrl: true,
      phone: true,
      githubUsername: true,
      githubRepoUrl: true,
      status: true,
      highestUnlockedDay: true,
      skipTokensUsed: true,
      missionPoints: true,
      conceptPoints: true,
      commitPoints: true,
      projectPoints: true,
      totalScore: true,
      cleanPassCount: true,
      aiRecommendation: true,
      aiRecommendationAt: true,
      enrolledAt: true,
      userId: true,
      cohortId: true,
      user: { select: { email: true, image: true } },
      cohort: { select: { id: true, name: true, startsAt: true, status: true } },
      missionSubmissions: {
        select: {
          dayNumber: true,
          attemptNumber: true,
          passed: true,
          pointsAwarded: true,
          verdict: true,
          payload: true,
          createdAt: true,
        },
        orderBy: [{ dayNumber: "asc" }, { attemptNumber: "asc" }],
      },
      conceptAttempts: {
        select: { dayNumber: true, score: true, answers: true },
        orderBy: { dayNumber: "asc" },
      },
      commitDays: {
        where: { commitCount: { gt: 0 } },
        select: { date: true, commitCount: true },
        orderBy: { date: "asc" },
      },
      exerciseCompletions: {
        select: {
          completedAt: true,
          exercise: { select: { slug: true, title: true } },
        },
        orderBy: { completedAt: "desc" },
      },
      projects: {
        select: {
          moduleNumber: true,
          repoUrl: true,
          status: true,
          aiScore: true,
          adminScore: true,
          aiFeedback: true,
        },
        orderBy: { moduleNumber: "asc" },
      },
    },
  });
  if (!member) return null;

  const [entryAttempts, atRisk] = await Promise.all([
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
    getMemberAtRiskStatus(member.id, member.cohortId),
  ]);

  // Resolved via the interview read model (DAY_31 -> DAY_15 -> legacy) rather
  // than the raw ProgramInterview relation.
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

  const { passedDays, skippedDays } = collectPassSkipSets(
    member.missionSubmissions,
  );
  const progressDay = getMemberProgressDay(passedDays);
  const calendarDay = getCohortCalendarDay(member.cohort);
  const behindBy = getBehindByDays(member.cohort, progressDay);

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
