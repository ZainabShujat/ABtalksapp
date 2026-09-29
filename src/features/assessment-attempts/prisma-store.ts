import "server-only";

import { Prisma } from "@prisma/client";
import { prisma, writeClient } from "@/lib/db";
import type {
  AttemptListRow,
  AttemptRow,
  AttemptStore,
  EventContext,
  EventWrite,
  SubmitOutcome,
} from "./service";

/**
 * The real T-218 store.
 *
 * Reads use `prisma`; every write uses `writeClient()` — the direct Neon
 * endpoint while dual-write is on, which is what interactive transactions need.
 *
 * Every guarded `updateMany` filters on RecruiterAssessmentAssignment's own
 * columns only (id, candidateUserId, status). A relation filter there could be
 * executed as a read followed by an update-by-id, which would lose the
 * atomicity the guard exists for.
 */

const ANSWER_SELECT = {
  questionId: true,
  selectedOptionIds: true,
  text: true,
  fileUrl: true,
} as const;

/** Thrown inside the submit transaction to roll the SUBMITTED flip back. */
class IncompleteSubmission extends Error {
  constructor(
    readonly missingRequired: number,
    readonly overLimit: number,
  ) {
    super("incomplete submission");
  }
}

export function prismaAttemptStore(): AttemptStore {
  return {
    async findAttempt(assignmentId, candidateUserId): Promise<AttemptRow | null> {
      // candidateUserId is in the WHERE, so someone else's id reads as null.
      // The answer key, the score and the result are never selected here.
      const a = await prisma.recruiterAssessmentAssignment.findFirst({
        where: { id: assignmentId, candidateUserId },
        select: {
          id: true,
          status: true,
          startedAt: true,
          submittedAt: true,
          endReason: true,
          assessment: {
            select: {
              status: true,
              source: true,
              deadlineAt: true,
              title: true,
              subheading: true,
              instructions: true,
              durationMinutes: true,
              passMarkPercent: true,
              strictMode: true,
              cameraRequired: true,
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
                    select: { id: true, position: true, body: true },
                  },
                },
              },
            },
          },
          answers: { select: ANSWER_SELECT },
        },
      });
      if (!a) return null;
      return {
        assignmentId: a.id,
        status: a.status,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt,
        endReason: a.endReason,
        assessment: {
          status: a.assessment.status,
          source: a.assessment.source,
          closesAt: a.assessment.source === "PLATFORM" ? a.assessment.deadlineAt : null,
          title: a.assessment.title,
          subheading: a.assessment.subheading,
          instructions: a.assessment.instructions,
          durationMinutes: a.assessment.durationMinutes,
          passMarkPercent: a.assessment.passMarkPercent,
          strictMode: a.assessment.strictMode,
          cameraRequired: a.assessment.cameraRequired,
        },
        questions: a.assessment.questions,
        answers: a.answers,
      };
    },

    async listAttempts(candidateUserId): Promise<AttemptListRow[]> {
      const rows = await prisma.recruiterAssessmentAssignment.findMany({
        where: { candidateUserId, assessment: { status: "PUBLISHED" } },
        orderBy: { assignedAt: "desc" },
        select: {
          id: true,
          status: true,
          assignedAt: true,
          startedAt: true,
          submittedAt: true,
          assessment: {
            select: {
              title: true,
              subheading: true,
              source: true,
              deadlineAt: true,
              durationMinutes: true,
              strictMode: true,
              cameraRequired: true,
              _count: { select: { questions: true } },
            },
          },
        },
      });
      return rows.map((r) => ({
        assignmentId: r.id,
        title: r.assessment.title,
        subheading: r.assessment.subheading,
        source: r.assessment.source,
        status: r.status,
        assignedAt: r.assignedAt,
        startedAt: r.startedAt,
        submittedAt: r.submittedAt,
        closesAt: r.assessment.source === "PLATFORM" ? r.assessment.deadlineAt : null,
        durationMinutes: r.assessment.durationMinutes,
        questionCount: r.assessment._count.questions,
        strictMode: r.assessment.strictMode,
        cameraRequired: r.assessment.cameraRequired,
      }));
    },

    async listStartedPastClose(assessmentId, now) {
      const rows = await prisma.recruiterAssessmentAssignment.findMany({
        where: {
          assessmentId,
          status: "STARTED",
          assessment: { source: "PLATFORM", deadlineAt: { lte: now } },
        },
        select: {
          id: true,
          candidateUserId: true,
          assessment: { select: { deadlineAt: true } },
        },
      });
      return rows.flatMap((r) =>
        r.assessment.deadlineAt
          ? [
              {
                assignmentId: r.id,
                candidateUserId: r.candidateUserId,
                closesAt: r.assessment.deadlineAt,
              },
            ]
          : [],
      );
    },

    async start(assignmentId, candidateUserId, at) {
      const res = await writeClient().recruiterAssessmentAssignment.updateMany({
        where: { id: assignmentId, candidateUserId, status: "ASSIGNED" },
        data: { status: "STARTED", startedAt: at },
      });
      return res.count === 1;
    },

    async saveAnswer(assignmentId, candidateUserId, questionId, value) {
      return writeClient().$transaction(async (tx) => {
        // Takes the assignment row lock and re-checks the guard in one
        // statement. A concurrent submit either committed first (this matches
        // 0 rows) or waits for this transaction to commit — so no answer can
        // land after a submission.
        const open = await tx.recruiterAssessmentAssignment.updateMany({
          where: { id: assignmentId, candidateUserId, status: "STARTED" },
          data: { status: "STARTED" },
        });
        if (open.count !== 1) return "NOT_OPEN" as const;
        await tx.assessmentAnswer.upsert({
          where: { assignmentId_questionId: { assignmentId, questionId } },
          create: {
            assignmentId,
            questionId,
            selectedOptionIds: value.selectedOptionIds,
            text: value.text,
            fileUrl: value.fileUrl,
          },
          update: {
            selectedOptionIds: value.selectedOptionIds,
            text: value.text,
            fileUrl: value.fileUrl,
          },
          select: { id: true },
        });
        return "SAVED" as const;
      });
    },

    async submit(assignmentId, candidateUserId, at, finish): Promise<SubmitOutcome> {
      try {
        return await writeClient().$transaction(async (tx) => {
          // The TC-C-013 guard (plan 128 §10). A second submit matches 0 rows.
          const flipped = await tx.recruiterAssessmentAssignment.updateMany({
            where: {
              id: assignmentId,
              candidateUserId,
              status: { in: ["ASSIGNED", "STARTED"] },
            },
            data: { status: "SUBMITTED", submittedAt: at, endReason: "SUBMITTED" },
          });
          if (flipped.count !== 1) return { outcome: "NOT_OPEN" as const };

          // Under the row lock the flip took: no save can land between this
          // read and the commit. The answer key is read here and nowhere else.
          const a = await tx.recruiterAssessmentAssignment.findUniqueOrThrow({
            where: { id: assignmentId },
            select: {
              assessment: {
                select: {
                  passMarkPercent: true,
                  questions: {
                    select: {
                      id: true,
                      type: true,
                      points: true,
                      isRequired: true,
                      maxWords: true,
                      options: {
                        where: { isCorrect: true },
                        select: { id: true },
                      },
                    },
                  },
                },
              },
              answers: { select: ANSWER_SELECT },
            },
          });

          const result = finish({
            passMarkPercent: a.assessment.passMarkPercent,
            answers: a.answers,
            questions: a.assessment.questions.map((q) => ({
              id: q.id,
              type: q.type,
              points: q.points,
              isRequired: q.isRequired,
              maxWords: q.maxWords,
              correctOptionIds: q.options.map((o) => o.id),
            })),
          });
          if (!result.ok) {
            // Throwing rolls the flip back: the attempt stays STARTED.
            throw new IncompleteSubmission(result.missingRequired, result.overLimit);
          }

          await tx.recruiterAssessmentAssignment.update({
            where: { id: assignmentId },
            data: { scorePercent: result.scorePercent, passed: result.passed },
            select: { id: true },
          });
          return { outcome: "SUBMITTED" as const };
        });
      } catch (error) {
        if (error instanceof IncompleteSubmission) {
          return {
            outcome: "INCOMPLETE",
            missingRequired: error.missingRequired,
            overLimit: error.overLimit,
          };
        }
        throw error;
      }
    },

    async submitForced(assignmentId, candidateUserId, at, finish, reason) {
      const existing = await prisma.recruiterAssessmentAssignment.findFirst({
        where: { id: assignmentId, candidateUserId },
        select: { status: true },
      });
      if (!existing) return { outcome: "NOT_OPEN" as const };
      if (existing.status === "SUBMITTED") return { outcome: "ALREADY" as const };

      // STARTED only — ASSIGNED is refused by the service before this runs.
      try {
        return await writeClient().$transaction(async (tx) => {
          const flipped = await tx.recruiterAssessmentAssignment.updateMany({
            where: {
              id: assignmentId,
              candidateUserId,
              status: "STARTED",
            },
            data: { status: "SUBMITTED", submittedAt: at, endReason: reason },
          });
          if (flipped.count !== 1) return { outcome: "NOT_OPEN" as const };

          const a = await tx.recruiterAssessmentAssignment.findUniqueOrThrow({
            where: { id: assignmentId },
            select: {
              assessment: {
                select: {
                  passMarkPercent: true,
                  questions: {
                    select: {
                      id: true,
                      type: true,
                      points: true,
                      isRequired: true,
                      maxWords: true,
                      options: {
                        where: { isCorrect: true },
                        select: { id: true },
                      },
                    },
                  },
                },
              },
              answers: { select: ANSWER_SELECT },
            },
          });

          const result = finish({
            passMarkPercent: a.assessment.passMarkPercent,
            answers: a.answers,
            questions: a.assessment.questions.map((q) => ({
              id: q.id,
              type: q.type,
              points: q.points,
              isRequired: q.isRequired,
              maxWords: q.maxWords,
              correctOptionIds: q.options.map((o) => o.id),
            })),
          });
          if (!result.ok) {
            throw new IncompleteSubmission(result.missingRequired, result.overLimit);
          }

          await tx.recruiterAssessmentAssignment.update({
            where: { id: assignmentId },
            data: { scorePercent: result.scorePercent, passed: result.passed },
            select: { id: true },
          });
          return { outcome: "SUBMITTED" as const };
        });
      } catch (error) {
        if (error instanceof IncompleteSubmission) {
          return {
            outcome: "INCOMPLETE" as const,
            missingRequired: error.missingRequired,
            overLimit: error.overLimit,
          };
        }
        throw error;
      }
    },

    async countStrikes(assignmentId, candidateUserId) {
      const owned = await prisma.recruiterAssessmentAssignment.findFirst({
        where: { id: assignmentId, candidateUserId },
        select: { id: true },
      });
      if (!owned) return { tabSwitches: 0, fullscreenExits: 0 };
      const groups = await prisma.assessmentAttemptEvent.groupBy({
        by: ["type"],
        where: {
          assignmentId,
          type: { in: ["VISIBILITY_VISIBLE", "FULLSCREEN_EXITED"] },
        },
        _count: { _all: true },
      });
      const count = (type: string) => groups.find((g) => g.type === type)?._count._all ?? 0;
      return {
        tabSwitches: count("VISIBILITY_VISIBLE"),
        fullscreenExits: count("FULLSCREEN_EXITED"),
      };
    },

    async findEventContext(assignmentId, candidateUserId, clientSessionId): Promise<EventContext | null> {
      const a = await prisma.recruiterAssessmentAssignment.findFirst({
        where: { id: assignmentId, candidateUserId },
        select: {
          status: true,
          startedAt: true,
          submittedAt: true,
          assessment: {
            select: {
              status: true,
              strictMode: true,
              cameraRequired: true,
              questions: { select: { id: true, type: true } },
            },
          },
        },
      });
      if (!a) return null;
      const [eventCount, session, sessionCount] = await Promise.all([
        prisma.assessmentAttemptEvent.count({ where: { assignmentId } }),
        prisma.assessmentAttemptSession.findUnique({
          where: {
            assignmentId_clientSessionId: { assignmentId, clientSessionId },
          },
          select: { id: true },
        }),
        prisma.assessmentAttemptSession.count({ where: { assignmentId } }),
      ]);
      return {
        status: a.status,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt,
        assessment: a.assessment,
        eventCount,
        sessionExists: session !== null,
        sessionCount,
      };
    },

    async writeEventBatch(assignmentId, clientSessionId, receivedAt, events: EventWrite[]) {
      const data = events.map((e) => ({
        seq: e.seq,
        type: e.type,
        occurredAt: e.occurredAt,
        clientOccurredAt: e.clientOccurredAt,
        receivedAt: e.receivedAt,
        questionId: e.questionId,
        count: e.count,
      }));
      const nested = data.length > 0 ? { createMany: { data, skipDuplicates: true } } : undefined;
      const write = () =>
        writeClient().assessmentAttemptSession.upsert({
          where: { assignmentId_clientSessionId: { assignmentId, clientSessionId } },
          create: {
            assignmentId,
            clientSessionId,
            firstSeenAt: receivedAt,
            lastSeenAt: receivedAt,
            events: nested,
          },
          update: { lastSeenAt: receivedAt, events: nested },
          select: { id: true },
        });
      try {
        await write();
      } catch (error) {
        // Two first batches from one page raced to create the session: the loser retries as an update.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          await write();
          return;
        }
        throw error;
      }
    },
  };
}
