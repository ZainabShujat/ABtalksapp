import "server-only";
import {
  AttemptLateness,
  EnrollmentStatus,
  SubmissionStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  enrollmentIdFromPe,
  memberIdFromPe,
  peIdForEnrollment,
  peIdForMember,
  quizIdFromActivity,
  missionSubmissionIdFromAttemptId,
  domainFromChallengeCohortSlug,
} from "@/repositories/ids";
import { listTrackStreakSnapshots } from "@/repositories/enrollment-state";

export type ChallengeProgressStats = {
  daysCompleted: number;
  currentStreak: number;
  longestStreak: number;
  lastSubmittedDay: number | null;
};

export type ChallengeSubmissionRow = {
  id: string;
  dayNumber: number;
  status: SubmissionStatus;
  githubUrl: string | null;
  linkedinUrl: string | null;
  submittedAt: Date;
};

export type ProgramMissionProgressRow = {
  dayNumber: number;
  passed: boolean;
  payload: unknown;
};

export type ProgramMissionAttemptRow = {
  attemptNumber: number;
  passed: boolean;
  verdict: Prisma.JsonValue | null;
  payload: unknown;
  createdAt: Date;
};

export type QuizAttemptRow = {
  id: string;
  quizId: string;
  score: number;
  answers: Record<string, string>;
  attemptedAt: Date;
};

function jsonObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function answersFromPayload(
  payload: Prisma.JsonValue | null | undefined,
): Record<string, string> {
  const answers = jsonObject(payload).answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(answers as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function latenessToStatus(lateness: AttemptLateness): SubmissionStatus {
  return lateness === AttemptLateness.LATE
    ? SubmissionStatus.LATE
    : SubmissionStatus.ON_TIME;
}

/**
 * Highest passed challenge day number (not latest timestamp, not ON_TIME-only).
 * Matches submit-day daysCompletedFromCanonical / lastSubmittedDay.
 */
export async function listChallengeCompletions(
  enrollmentIds: string[],
): Promise<Map<string, { daysCompleted: number; lastSubmittedDay: number | null }>> {
  const out = new Map<
    string,
    { daysCompleted: number; lastSubmittedDay: number | null }
  >();
  if (enrollmentIds.length === 0) return out;
  const attempts = await prisma.activityAttempt.findMany({
    where: {
      enrollmentId: { in: enrollmentIds.map(peIdForEnrollment) },
      id: { startsWith: "aa_sub_" },
      activityId: { startsWith: "act_dt_" },
    },
    select: {
      enrollmentId: true,
      passed: true,
      activity: { select: { dayNumber: true } },
      evaluations: {
        where: { isAuthoritative: true },
        select: { passed: true },
        take: 1,
      },
    },
  });
  const daysByEnrollment = new Map<string, Set<number>>();
  for (const row of attempts) {
    const enrollmentId = enrollmentIdFromPe(row.enrollmentId);
    if (!enrollmentId) continue;
    const dayNumber = row.activity.dayNumber;
    if (dayNumber == null) continue;
    const passed = row.evaluations[0]?.passed ?? row.passed;
    if (!passed) continue;
    let days = daysByEnrollment.get(enrollmentId);
    if (!days) {
      days = new Set();
      daysByEnrollment.set(enrollmentId, days);
    }
    days.add(dayNumber);
  }
  for (const id of enrollmentIds) {
    const days = daysByEnrollment.get(id);
    if (!days || days.size === 0) {
      out.set(id, { daysCompleted: 0, lastSubmittedDay: null });
      continue;
    }
    let lastSubmittedDay: number | null = null;
    for (const dayNumber of days) {
      if (lastSubmittedDay == null || dayNumber > lastSubmittedDay) {
        lastSubmittedDay = dayNumber;
      }
    }
    out.set(id, { daysCompleted: days.size, lastSubmittedDay });
  }
  return out;
}

async function challengeCompletionFromAttempts(
  enrollmentId: string,
): Promise<{ daysCompleted: number; lastSubmittedDay: number | null }> {
  const map = await listChallengeCompletions([enrollmentId]);
  return map.get(enrollmentId) ?? { daysCompleted: 0, lastSubmittedDay: null };
}

export async function countChallengeEnrollmentsWithDaysGte(
  minDays: number,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    WITH canon AS (
      SELECT
        substr(aa."enrollmentId", 8) AS enrollment_id,
        count(DISTINCT act."dayNumber") FILTER (
          WHERE act."dayNumber" IS NOT NULL
            AND COALESCE(ev.passed, aa.passed)
        )::int AS days
      FROM "ActivityAttempt" aa
      JOIN "Activity" act ON act.id = aa."activityId"
      LEFT JOIN LATERAL (
        SELECT ev.passed
        FROM "ActivityEvaluation" ev
        WHERE ev."attemptId" = aa.id AND ev."isAuthoritative" = true
        LIMIT 1
      ) ev ON true
      WHERE aa.id LIKE 'aa_sub_%'
        AND aa."activityId" LIKE 'act_dt_%'
      GROUP BY 1
    )
    SELECT count(*)::bigint AS n FROM canon WHERE days >= ${minDays}
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Days come from ActivityAttempt. Track streak is the ProgramEnrollment
 * historical snapshot (live-recomputing streak from AA would change ~208
 * historical snapshots). Frozen Enrollment denorms are not current-state.
 */
export async function getChallengeProgressStats(
  enrollmentId: string,
): Promise<ChallengeProgressStats> {
  const pe = await listTrackStreakSnapshots([enrollmentId]);
  const streaks = pe.get(enrollmentId) ?? {
    currentStreak: 0,
    longestStreak: 0,
  };
  const derived = await challengeCompletionFromAttempts(enrollmentId);
  return { ...derived, ...streaks };
}

export async function overlayChallengeProgressFields<
  T extends {
    id: string;
    daysCompleted: number;
    currentStreak: number;
    longestStreak: number;
    lastSubmittedDay: number | null;
  },
>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  let next = rows;
  const derived = await listChallengeCompletions(next.map((row) => row.id));
  next = next.map((row) => {
    const completion = derived.get(row.id);
    if (!completion) {
      return { ...row, daysCompleted: 0, lastSubmittedDay: null };
    }
    return {
      ...row,
      daysCompleted: completion.daysCompleted,
      lastSubmittedDay: completion.lastSubmittedDay,
    };
  });
  const snaps = await listTrackStreakSnapshots(next.map((row) => row.id));
  next = next.map((row) => {
    const snap = snaps.get(row.id);
    if (!snap) return row;
    return {
      ...row,
      currentStreak: snap.currentStreak,
      longestStreak: snap.longestStreak,
    };
  });
  return next;
}

async function listChallengeSubmissionTimes(userId: string): Promise<Date[]> {
  
  const pes = await prisma.programEnrollment.findMany({
    where: { userId, id: { startsWith: "pe_enr_" } },
    select: { id: true },
  });
  if (pes.length === 0) return [];
  const rows = await prisma.activityAttempt.findMany({
    where: {
      enrollmentId: { in: pes.map((p) => p.id) },
      id: { startsWith: "aa_sub_" },
      submittedAt: { not: null },
    },
    select: { submittedAt: true },
  });
  return rows
    .map((r) => r.submittedAt)
    .filter((d): d is Date => d instanceof Date);
}

/**
 * Skip tokens and enrollment waivers create ProgramMissionSubmission rows the
 * member never submitted — they are bookkeeping, not activity.
 * Local copy of the feature-layer predicates: features/program/progression
 * imports this file, so importing it back would cycle.
 */
function isBookkeepingMissionPayload(payload: Prisma.JsonValue | null): boolean {
  const obj = jsonObject(payload);
  return obj.skipped === true || obj.waived === true;
}

/** AI Cohort mission runs — every verification run, pass or fail. */
async function listProgramMissionTimes(userId: string): Promise<Date[]> {
  
  const pes = await prisma.programEnrollment.findMany({
    where: { userId, id: { startsWith: "pe_pm_" } },
    select: { id: true },
  });
  if (pes.length === 0) return [];
  const rows = await prisma.activityAttempt.findMany({
    where: {
      enrollmentId: { in: pes.map((p) => p.id) },
      id: { startsWith: "aa_ms_" },
      activityId: { startsWith: "act_pd_" },
    },
    select: { submittedAt: true, createdAt: true, payload: true },
  });
  return rows
    .filter((r) => !isBookkeepingMissionPayload(r.payload))
    .map((r) => r.submittedAt ?? r.createdAt);
}

/** Databricks mission runs — every verification run, pass or fail. */
async function listDatabricksAttemptTimes(userId: string): Promise<Date[]> {
  const rows = await prisma.activityAttempt.findMany({
    where: {
      enrollment: { userId },
      activityId: { startsWith: "act_dbx_day_" },
    },
    select: { submittedAt: true, createdAt: true },
  });
  return rows.map((r) => r.submittedAt ?? r.createdAt);
}

/** Data Solutions Architect mission runs — every verification run, pass or fail. */
async function listDsArchitectAttemptTimes(userId: string): Promise<Date[]> {
  const rows = await prisma.activityAttempt.findMany({
    where: {
      enrollment: { userId },
      activityId: { startsWith: "act_dsa_day_" },
    },
    select: { submittedAt: true, createdAt: true },
  });
  return rows.map((r) => r.submittedAt ?? r.createdAt);
}

/** Power BI mission runs — every verification run, pass or fail. */
async function listPowerBiAttemptTimes(userId: string): Promise<Date[]> {
  const rows = await prisma.activityAttempt.findMany({
    where: {
      enrollment: { userId },
      activityId: { startsWith: "act_pbi_day_" },
    },
    select: { submittedAt: true, createdAt: true },
  });
  return rows.map((r) => r.submittedAt ?? r.createdAt);
}

/** Snowflake mission runs — every verification run, pass or fail. */
async function listSnowflakeAttemptTimes(userId: string): Promise<Date[]> {
  const rows = await prisma.activityAttempt.findMany({
    where: {
      enrollment: { userId },
      activityId: { startsWith: "act_snf_day_" },
    },
    select: { submittedAt: true, createdAt: true },
  });
  return rows.map((r) => r.submittedAt ?? r.createdAt);
}

/** Databricks Data & AI (15-day) mission runs — every run, pass or fail. */
async function listDatabricksAiAttemptTimes(userId: string): Promise<Date[]> {
  const rows = await prisma.activityAttempt.findMany({
    where: {
      enrollment: { userId },
      activityId: { startsWith: "act_dbai_day_" },
    },
    select: { submittedAt: true, createdAt: true },
  });
  return rows.map((r) => r.submittedAt ?? r.createdAt);
}

/** LangChain & LangGraph mission runs — every run, pass or fail. */
async function listLangchainAttemptTimes(userId: string): Promise<Date[]> {
  const rows = await prisma.activityAttempt.findMany({
    where: {
      enrollment: { userId },
      activityId: { startsWith: "act_lcg_day_" },
    },
    select: { submittedAt: true, createdAt: true },
  });
  return rows.map((r) => r.submittedAt ?? r.createdAt);
}

/**
 * Every submission the hub heatmap and streak card count, across all tracks
 * the user can be in: 60-Day Challenge, AI Cohort, Databricks, DS Architect,
 * Power BI, Snowflake, Databricks Data & AI, LangChain & LangGraph.
 */
export async function listHubSubmissionTimes(
  userId: string,
): Promise<Date[]> {
  const [
    challenge,
    program,
    databricks,
    dsArchitect,
    powerBi,
    snowflake,
    databricksAi,
    langchain,
  ] = await Promise.all([
    listChallengeSubmissionTimes(userId),
    listProgramMissionTimes(userId),
    listDatabricksAttemptTimes(userId),
    listDsArchitectAttemptTimes(userId),
    listPowerBiAttemptTimes(userId),
    listSnowflakeAttemptTimes(userId),
    listDatabricksAiAttemptTimes(userId),
    listLangchainAttemptTimes(userId),
  ]);
  return [
    ...challenge,
    ...program,
    ...databricks,
    ...dsArchitect,
    ...powerBi,
    ...snowflake,
    ...databricksAi,
    ...langchain,
  ];
}

export async function listChallengeSubmissions(
  enrollmentId: string,
): Promise<ChallengeSubmissionRow[]> {
  
  const rows = await prisma.activityAttempt.findMany({
    where: {
      enrollmentId: peIdForEnrollment(enrollmentId),
      id: { startsWith: "aa_sub_" },
      activityId: { startsWith: "act_dt_" },
    },
    select: {
      id: true,
      passed: true,
      lateness: true,
      submittedAt: true,
      payload: true,
      activity: { select: { dayNumber: true } },
      evaluations: {
        where: { isAuthoritative: true },
        select: { passed: true },
        take: 1,
      },
    },
    orderBy: { submittedAt: "desc" },
  });

  const out: ChallengeSubmissionRow[] = [];
  for (const row of rows) {
    const dayNumber = row.activity.dayNumber;
    if (dayNumber == null || !row.submittedAt) continue;
    const passed = row.evaluations[0]?.passed ?? row.passed;
    if (!passed) continue;
    const payload = jsonObject(row.payload);
    const legacyId =
      typeof payload.legacySubmissionId === "string"
        ? payload.legacySubmissionId
        : row.id.slice("aa_sub_".length);
    out.push({
      id: legacyId,
      dayNumber,
      status: latenessToStatus(row.lateness),
      githubUrl: typeof payload.githubUrl === "string" ? payload.githubUrl : null,
      linkedinUrl:
        typeof payload.linkedinUrl === "string" ? payload.linkedinUrl : null,
      submittedAt: row.submittedAt,
    });
  }
  return out;
}

export async function getChallengeDaySubmission(
  enrollmentId: string,
  dayNumber: number,
): Promise<Omit<ChallengeSubmissionRow, "id" | "dayNumber"> | null> {
  
  const rows = await listChallengeSubmissions(enrollmentId);
  const row = rows.find((r) => r.dayNumber === dayNumber);
  if (!row) return null;
  return {
    status: row.status,
    githubUrl: row.githubUrl,
    linkedinUrl: row.linkedinUrl,
    submittedAt: row.submittedAt,
  };
}

export async function getChallengeCompletionState(
  enrollmentId: string,
  totalDays: number,
  status: EnrollmentStatus,
): Promise<{ daysCompleted: number; isComplete: boolean }> {
  const stats = await getChallengeProgressStats(enrollmentId);
  return {
    daysCompleted: stats.daysCompleted,
    isComplete:
      status === EnrollmentStatus.COMPLETED || stats.daysCompleted >= totalDays,
  };
}

export async function listProgramMissionProgress(
  memberId: string,
): Promise<ProgramMissionProgressRow[]> {
  
  const rows = await prisma.activityAttempt.findMany({
    where: {
      enrollmentId: peIdForMember(memberId),
      id: { startsWith: "aa_ms_" },
      activityId: { startsWith: "act_pd_" },
    },
    select: {
      passed: true,
      payload: true,
      activity: { select: { dayNumber: true } },
      evaluations: {
        where: { isAuthoritative: true },
        select: { passed: true },
        take: 1,
      },
    },
  });

  const out: ProgramMissionProgressRow[] = [];
  for (const row of rows) {
    const dayNumber = row.activity.dayNumber;
    if (dayNumber == null) continue;
    out.push({
      dayNumber,
      passed: row.evaluations[0]?.passed ?? row.passed,
      payload: row.payload,
    });
  }
  return out;
}

export async function listProgramMissionAttemptsForDay(
  memberId: string,
  dayNumber: number,
): Promise<ProgramMissionAttemptRow[]> {
  
  const rows = await prisma.activityAttempt.findMany({
    where: {
      enrollmentId: peIdForMember(memberId),
      id: { startsWith: "aa_ms_" },
      activity: { dayNumber },
      activityId: { startsWith: "act_pd_" },
    },
    select: {
      attemptNumber: true,
      passed: true,
      payload: true,
      submittedAt: true,
      createdAt: true,
      evaluations: {
        where: { isAuthoritative: true },
        select: { passed: true, detailJson: true },
        take: 1,
      },
    },
    orderBy: { attemptNumber: "asc" },
  });

  return rows.map((row) => ({
    attemptNumber: row.attemptNumber,
    passed: row.evaluations[0]?.passed ?? row.passed,
    verdict: row.evaluations[0]?.detailJson ?? null,
    payload: row.payload,
    createdAt: row.submittedAt ?? row.createdAt,
  }));
}

export type CanonicalMissionAttemptRow = {
  id: string;
  memberId: string;
  dayNumber: number;
  attemptNumber: number;
  passed: boolean;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
  pointsAwarded: number;
  aiFeedback: string | null;
};

function aiFeedbackFromPayload(
  payload: Prisma.JsonValue | null | undefined,
): string | null {
  const value = jsonObject(payload).aiFeedback;
  return typeof value === "string" ? value : null;
}

export async function listCanonicalMissionAttempts(input: {
  memberIds: string[];
}): Promise<CanonicalMissionAttemptRow[]> {
  if (input.memberIds.length === 0) return [];
  
  const rows = await prisma.activityAttempt.findMany({
    where: {
      enrollmentId: { in: input.memberIds.map((id) => peIdForMember(id)) },
      id: { startsWith: "aa_ms_" },
      activityId: { startsWith: "act_pd_" },
    },
    select: {
      id: true,
      enrollmentId: true,
      attemptNumber: true,
      passed: true,
      payload: true,
      pointsAwarded: true,
      submittedAt: true,
      createdAt: true,
      activity: { select: { dayNumber: true } },
      evaluations: {
        where: { isAuthoritative: true },
        select: { passed: true },
        take: 1,
      },
    },
    orderBy: [{ attemptNumber: "asc" }],
  });

  const out: CanonicalMissionAttemptRow[] = [];
  for (const row of rows) {
    const memberId = memberIdFromPe(row.enrollmentId);
    const dayNumber = row.activity.dayNumber;
    if (!memberId || dayNumber == null) continue;
    const id = missionSubmissionIdFromAttemptId(row.id) ?? row.id;
    out.push({
      id,
      memberId,
      dayNumber,
      attemptNumber: row.attemptNumber,
      passed: row.evaluations[0]?.passed ?? row.passed,
      payload: row.payload,
      createdAt: row.submittedAt ?? row.createdAt,
      pointsAwarded: row.pointsAwarded,
      aiFeedback: aiFeedbackFromPayload(row.payload),
    });
  }
  return out;
}

export type CanonicalChallengeFeedRow = {
  id: string;
  userId: string;
  dayNumber: number;
  status: SubmissionStatus;
  githubUrl: string | null;
  linkedinUrl: string | null;
  submittedAt: Date;
  domain: string;
};

export async function listCanonicalChallengeFeed(input: {
  domain?: string;
  status?: SubmissionStatus;
  minDay?: number;
  maxDay?: number;
  take?: number;
  submittedAtGte?: Date;
  submittedAtLt?: Date;
}): Promise<CanonicalChallengeFeedRow[]> {
  
  const rows = await prisma.activityAttempt.findMany({
    where: {
      id: { startsWith: "aa_sub_" },
      activityId: { startsWith: "act_dt_" },
      submittedAt: {
        not: null,
        ...(input.submittedAtGte ? { gte: input.submittedAtGte } : {}),
        ...(input.submittedAtLt ? { lt: input.submittedAtLt } : {}),
      },
      ...(input.status === "LATE"
        ? { lateness: "LATE" }
        : input.status === "ON_TIME"
          ? { lateness: "ON_TIME" }
          : {}),
      ...(input.minDay != null || input.maxDay != null
        ? {
            activity: {
              dayNumber: {
                ...(input.minDay != null ? { gte: input.minDay } : {}),
                ...(input.maxDay != null ? { lte: input.maxDay } : {}),
              },
            },
          }
        : {}),
    },
    orderBy: { submittedAt: "desc" },
    take: input.take ?? 5000,
    select: {
      id: true,
      enrollmentId: true,
      lateness: true,
      payload: true,
      submittedAt: true,
      enrollment: { select: { userId: true } },
      activity: { select: { dayNumber: true } },
    },
  });

  const pes = await prisma.programEnrollment.findMany({
    where: { id: { in: rows.map((row) => row.enrollmentId) } },
    select: { id: true, cohort: { select: { slug: true } } },
  });
  const domainByEnrollment = new Map<string, NonNullable<ReturnType<typeof domainFromChallengeCohortSlug>>>();
  for (const pe of pes) {
    const enrollmentId = enrollmentIdFromPe(pe.id);
    const domain = domainFromChallengeCohortSlug(pe.cohort.slug);
    if (enrollmentId && domain) domainByEnrollment.set(enrollmentId, domain);
  }

  const out: CanonicalChallengeFeedRow[] = [];
  for (const row of rows) {
    const enrollmentId = enrollmentIdFromPe(row.enrollmentId);
    const dayNumber = row.activity.dayNumber;
    if (!enrollmentId || dayNumber == null || !row.submittedAt) continue;
    const domain = domainByEnrollment.get(enrollmentId);
    if (!domain) continue;
    if (input.domain && domain !== input.domain) continue;
    const payload = jsonObject(row.payload);
    const legacyId =
      typeof payload.legacySubmissionId === "string"
        ? payload.legacySubmissionId
        : row.id.startsWith("aa_sub_")
          ? row.id.slice("aa_sub_".length)
          : row.id;
    out.push({
      id: legacyId,
      userId: row.enrollment.userId,
      dayNumber,
      status: latenessToStatus(row.lateness),
      githubUrl: typeof payload.githubUrl === "string" ? payload.githubUrl : null,
      linkedinUrl:
        typeof payload.linkedinUrl === "string" ? payload.linkedinUrl : null,
      submittedAt: row.submittedAt,
      domain,
    });
  }
  return out;
}

export async function listProgramRecentMissionAttempts(
  memberId: string,
  take: number,
): Promise<
  Array<{
    dayNumber: number;
    passed: boolean;
    verdict: Prisma.JsonValue | null;
    createdAt: Date;
    payload: unknown;
  }>
> {
  
  const rows = await prisma.activityAttempt.findMany({
    where: {
      enrollmentId: peIdForMember(memberId),
      id: { startsWith: "aa_ms_" },
      activityId: { startsWith: "act_pd_" },
    },
    select: {
      passed: true,
      payload: true,
      submittedAt: true,
      createdAt: true,
      activity: { select: { dayNumber: true } },
      evaluations: {
        where: { isAuthoritative: true },
        select: { passed: true, detailJson: true },
        take: 1,
      },
    },
    orderBy: { submittedAt: "desc" },
  });

  // Only cleared days belong in VIEW STATS, one row per day, newest first.
  // Unlike the per-track repositories this cannot filter on
  // `ActivityAttempt.passed` in the query: the authoritative evaluation is the
  // source of truth here and can disagree with the attempt row in either
  // direction, so the verdict has to be derived first and filtered after.
  const seen = new Set<number>();
  const out: Array<{
    dayNumber: number;
    passed: boolean;
    verdict: Prisma.JsonValue | null;
    createdAt: Date;
    payload: unknown;
  }> = [];
  for (const row of rows) {
    const dayNumber = row.activity.dayNumber;
    if (dayNumber == null || seen.has(dayNumber)) continue;
    const passed = row.evaluations[0]?.passed ?? row.passed;
    if (!passed) continue;
    seen.add(dayNumber);
    out.push({
      dayNumber,
      passed,
      verdict: row.evaluations[0]?.detailJson ?? null,
      createdAt: row.submittedAt ?? row.createdAt,
      payload: row.payload,
    });
    if (out.length === take) break;
  }
  return out;
}

export async function getProgramUnlockFloor(
  memberId: string,
  fallback: number,
): Promise<number> {
    const pe = await prisma.programEnrollment.findUnique({
    where: { id: peIdForMember(memberId) },
    select: { unlockFloorDay: true },
  });
  return pe?.unlockFloorDay ?? fallback;
}

export async function listQuizAttemptsForUser(
  userId: string,
  quizIds: string[],
): Promise<Array<Pick<QuizAttemptRow, "id" | "quizId" | "score" | "attemptedAt">>> {
  if (quizIds.length === 0) return [];
  
  const pes = await prisma.programEnrollment.findMany({
    where: { userId, id: { startsWith: "pe_enr_" } },
    select: { id: true },
  });
  if (pes.length === 0) return [];
  const activityIds = quizIds.map((id) => `act_quiz_${id}`);
  const rows = await prisma.activityAttempt.findMany({
    where: {
      enrollmentId: { in: pes.map((p) => p.id) },
      activityId: { in: activityIds },
    },
    select: {
      id: true,
      score: true,
      submittedAt: true,
      createdAt: true,
      activityId: true,
      payload: true,
    },
    orderBy: { submittedAt: "desc" },
  });

  return rows.flatMap((row) => {
    const quizId = quizIdFromActivity(row.activityId);
    if (!quizId) return [];
    const payload = jsonObject(row.payload);
    const legacyId =
      typeof payload.legacyQuizAttemptId === "string"
        ? payload.legacyQuizAttemptId
        : row.id.startsWith("aa_qa_")
          ? row.id.slice("aa_qa_".length)
          : row.id;
    return [
      {
        id: legacyId,
        quizId,
        score: row.score ?? 0,
        attemptedAt: row.submittedAt ?? row.createdAt,
      },
    ];
  });
}

export async function getQuizAttemptForUser(
  userId: string,
  quizId: string,
): Promise<QuizAttemptRow | null> {
  const rows = await listQuizAttemptsForUser(userId, [quizId]);
  const match = rows.find((r) => r.quizId === quizId);
  if (!match) return null;
  const attempt = await prisma.activityAttempt.findFirst({
    where: {
      id: { startsWith: "aa_qa_" },
      activityId: `act_quiz_${quizId}`,
      enrollment: { userId, id: { startsWith: "pe_enr_" } },
    },
    select: { payload: true },
  });
  const fromCanonical = answersFromPayload(attempt?.payload ?? null);
  if (Object.keys(fromCanonical).length > 0) {
    return { ...match, answers: fromCanonical };
  }
  const historical = await prisma.historicalQuizAttempt.findUnique({
    where: { legacyId: match.id },
    select: { answers: true },
  });
  return {
    ...match,
    answers: answersFromPayload(
      historical ? { answers: historical.answers } : attempt?.payload ?? null,
    ),
  };
}
