import "server-only";
import {
  AttemptLateness,
  EnrollmentStatus,
  SubmissionStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { isNewProgressRepoEnabled } from "@/lib/feature-flags";
import {
  peIdForEnrollment,
  peIdForMember,
  quizIdFromActivity,
} from "@/repositories/ids";

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

async function challengeCompletionFromAttempts(
  enrollmentId: string,
): Promise<{ daysCompleted: number; lastSubmittedDay: number | null }> {
  const attempts = await prisma.activityAttempt.findMany({
    where: {
      enrollmentId: peIdForEnrollment(enrollmentId),
      id: { startsWith: "aa_sub_" },
      activityId: { startsWith: "act_dt_" },
    },
    select: {
      passed: true,
      activity: { select: { dayNumber: true } },
      evaluations: {
        where: { isAuthoritative: true },
        select: { passed: true },
        take: 1,
      },
    },
  });

  const passedDays = new Set<number>();
  let lastSubmittedDay: number | null = null;
  for (const row of attempts) {
    const dayNumber = row.activity.dayNumber;
    if (dayNumber == null) continue;
    const passed = row.evaluations[0]?.passed ?? row.passed;
    if (!passed) continue;
    passedDays.add(dayNumber);
    if (lastSubmittedDay == null || dayNumber > lastSubmittedDay) {
      lastSubmittedDay = dayNumber;
    }
  }
  return { daysCompleted: passedDays.size, lastSubmittedDay };
}

/**
 * Phase 6: completed days come from attempts. Track streak stays the
 * Enrollment.currentStreak / longestStreak snapshot written on submit.
 * Live-recomputing streak is a separate product decision (Phase 7).
 */
export async function getChallengeProgressStats(
  enrollmentId: string,
): Promise<ChallengeProgressStats> {
  const snapshot = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      daysCompleted: true,
      currentStreak: true,
      longestStreak: true,
      lastSubmittedDay: true,
    },
  });
  const streaks = {
    currentStreak: snapshot?.currentStreak ?? 0,
    longestStreak: snapshot?.longestStreak ?? 0,
  };
  if (!isNewProgressRepoEnabled()) {
    return {
      daysCompleted: snapshot?.daysCompleted ?? 0,
      lastSubmittedDay: snapshot?.lastSubmittedDay ?? null,
      ...streaks,
    };
  }
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
  if (!isNewProgressRepoEnabled() || rows.length === 0) return rows;
  return Promise.all(
    rows.map(async (row) => {
      const derived = await challengeCompletionFromAttempts(row.id);
      return {
        ...row,
        daysCompleted: derived.daysCompleted,
        lastSubmittedDay: derived.lastSubmittedDay,
      };
    }),
  );
}

export async function listHubSubmissionTimes(
  userId: string,
): Promise<Date[]> {
  if (!isNewProgressRepoEnabled()) {
    const rows = await prisma.submission.findMany({
      where: { enrollment: { userId } },
      select: { submittedAt: true },
    });
    return rows.map((r) => r.submittedAt);
  }

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

export async function listChallengeSubmissions(
  enrollmentId: string,
): Promise<ChallengeSubmissionRow[]> {
  if (!isNewProgressRepoEnabled()) {
    return prisma.submission.findMany({
      where: { enrollmentId },
      orderBy: { submittedAt: "desc" },
      select: {
        id: true,
        dayNumber: true,
        status: true,
        githubUrl: true,
        linkedinUrl: true,
        submittedAt: true,
      },
    });
  }

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
  if (!isNewProgressRepoEnabled()) {
    const row = await prisma.submission.findUnique({
      where: { enrollmentId_dayNumber: { enrollmentId, dayNumber } },
      select: {
        status: true,
        githubUrl: true,
        linkedinUrl: true,
        submittedAt: true,
      },
    });
    return row;
  }

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
  if (!isNewProgressRepoEnabled()) {
    return prisma.programMissionSubmission.findMany({
      where: { memberId },
      select: { dayNumber: true, passed: true, payload: true },
    });
  }

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
  if (!isNewProgressRepoEnabled()) {
    return prisma.programMissionSubmission.findMany({
      where: { memberId, dayNumber },
      select: {
        attemptNumber: true,
        passed: true,
        verdict: true,
        payload: true,
        createdAt: true,
      },
      orderBy: { attemptNumber: "asc" },
    });
  }

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
  if (!isNewProgressRepoEnabled()) {
    return prisma.programMissionSubmission.findMany({
      where: { memberId },
      select: {
        dayNumber: true,
        passed: true,
        verdict: true,
        createdAt: true,
        payload: true,
      },
      orderBy: { createdAt: "desc" },
      take,
    });
  }

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
    take,
  });

  return rows.flatMap((row) => {
    const dayNumber = row.activity.dayNumber;
    if (dayNumber == null) return [];
    return [
      {
        dayNumber,
        passed: row.evaluations[0]?.passed ?? row.passed,
        verdict: row.evaluations[0]?.detailJson ?? null,
        createdAt: row.submittedAt ?? row.createdAt,
        payload: row.payload,
      },
    ];
  });
}

export async function getProgramUnlockFloor(
  memberId: string,
  fallback: number,
): Promise<number> {
  if (!isNewProgressRepoEnabled()) return fallback;
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
  if (!isNewProgressRepoEnabled()) {
    return prisma.quizAttempt.findMany({
      where: { userId, quizId: { in: quizIds } },
      select: { id: true, score: true, quizId: true, attemptedAt: true },
      orderBy: { attemptedAt: "desc" },
    });
  }

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
  if (!isNewProgressRepoEnabled()) {
    const row = await prisma.quizAttempt.findUnique({
      where: { userId_quizId: { userId, quizId } },
      select: { id: true, quizId: true, score: true, answers: true, attemptedAt: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      quizId: row.quizId,
      score: row.score,
      answers: (row.answers as Record<string, string>) ?? {},
      attemptedAt: row.attemptedAt,
    };
  }

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
  return {
    ...match,
    answers: answersFromPayload(attempt?.payload ?? null),
  };
}
