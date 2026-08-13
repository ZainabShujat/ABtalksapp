import "server-only";
import { prisma } from "@/lib/db";
import { MAX_CHALLENGE_TASKS_IN_CONTEXT } from "@/features/interview/constants";
import type {
  ChallengeContext,
  CompletedChallengeTask,
} from "@/features/interview/types";

/**
 * Ranks a completed task by how much interview signal it carries. Proof-of-work
 * links mean the candidate can be asked about something a reviewer could verify,
 * so those rank highest.
 */
function taskSignalScore(task: CompletedChallengeTask): number {
  let score = 0;
  if (task.hasGithubProof) score += 3;
  if (task.hasLinkedinProof) score += 1;
  if (task.difficulty.toLowerCase() === "hard") score += 2;
  else if (task.difficulty.toLowerCase() === "medium") score += 1;
  if (task.learningObjectives.length > 0) score += 1;
  if (task.tags.length > 0) score += 1;
  return score;
}

/**
 * Spreads picks across enrollments and across the timeline so a multi-challenge
 * candidate isn't interviewed entirely on one track's early days.
 */
function selectTasksForContext(
  tasks: CompletedChallengeTask[],
  limit: number,
): CompletedChallengeTask[] {
  const byEnrollment = new Map<string, CompletedChallengeTask[]>();
  for (const task of tasks) {
    const bucket = byEnrollment.get(task.enrollmentId);
    if (bucket) bucket.push(task);
    else byEnrollment.set(task.enrollmentId, [task]);
  }

  for (const bucket of byEnrollment.values()) {
    bucket.sort((a, b) => {
      const diff = taskSignalScore(b) - taskSignalScore(a);
      return diff !== 0 ? diff : b.dayNumber - a.dayNumber;
    });
  }

  const selected: CompletedChallengeTask[] = [];
  const buckets = [...byEnrollment.values()];
  let round = 0;
  while (selected.length < limit) {
    let tookAny = false;
    for (const bucket of buckets) {
      const task = bucket[round];
      if (!task) continue;
      selected.push(task);
      tookAny = true;
      if (selected.length >= limit) break;
    }
    if (!tookAny) break;
    round++;
  }

  return selected.sort((a, b) => a.dayNumber - b.dayNumber);
}

/**
 * Builds verified challenge context for a candidate.
 *
 * A day is assessable only when a Submission row exists for it — there is no
 * partial-completion state in the challenge schema. A student 30 days into a
 * 60-day challenge therefore yields exactly 30 eligible tasks, and unsubmitted
 * days are never visible to the question planner.
 */
export async function buildChallengeContext(
  userId: string,
): Promise<ChallengeContext> {
  const [enrollments, submissions] = await Promise.all([
    prisma.enrollment.findMany({
      where: { userId },
      select: {
        id: true,
        challengeId: true,
        domain: true,
        status: true,
        currentStreak: true,
        longestStreak: true,
        challenge: { select: { title: true, totalDays: true } },
      },
    }),
    prisma.submission.findMany({
      where: { userId },
      select: {
        id: true,
        enrollmentId: true,
        dayNumber: true,
        githubUrl: true,
        linkedinUrl: true,
        submittedAt: true,
        dailyTask: {
          select: {
            id: true,
            challengeId: true,
            title: true,
            problemStatement: true,
            learningObjectives: true,
            tags: true,
            difficulty: true,
          },
        },
      },
      orderBy: { dayNumber: "asc" },
    }),
  ]);

  const enrollmentById = new Map(enrollments.map((e) => [e.id, e]));

  const tasks: CompletedChallengeTask[] = submissions.map((s) => {
    const enrollment = enrollmentById.get(s.enrollmentId);
    return {
      submissionId: s.id,
      enrollmentId: s.enrollmentId,
      challengeId: s.dailyTask.challengeId,
      domain: enrollment?.domain ?? "",
      challengeTitle: enrollment?.challenge.title ?? "",
      dayNumber: s.dayNumber,
      dailyTaskId: s.dailyTask.id,
      title: s.dailyTask.title,
      problemStatement: s.dailyTask.problemStatement,
      learningObjectives: s.dailyTask.learningObjectives,
      tags: s.dailyTask.tags,
      difficulty: s.dailyTask.difficulty,
      hasGithubProof: Boolean(s.githubUrl),
      hasLinkedinProof: Boolean(s.linkedinUrl),
      submittedAt: s.submittedAt,
    };
  });

  const completedPerEnrollment = new Map<string, number>();
  for (const task of tasks) {
    completedPerEnrollment.set(
      task.enrollmentId,
      (completedPerEnrollment.get(task.enrollmentId) ?? 0) + 1,
    );
  }

  return {
    enrollments: enrollments.map((e) => ({
      enrollmentId: e.id,
      challengeId: e.challengeId,
      domain: e.domain,
      title: e.challenge.title,
      status: e.status,
      totalDays: e.challenge.totalDays,
      completedDays: completedPerEnrollment.get(e.id) ?? 0,
      currentStreak: e.currentStreak,
      longestStreak: e.longestStreak,
    })),
    tasks: selectTasksForContext(tasks, MAX_CHALLENGE_TASKS_IN_CONTEXT),
    totalCompletedDays: tasks.length,
    completedSubmissionIds: tasks.map((t) => t.submissionId),
  };
}
