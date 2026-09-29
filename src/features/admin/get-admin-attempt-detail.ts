import "server-only";
import { prisma } from "@/lib/db";
import {
  summarizeAttemptActivity,
  type ActivitySummary,
} from "@/features/assessment-attempts/activity";
import { gradeQuestion, scoreAnswers } from "@/features/assessment-attempts/service";
import {
  MAX_EVENTS_PER_ATTEMPT,
  MAX_PARAGRAPH_WORDS,
  countWords,
} from "@/lib/validations/assessment";
import type {
  AdminAttemptDetail,
  AttemptQuestionDetail,
} from "@/features/admin/attempt-outcome";

/**
 * T-265 — one privileged read of one candidate's assessment attempt.
 *
 * Auth is the caller's job (`requireAdmin` on the page). The candidate id is in
 * the WHERE alongside the assignment id, so an assignment belonging to someone
 * else reads as null under this candidate's URL rather than rendering.
 *
 * This is the one read allowed to see the answer key. Every candidate-facing
 * type in `assessment-attempts/service.ts` deliberately excludes `isCorrect`,
 * `scorePercent` and `passed`; an admin explaining a result needs all three, and
 * the grading below is the platform's own `gradeQuestion`, not a second opinion
 * about what should have scored.
 */

const EVENT_TAKE = MAX_EVENTS_PER_ATTEMPT;

export type AdminAttemptView = {
  detail: AdminAttemptDetail;
  /** Null when the assessment was published before strict mode: nothing was recorded. */
  activity: ActivitySummary | null;
};

export async function getAdminAttemptDetail(
  candidateUserId: string,
  assignmentId: string,
  now = new Date(),
): Promise<AdminAttemptView | null> {
  const row = await prisma.recruiterAssessmentAssignment.findFirst({
    where: { id: assignmentId, candidateUserId },
    select: {
      id: true,
      candidateRef: true,
      status: true,
      assignedAt: true,
      startedAt: true,
      submittedAt: true,
      endReason: true,
      scorePercent: true,
      passed: true,
      candidate: { select: { id: true, name: true, email: true } },
      assessment: {
        select: {
          id: true,
          title: true,
          subheading: true,
          instructions: true,
          status: true,
          durationMinutes: true,
          passMarkPercent: true,
          strictMode: true,
          cameraRequired: true,
          organization: { select: { name: true } },
          createdBy: { select: { name: true } },
          questions: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              position: true,
              type: true,
              title: true,
              helpText: true,
              isRequired: true,
              points: true,
              allowMultipleCorrect: true,
              maxWords: true,
              uploadDestinationUrl: true,
              options: {
                orderBy: { position: "asc" },
                select: { id: true, body: true, isCorrect: true },
              },
            },
          },
        },
      },
      answers: {
        select: {
          questionId: true,
          selectedOptionIds: true,
          text: true,
          fileUrl: true,
          updatedAt: true,
        },
      },
      sessions: {
        orderBy: { firstSeenAt: "asc" },
        select: { clientSessionId: true, firstSeenAt: true, lastSeenAt: true },
      },
    },
  });
  if (!row) return null;

  const events = row.assessment.strictMode
    ? await prisma.assessmentAttemptEvent.findMany({
        where: { assignmentId },
        orderBy: [{ occurredAt: "asc" }, { seq: "asc" }],
        take: EVENT_TAKE,
        select: {
          sessionId: true,
          seq: true,
          type: true,
          occurredAt: true,
          questionId: true,
          count: true,
        },
      })
    : [];

  const answerByQuestion = new Map(row.answers.map((a) => [a.questionId, a]));
  const gradeInput = row.assessment.questions.map((q) => ({
    id: q.id,
    type: q.type,
    points: q.points,
    correctOptionIds: q.options.filter((o) => o.isCorrect).map((o) => o.id),
  }));
  const recount = scoreAnswers(gradeInput, row.answers);

  let correctCount = 0;
  let incorrectCount = 0;
  let noKeyCount = 0;
  let notAutoGradedCount = 0;
  let unansweredCount = 0;
  let unansweredRequiredCount = 0;
  let overWordLimitCount = 0;

  const questions: AttemptQuestionDetail[] = row.assessment.questions.map((q) => {
    const answer = answerByQuestion.get(q.id);
    const selected = new Set(answer?.selectedOptionIds ?? []);
    const outcome = gradeQuestion(
      {
        type: q.type,
        points: q.points,
        correctOptionIds: q.options.filter((o) => o.isCorrect).map((o) => o.id),
      },
      answer,
    );

    const text = q.type === "PARAGRAPH" ? (answer?.text ?? null) : null;
    const fileUrl = q.type === "FILE_UPLOAD" ? (answer?.fileUrl ?? null) : null;
    const wordCount = text != null && text.length > 0 ? countWords(text) : null;
    const maxWords = q.type === "PARAGRAPH" ? (q.maxWords ?? MAX_PARAGRAPH_WORDS) : null;
    const overWordLimit =
      wordCount != null && maxWords != null && wordCount > maxWords;

    const answered =
      q.type === "MULTIPLE_CHOICE"
        ? selected.size > 0
        : q.type === "PARAGRAPH"
          ? (text?.trim().length ?? 0) > 0
          : (fileUrl?.trim().length ?? 0) > 0;

    if (outcome.kind === "CORRECT") correctCount++;
    else if (outcome.kind === "INCORRECT") incorrectCount++;
    else if (outcome.kind === "NO_KEY") noKeyCount++;
    else notAutoGradedCount++;
    if (!answered) {
      unansweredCount++;
      if (q.isRequired) unansweredRequiredCount++;
    }
    if (overWordLimit) overWordLimitCount++;

    return {
      questionId: q.id,
      number: q.position + 1,
      type: q.type,
      title: q.title,
      helpText: q.helpText,
      isRequired: q.isRequired,
      points: q.points,
      earnedPoints: outcome.kind === "CORRECT" ? outcome.points : 0,
      outcome: outcome.kind,
      answered,
      savedAt: answer?.updatedAt ?? null,
      options: q.options.map((o) => ({
        id: o.id,
        body: o.body,
        isCorrect: o.isCorrect,
        selected: selected.has(o.id),
      })),
      text,
      wordCount,
      maxWords,
      overWordLimit,
      fileUrl,
      uploadDestinationUrl: q.uploadDestinationUrl,
    };
  });

  const detail: AdminAttemptDetail = {
    assignmentId: row.id,
    candidate: {
      userId: row.candidate.id,
      name: row.candidate.name?.trim() || row.candidate.email,
      email: row.candidate.email,
    },
    candidateRef: row.candidateRef,
    assessment: {
      id: row.assessment.id,
      title: row.assessment.title,
      subheading: row.assessment.subheading,
      instructions: row.assessment.instructions,
      status: row.assessment.status,
      durationMinutes: row.assessment.durationMinutes,
      passMarkPercent: row.assessment.passMarkPercent,
      strictMode: row.assessment.strictMode,
      cameraRequired: row.assessment.cameraRequired,
      // Plan 166: platform assessments belong to no workspace.
      organizationName: row.assessment.organization?.name ?? "ABTalks (platform)",
      createdByName: row.assessment.createdBy.name,
    },
    status: row.status,
    assignedAt: row.assignedAt,
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
    endReason: row.endReason,
    scorePercent: row.scorePercent,
    passed: row.passed,
    questions,
    grading: {
      earnedPoints: recount.earned,
      totalPoints: recount.total,
      recountedPercent: recount.scorePercent,
      autoGradedCount: correctCount + incorrectCount + noKeyCount,
      notAutoGradedCount,
      noKeyCount,
      correctCount,
      incorrectCount,
      unansweredCount,
      unansweredRequiredCount,
      overWordLimitCount,
      // A row with no stored score is reported as missing, not as disagreeing.
      matchesStoredScore:
        row.scorePercent == null || row.scorePercent === recount.scorePercent,
    },
  };

  const activity =
    row.assessment.strictMode && row.status !== "ASSIGNED"
      ? summarizeAttemptActivity({
          startedAt: row.startedAt ?? row.assignedAt,
          submittedAt: row.submittedAt,
          now,
          cameraRequired: row.assessment.cameraRequired,
          sessions: row.sessions,
          events,
          questionNumbers: Object.fromEntries(
            row.assessment.questions.map((q) => [q.id, q.position + 1]),
          ),
          eventCount: events.length,
        })
      : null;

  return { detail, activity };
}
