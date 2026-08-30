import { SubmissionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { listChallengeSubmissions } from "@/repositories/progress";
import { readDayNumberFromMetadata } from "@/lib/admin-action-metadata";
import {
  getCurrentDayNumber,
  getElapsedDayNumber,
  getIstDateKeyForChallengeDay,
} from "@/lib/date-utils";
import { isWithinRelaxationWindow } from "@/features/submission/submit-day";
import {
  getDailyTaskTitlesLive,
  getDailyTasksCached,
} from "@/features/challenge/get-daily-tasks-cached";

/** Pre-resolved enrollment the dashboard can thread in to avoid a re-query. */
type ResolvedHeatmapEnrollment = {
  startedAt: Date;
  challengeId: string;
  userId: string;
  challenge: { startsAt: Date | null };
};

/** Pre-fetched submissions the dashboard can thread in (one query, reused). */
type HeatmapSubmission = {
  dayNumber: number;
  status: SubmissionStatus;
  githubUrl: string | null;
  linkedinUrl: string | null;
  submittedAt: Date;
};

export type HeatmapCellStatus =
  | "on_time"
  | "late"
  | "future"
  | "missed"
  | "rejected";

export type HeatmapCell = {
  dayNumber: number;
  date: string;
  status: HeatmapCellStatus;
  /** Past missed day inside the 5-day relaxation window (today + previous 4). */
  isRelaxable: boolean;
  /** Daily task metadata when the challenge defines this day */
  taskTitle: string | null;
  problemStatement: string | null;
  learningObjectives: string[];
  resources: string[];
  tags: string[];
  difficulty: string | null;
  estimatedMinutes: number | null;
  /** Submission fields when this day was submitted (on_time / late) */
  githubUrl: string | null;
  linkedinUrl: string | null;
  /** ISO timestamp for display */
  submittedAt: string | null;
  adminName: string | null;
  actionReason: string | null;
  actionAt: string | null;
};

export async function getHeatmapData(
  enrollmentId: string,
  options?: {
    includeSubmissionDetails?: boolean;
    viewerUserId?: string;
    /** Pre-resolved enrollment (dashboard); skips the enrollment query when provided. */
    enrollment?: ResolvedHeatmapEnrollment;
    /** Pre-fetched submissions (dashboard); skips the submissions query when provided. */
    submissions?: HeatmapSubmission[];
  },
): Promise<HeatmapCell[]> {
  const includeSubmissionDetails = options?.includeSubmissionDetails ?? true;
  const viewerUserId = options?.viewerUserId;

  const enrollment =
    options?.enrollment ??
    (viewerUserId
      ? await prisma.enrollment.findFirst({
          where: { id: enrollmentId, userId: viewerUserId },
          select: {
            startedAt: true,
            challengeId: true,
            userId: true,
            challenge: { select: { startsAt: true } },
          },
        })
      : await prisma.enrollment.findUnique({
          where: { id: enrollmentId },
          select: {
            startedAt: true,
            challengeId: true,
            userId: true,
            challenge: { select: { startsAt: true } },
          },
        }));

  if (!enrollment) {
    return [];
  }

  const submissionsPromise: Promise<HeatmapSubmission[]> = options?.submissions
    ? Promise.resolve(options.submissions)
    : listChallengeSubmissions(enrollmentId).then((rows) =>
        rows.map((s) => ({
          dayNumber: s.dayNumber,
          status: s.status,
          githubUrl: includeSubmissionDetails ? s.githubUrl : null,
          linkedinUrl: includeSubmissionDetails ? s.linkedinUrl : null,
          submittedAt: s.submittedAt,
        })),
      );

  const [submissions, tasks, titleByDay, adminActions] = await Promise.all([
    submissionsPromise,
    getDailyTasksCached(enrollment.challengeId),
    getDailyTaskTitlesLive(enrollment.challengeId),
    prisma.adminAction.findMany({
      where: {
        targetUserId: enrollment.userId,
        actionType: "REJECT_SUBMISSION",
      },
      orderBy: { createdAt: "desc" },
      select: {
        actionType: true,
        metadata: true,
        reason: true,
        createdAt: true,
        admin: {
          select: {
            name: true,
            email: true,
            studentProfile: { select: { fullName: true } },
          },
        },
      },
    }),
  ]);

  const byDay = new Map<
    number,
    {
      status: SubmissionStatus;
      githubUrl: string | null;
      linkedinUrl: string | null;
      submittedAt: Date;
    }
  >();
  for (const s of submissions) {
    byDay.set(s.dayNumber, {
      status: s.status,
      githubUrl: s.githubUrl ?? null,
      linkedinUrl: s.linkedinUrl ?? null,
      submittedAt: s.submittedAt,
    });
  }

  const taskByDay = new Map<
    number,
    {
      title: string;
      problemStatement: string;
      learningObjectives: string[];
      resources: string[];
      tags: string[];
      difficulty: string;
      estimatedMinutes: number;
    }
  >();
  for (const t of tasks) {
    taskByDay.set(t.dayNumber, {
      title: titleByDay.get(t.dayNumber) ?? "",
      problemStatement: t.problemStatement,
      learningObjectives: t.learningObjectives ?? [],
      resources: t.resources ?? [],
      tags: t.tags ?? [],
      difficulty: t.difficulty,
      estimatedMinutes: t.estimatedMinutes,
    });
  }

  const rejectActionByDay = new Map<
    number,
    { reason: string | null; createdAt: Date; adminName: string }
  >();
  for (const action of adminActions) {
    const dayNumber = readDayNumberFromMetadata(action.metadata);
    if (!dayNumber || dayNumber < 1 || dayNumber > 60) continue;
    const adminName =
      action.admin.studentProfile?.fullName?.trim() ||
      action.admin.name?.trim() ||
      action.admin.email;
    if (!rejectActionByDay.has(dayNumber)) {
      rejectActionByDay.set(dayNumber, {
        reason: action.reason ?? null,
        createdAt: action.createdAt,
        adminName,
      });
    }
  }

  const currentDay = getCurrentDayNumber(enrollment, enrollment.challenge);
  const elapsedDay = getElapsedDayNumber(enrollment, enrollment.challenge);
  const out: HeatmapCell[] = [];

  for (let dayNumber = 1; dayNumber <= 60; dayNumber++) {
    const date = getIstDateKeyForChallengeDay(
      enrollment,
      dayNumber,
      enrollment.challenge,
    );
    const row = byDay.get(dayNumber);
    const task = taskByDay.get(dayNumber);

    let status: HeatmapCellStatus = "future";
    const rejectAction = rejectActionByDay.get(dayNumber);

    if (row) {
      status =
        row.status === SubmissionStatus.ON_TIME ||
        row.status === SubmissionStatus.LATE
          ? "on_time"
          : "late";
    } else if (rejectAction) {
      status = "rejected";
    } else if (dayNumber >= currentDay) {
      // Strictly future days, OR today with no submission yet (same gray as future)
      status = "future";
    } else {
      status = "missed";
    }

    const hasSubmission = status === "on_time" || status === "late";
    const action = status === "rejected" ? rejectAction : null;
    const isRelaxable =
      status === "missed" && isWithinRelaxationWindow(elapsedDay, dayNumber);

    out.push({
      dayNumber,
      date,
      status,
      isRelaxable,
      taskTitle: task?.title ?? null,
      problemStatement: task?.problemStatement ?? null,
      learningObjectives: task?.learningObjectives ?? [],
      resources: task?.resources ?? [],
      tags: task?.tags ?? [],
      difficulty: task?.difficulty ?? null,
      estimatedMinutes: task?.estimatedMinutes ?? null,
      githubUrl:
        includeSubmissionDetails && hasSubmission && row ? row.githubUrl : null,
      linkedinUrl:
        includeSubmissionDetails && hasSubmission && row ? row.linkedinUrl : null,
      submittedAt:
        hasSubmission && row ? row.submittedAt.toISOString() : null,
      adminName: action?.adminName ?? null,
      actionReason: action?.reason ?? null,
      actionAt: action?.createdAt?.toISOString() ?? null,
    });
  }

  return out;
}
