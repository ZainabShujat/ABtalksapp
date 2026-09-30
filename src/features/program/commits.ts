import "server-only";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { prisma, writeClient } from "@/lib/db";
import {
  addCalendarDaysToKey,
  parseCalendarKeyToUtcDate,
} from "@/lib/date-utils";
import {
  collectPassSkipSets,
  getBehindByDays,
  getMemberProgressDay,
  isSkippedPayload,
  type ProgramAnchor,
} from "@/features/program/progression";
import { parseRepo } from "@/features/program/verify-mission";
import {
  COMMIT_POINTS_PER_DAY,
  PROGRAM_MAX_COMMIT_POINTS,
  PROGRAM_MEMBER_START_DAY,
  PROGRAM_TOTAL_DAYS,
  PROGRAM_TZ,
} from "@/features/program/constants";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import { applyProgramScoreChange, findAiCohortMembershipByMemberId, listAiCohortMemberships } from "@/repositories/program-state";
import { peIdForMember } from "@/repositories/ids";
import { listCanonicalMissionAttempts } from "@/repositories/progress";

const MAX_COMMIT_POINTS = PROGRAM_MAX_COMMIT_POINTS;
const CHUNK_SIZE = 10;

export type HeatmapCell = { dateIso: string; count: number };

export type AtRiskMember = {
  memberId: string;
  fullName: string;
  reasons: ("behind_pace" | "stuck_mission")[];
};

export type MemberAtRiskStatus = {
  atRisk: boolean;
  reasons: AtRiskMember["reasons"];
  behindBy: number;
};

/** Program (America/Chicago) calendar date key for N days before today. */
export function getProgramDateKeyDaysAgo(daysAgo: number): string {
  const todayKey = formatInTimeZone(new Date(), PROGRAM_TZ, "yyyy-MM-dd");
  return addCalendarDaysToKey(todayKey, -daysAgo);
}

function programDateKeyToDbDate(key: string): Date {
  return parseCalendarKeyToUtcDate(key);
}

/** Inclusive program-TZ calendar day → [startUtc, endExclusiveUtc). */
function programDateRangeToUtc(
  startKey?: string,
  endKey?: string,
): { startUtc?: Date; endExclusiveUtc?: Date } {
  const startUtc = startKey
    ? fromZonedTime(`${startKey}T00:00:00`, PROGRAM_TZ)
    : undefined;
  let endExclusiveUtc: Date | undefined;
  if (endKey) {
    const nextKey = addCalendarDaysToKey(endKey, 1);
    endExclusiveUtc = fromZonedTime(`${nextKey}T00:00:00`, PROGRAM_TZ);
  }
  return { startUtc, endExclusiveUtc };
}

/** The learner's own 31-day window: [startedAt, startedAt + TOTAL_DAYS - 1] in PROGRAM_TZ. */
function memberWindowKeys(anchor: ProgramAnchor): {
  startKey: string;
  endKey: string;
} {
  const startKey = formatInTimeZone(anchor.startedAt, PROGRAM_TZ, "yyyy-MM-dd");
  return {
    startKey,
    endKey: addCalendarDaysToKey(startKey, PROGRAM_TOTAL_DAYS - 1),
  };
}

/**
 * Commit credit is windowed on the learner, not on a cohort (plan 157). A shared
 * cohort window silently stopped crediting everyone the day the cohort "ended".
 */
function isDateKeyInMemberWindow(
  dateKey: string,
  anchor: ProgramAnchor,
): boolean {
  const { startKey, endKey } = memberWindowKeys(anchor);
  return dateKey >= startKey && dateKey <= endKey;
}

export async function fetchGithubCommitCount(
  owner: string,
  repo: string,
  author: string,
  since: Date,
  until: Date,
): Promise<number> {
  const token = process.env.GITHUB_API_TOKEN;
  if (!token) {
    logger.error("[commits] GITHUB_API_TOKEN missing");
    return 0;
  }

  const params = new URLSearchParams({
    author,
    since: since.toISOString(),
    until: until.toISOString(),
    per_page: "100",
  });

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?${params}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "abtalks-program",
        },
        signal: AbortSignal.timeout(20000),
      },
    );

    if (res.status === 404 || res.status === 403) {
      logger.error("[commits] github commits denied", {
        owner,
        repo,
        status: res.status,
      });
      return 0;
    }
    if (!res.ok) {
      logger.error("[commits] github commits failed", {
        owner,
        repo,
        status: res.status,
      });
      return 0;
    }

    const data = (await res.json()) as unknown[];
    return Array.isArray(data) ? data.length : 0;
  } catch (e) {
    logger.error("[commits] github fetch errored", {
      owner,
      repo,
      error: String(e),
    });
    return 0;
  }
}

async function recomputeCommitPointsInTx(
  tx: Prisma.TransactionClient,
  memberId: string,
  anchor: ProgramAnchor,
): Promise<void> {
  const { startKey, endKey } = memberWindowKeys(anchor);
  const startDate = programDateKeyToDbDate(startKey);
  const endDate = programDateKeyToDbDate(endKey);

  const qualifyingDays = await tx.programCommitDay.count({
    where: {
      memberId,
      commitCount: { gt: 0 },
      date: { gte: startDate, lte: endDate },
    },
  });

  const commitPoints = Math.min(
    MAX_COMMIT_POINTS,
    qualifyingDays * COMMIT_POINTS_PER_DAY,
  );

  await applyProgramScoreChange(tx, {
    memberId,
    commitPoints,
  });
}

async function recomputeCommitPointsForMember(
  memberId: string,
  anchor: ProgramAnchor,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await recomputeCommitPointsInTx(tx, memberId, anchor);
  });
}

/**
 * Upsert a ProgramCommitDay with commitCount = max(existing, 1).
 * Returns true if the date was inside the learner's own 31-day window.
 */
export async function creditCommitDayInTx(
  tx: Prisma.TransactionClient,
  memberId: string,
  programDateKey: string,
  anchor: ProgramAnchor,
): Promise<boolean> {
  if (!isDateKeyInMemberWindow(programDateKey, anchor)) {
    return false;
  }

  const commitDate = programDateKeyToDbDate(programDateKey);
  const existing = await tx.programCommitDay.findUnique({
    where: { memberId_date: { memberId, date: commitDate } },
    select: { commitCount: true },
  });
  const nextCount = Math.max(existing?.commitCount ?? 0, 1);

  const row = await tx.programCommitDay.upsert({
    where: { memberId_date: { memberId, date: commitDate } },
    create: {
      memberId,
      programEnrollmentId: peIdForMember(memberId),
      date: commitDate,
      commitCount: nextCount,
    },
    update: { commitCount: nextCount },
  });
  return true;
}

/**
 * Mark programDateKey as a qualifying commit day (min count 1) and recompute points.
 * Used after first mission pass — does not call GitHub.
 */
export async function creditCommitDayForMember(
  memberId: string,
  programDateKey: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const member = await findAiCohortMembershipByMemberId(memberId);
  if (!member) {
    return { ok: false, message: "Member not found." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const credited = await creditCommitDayInTx(
        tx,
        memberId,
        programDateKey,
        member,
      );
      if (credited) {
        await recomputeCommitPointsInTx(tx, memberId, member);
      }
    });
    return { ok: true };
  } catch (e) {
    logger.error("[commits] creditCommitDayForMember failed", {
      memberId,
      programDateKey,
      error: String(e),
    });
    return { ok: false, message: "Could not credit commit day." };
  }
}

/** Number of early cohort calendar days to green at enroll (matches waived mission days). */
export const EARLY_COMMIT_DAY_COUNT = PROGRAM_MEMBER_START_DAY - 1;

/**
 * Seed commit activity for the learner's own days start+0 .. start+(N-1).
 * Prefer bootstrapMemberStartDay for enroll; this is for callers that already
 * have a transaction and the learner's anchor.
 */
export async function seedEarlyCommitDaysInTx(
  tx: Prisma.TransactionClient,
  memberId: string,
  anchor: ProgramAnchor,
): Promise<void> {
  const { startKey } = memberWindowKeys(anchor);
  let any = false;

  for (let i = 0; i < EARLY_COMMIT_DAY_COUNT; i++) {
    const dateKey = addCalendarDaysToKey(startKey, i);
    const credited = await creditCommitDayInTx(tx, memberId, dateKey, anchor);
    if (credited) any = true;
  }

  if (any) {
    await recomputeCommitPointsInTx(tx, memberId, anchor);
  }
}

type MemberRow = {
  id: string;
  githubUsername: string;
  githubRepoUrl: string;
  highestUnlockedDay: number;
  startedAt: Date;
};

export async function processMemberCommitDay(
  member: MemberRow,
  programDateKey: string,
): Promise<{ ok: true } | { ok: false; memberId: string; reason: string }> {
  if (!isDateKeyInMemberWindow(programDateKey, member)) {
    return { ok: true };
  }

  const parsed = parseRepo(member.githubRepoUrl);
  if (!parsed) {
    return { ok: false, memberId: member.id, reason: "invalid_repo_url" };
  }

  const { startUtc, endExclusiveUtc } = programDateRangeToUtc(
    programDateKey,
    programDateKey,
  );
  if (!startUtc || !endExclusiveUtc) {
    return { ok: false, memberId: member.id, reason: "invalid_date_range" };
  }

  const count = await fetchGithubCommitCount(
    parsed.owner,
    parsed.repo,
    member.githubUsername,
    startUtc,
    endExclusiveUtc,
  );

  const commitDate = programDateKeyToDbDate(programDateKey);

  // Preserve seeded / credited floors (e.g. early days 1–3 at enroll) —
  // never let a GitHub 0 wipe an existing qualifying day.
  const existing = await prisma.programCommitDay.findUnique({
    where: { memberId_date: { memberId: member.id, date: commitDate } },
    select: { commitCount: true },
  });
  const nextCount = Math.max(existing?.commitCount ?? 0, count);

  await writeClient().$transaction(async (tx) => {
    await tx.programCommitDay.upsert({
      where: {
        memberId_date: { memberId: member.id, date: commitDate },
      },
      create: {
        memberId: member.id,
        programEnrollmentId: peIdForMember(member.id),
        date: commitDate,
        commitCount: nextCount,
      },
      update: { commitCount: nextCount },
    });
  });

  await recomputeCommitPointsForMember(member.id, member);
  return { ok: true };
}

export async function runProgramCommitsCron(): Promise<{
  processed: number;
  failures: { memberId: string; reason: string }[];
}> {
  const cohorts = await prisma.programCohort.findMany({
    where: { status: { in: ["ENROLLING", "ACTIVE"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (cohorts.length === 0) {
    return { processed: 0, failures: [] };
  }

  const programDateKey = getProgramDateKeyDaysAgo(1);
  const failures: { memberId: string; reason: string }[] = [];
  let processed = 0;

  // No cohort-level date skip (plan 157): each member carries their own window,
  // and processMemberCommitDay drops anything outside it.
  for (const cohort of cohorts) {
    const members = await listAiCohortMemberships({
      programCohortId: cohort.id,
    });

    for (let i = 0; i < members.length; i += CHUNK_SIZE) {
      const chunk = members.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(
        chunk.map((m) => processMemberCommitDay(m, programDateKey)),
      );

      for (let j = 0; j < results.length; j++) {
        const member = chunk[j]!;
        const result = results[j]!;
        if (result.status === "rejected") {
          failures.push({
            memberId: member.id,
            reason: String(result.reason),
          });
          logger.error("[commits] member processing failed", {
            memberId: member.id,
            error: String(result.reason),
          });
          continue;
        }
        if (!result.value.ok) {
          failures.push({
            memberId: result.value.memberId,
            reason: result.value.reason,
          });
          continue;
        }
        processed += 1;
      }
    }
  }

  return { processed, failures };
}

export async function getCommitHeatmap(
  memberId: string,
  anchor: ProgramAnchor,
): Promise<HeatmapCell[]> {
  const { startKey } = memberWindowKeys(anchor);

  const rows = await prisma.programCommitDay.findMany({
    where: { memberId },
    select: { date: true, commitCount: true },
  });

  // Stored as UTC-midnight civil keys — read keys in UTC, not Chicago.
  const byDate = new Map(
    rows.map((r) => [
      formatInTimeZone(r.date, "UTC", "yyyy-MM-dd"),
      r.commitCount,
    ]),
  );

  const cells: HeatmapCell[] = [];
  for (let i = 0; i < PROGRAM_TOTAL_DAYS; i++) {
    const dateKey = addCalendarDaysToKey(startKey, i);
    cells.push({
      dateIso: dateKey,
      count: byDate.get(dateKey) ?? 0,
    });
  }
  return cells;
}

async function evaluateMemberAtRisk(
  member: {
    id: string;
    highestUnlockedDay: number;
    startedAt: Date;
  },
): Promise<AtRiskMember["reasons"]> {
  const reasons: AtRiskMember["reasons"] = [];

  const submissions = await listCanonicalMissionAttempts({
    memberIds: [member.id],
  });
  const { passedDays } = collectPassSkipSets(submissions);
  const progressDay = getMemberProgressDay(passedDays);
  const behindBy = getBehindByDays(member, progressDay);

  if (behindBy > 2) {
    reasons.push("behind_pace");
  }

  // Stuck on the next incomplete day (progress + 1), if they have failures there.
  const dayNumber = Math.min(PROGRAM_TOTAL_DAYS, progressDay + 1);
  const passed = passedDays.has(dayNumber);
  if (!passed) {
    const dayFails = submissions.filter(
      (s) =>
        s.dayNumber === dayNumber &&
        !s.passed &&
        !isSkippedPayload(s.payload),
    );
    const oldestFailed = dayFails.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )[0];
    if (oldestFailed) {
      const twoDaysAgoKey = getProgramDateKeyDaysAgo(2);
      const { startUtc } = programDateRangeToUtc(twoDaysAgoKey, twoDaysAgoKey);
      if (startUtc && oldestFailed.createdAt < startUtc) {
        reasons.push("stuck_mission");
      }
    }
  }

  return reasons;
}

export async function getAtRiskMembers(
  cohortId: string,
): Promise<AtRiskMember[]> {
  const members = await listAiCohortMemberships({ programCohortId: cohortId });

  const atRisk: AtRiskMember[] = [];
  for (const member of members) {
    const reasons = await evaluateMemberAtRisk(member);
    if (reasons.length > 0) {
      atRisk.push({ memberId: member.id, fullName: member.fullName, reasons });
    }
  }
  return atRisk;
}

export async function getMemberAtRiskStatus(
  memberId: string,
): Promise<MemberAtRiskStatus> {
  const member = await findAiCohortMembershipByMemberId(memberId);
  if (!member) {
    return { atRisk: false, reasons: [], behindBy: 0 };
  }

  const submissions = await listCanonicalMissionAttempts({
    memberIds: [member.id],
  });
  const { passedDays } = collectPassSkipSets(submissions);
  const progressDay = getMemberProgressDay(passedDays);
  const behindBy = getBehindByDays(member, progressDay);
  const reasons = await evaluateMemberAtRisk(member);

  return {
    atRisk: reasons.length > 0,
    reasons,
    behindBy,
  };
}
