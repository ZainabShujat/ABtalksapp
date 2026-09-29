import "server-only";

import { prisma } from "@/lib/db";
import { getShortlist } from "@/features/talent-pool/pool";
import { listProjectShortlistForProject } from "@/features/hire/project-shortlist";
import { encodeCandidateRef, refPublicId } from "@/features/hire/candidate-ref";
import { filterSearchableUserIds } from "@/repositories/talent";
import { listUserDisplayNames } from "@/repositories/hire";
import {
  MAX_EVENTS_PER_ATTEMPT,
  MAX_EVENTS_PER_BATCH,
} from "@/lib/validations/assessment";
import type {
  AssessmentListStoreRow,
  AssessmentQuestionRow,
  AssessmentRow,
  AssessmentStore,
  AssignableCandidate,
  AssignmentRow,
  AttemptActivityRow,
  ContentInput,
  ResultCounts,
  Scope,
} from "./service";

const OPTION_SELECT = {
  id: true,
  position: true,
  body: true,
  isCorrect: true,
} as const;

const QUESTION_SELECT = {
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
  sectionId: true,
  options: {
    orderBy: { position: "asc" as const },
    select: OPTION_SELECT,
  },
} as const;

const ASSESSMENT_SELECT = {
  id: true,
  organizationId: true,
  createdByUserId: true,
  title: true,
  subheading: true,
  instructions: true,
  status: true,
  durationMinutes: true,
  passMarkPercent: true,
  strictMode: true,
  cameraRequired: true,
  shortlistRefs: true,
  publishedAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  questions: {
    orderBy: { position: "asc" as const },
    select: QUESTION_SELECT,
  },
} as const;

const LIST_SELECT = {
  id: true,
  title: true,
  status: true,
  durationMinutes: true,
  passMarkPercent: true,
  updatedAt: true,
  _count: { select: { questions: true } },
} as const;

function scopeWhere(scope: Scope) {
  return {
    organizationId: scope.organizationId,
    createdByUserId: scope.createdByUserId,
  };
}

/**
 * Build the nested-create payload for one question (without `assessmentId` — it
 * is implied by nesting under the parent create/update). Nesting the whole tree
 * into a single `create`/`update` avoids an interactive `$transaction`, which
 * the Neon serverless driver cannot hold across many sequential statements.
 * Exported for plan 166: platform assessments share the same question tables.
 */
export function questionCreateNested(
  q: ContentInput["questions"][number],
  position: number,
) {
  const base = {
    position,
    type: q.type,
    title: q.title,
    helpText: q.helpText ?? null,
    isRequired: q.isRequired,
    points: q.points,
    sectionId: null,
  };
  if (q.type === "MULTIPLE_CHOICE") {
    return {
      ...base,
      allowMultipleCorrect: q.allowMultipleCorrect,
      maxWords: null,
      uploadDestinationUrl: null,
      options: {
        create: q.options.map((o, j) => ({
          position: j,
          body: o.body,
          isCorrect: o.isCorrect,
        })),
      },
    };
  }
  if (q.type === "PARAGRAPH") {
    return {
      ...base,
      allowMultipleCorrect: false,
      maxWords: q.maxWords,
      uploadDestinationUrl: null,
    };
  }
  return {
    ...base,
    allowMultipleCorrect: false,
    maxWords: null,
    uploadDestinationUrl: q.uploadDestinationUrl,
  };
}

export function prismaAssessmentStore(): AssessmentStore {
  return {
    async create(scope, input) {
      // Single nested create: assessment + questions + options in one atomic
      // statement — no interactive transaction (Neon-safe).
      const row = await prisma.recruiterAssessment.create({
        data: {
          organizationId: scope.organizationId,
          createdByUserId: scope.createdByUserId,
          title: input.title,
          subheading: input.subheading,
          instructions: input.instructions,
          status: "DRAFT",
          durationMinutes: input.durationMinutes,
          passMarkPercent: input.passMarkPercent,
          cameraRequired: input.cameraRequired,
          shortlistRefs: input.shortlistRefs,
          questions: {
            create: input.questions.map((q, i) => questionCreateNested(q, i)),
          },
        },
        select: { id: true },
      });
      return { id: row.id };
    },

    async replaceContent(assessmentId, scope, input) {
      // Ownership check (read), then a single atomic update that clears and
      // recreates the question tree via nested writes — no interactive tx.
      const owned = await prisma.recruiterAssessment.findFirst({
        where: { id: assessmentId, ...scopeWhere(scope) },
        select: { id: true },
      });
      if (!owned) throw new Error("Assessment not found for replace");

      await prisma.recruiterAssessment.update({
        where: { id: assessmentId },
        data: {
          title: input.title,
          subheading: input.subheading,
          instructions: input.instructions,
          durationMinutes: input.durationMinutes,
          passMarkPercent: input.passMarkPercent,
          shortlistRefs: input.shortlistRefs,
          cameraRequired: input.cameraRequired,
          questions: {
            deleteMany: {},
            create: input.questions.map((q, i) => questionCreateNested(q, i)),
          },
        },
        select: { id: true },
      });
    },

    async findOwned(assessmentId, scope): Promise<AssessmentRow | null> {
      const row = await prisma.recruiterAssessment.findFirst({
        where: { id: assessmentId, ...scopeWhere(scope) },
        select: ASSESSMENT_SELECT,
      });
      if (!row) return null;
      return {
        ...row,
        // Matched on scopeWhere, so it is the workspace's own id (plan 166
        // made the column nullable for platform rows, which never match).
        organizationId: scope.organizationId,
        questions: row.questions as AssessmentQuestionRow[],
      };
    },

    async listOwned(scope): Promise<AssessmentListStoreRow[]> {
      const rows = await prisma.recruiterAssessment.findMany({
        where: scopeWhere(scope),
        orderBy: { updatedAt: "desc" },
        select: LIST_SELECT,
      });
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        durationMinutes: r.durationMinutes,
        passMarkPercent: r.passMarkPercent,
        questionCount: r._count.questions,
        updatedAt: r.updatedAt,
      }));
    },

    async delete(assessmentId, scope) {
      const owned = await prisma.recruiterAssessment.findFirst({
        where: { id: assessmentId, ...scopeWhere(scope) },
        select: { id: true },
      });
      if (!owned) return false;
      await prisma.recruiterAssessment.delete({
        where: { id: assessmentId },
        select: { id: true },
      });
      return true;
    },

    async publish(assessmentId, scope, at) {
      // The DRAFT guard lives in the WHERE, not in a read before the write, so
      // a double click or two tabs publish exactly once.
      const res = await prisma.recruiterAssessment.updateMany({
        where: { id: assessmentId, ...scopeWhere(scope), status: "DRAFT" },
        data: { status: "PUBLISHED", publishedAt: at, strictMode: true },
      });
      return res.count === 1;
    },

    async listAssignableCandidates(
      recruiterUserId,
      options,
    ): Promise<AssignableCandidate[]> {
      // The same two stores as app/hire/layout.tsx, scoped the SAME way the
      // header is (`scopePodRows`): inside a project, that project's rows and
      // nothing else; outside one, the legacy saved list, which belongs to no
      // project. The two halves are never merged and the projects are never
      // unioned — listing every project's shortlist here is what showed a
      // recruiter twelve names next to a Shortlist pod of one.
      //
      // Deduped on the person, because an assignment is unique per person.
      const projectId = options?.projectId ?? null;
      const [legacy, project] = await Promise.all([
        projectId ? null : getShortlist(recruiterUserId),
        projectId ? listProjectShortlistForProject(recruiterUserId, projectId) : [],
      ]);
      const merged: {
        candidateRef: string;
        candidateUserId: string;
        name: string | null;
        jobRole: string;
      }[] = [];
      const seen = new Set<string>();
      // No published cohort is not an error here — that half just adds nobody.
      for (const r of legacy?.ok ? legacy.data : []) {
        if (seen.has(r.userId)) continue;
        seen.add(r.userId);
        merged.push({
          candidateRef: encodeCandidateRef("PROGRAM", r.memberId),
          candidateUserId: r.userId,
          name: r.displayName,
          jobRole: r.jobRole ?? "Candidate",
        });
      }
      for (const r of project) {
        if (seen.has(r.candidateUserId)) continue;
        seen.add(r.candidateUserId);
        merged.push({
          candidateRef: r.candidateRef,
          candidateUserId: r.candidateUserId,
          name: r.displayName,
          jobRole: r.jobRole,
        });
      }
      // The project half is not filtered for searchability upstream; a
      // candidate who has since hidden themselves must not be assignable.
      const searchable = await filterSearchableUserIds(
        merged.map((m) => m.candidateUserId),
      );
      return merged
        .filter((m) => searchable.has(m.candidateUserId))
        .map((m) => ({
          candidateRef: m.candidateRef,
          candidateUserId: m.candidateUserId,
          label: m.name?.trim() || refPublicId(m.candidateRef),
          jobRole: m.jobRole,
        }));
    },

    async upsertAssignments(assessmentId, rows) {
      if (rows.length === 0) return [];
      return prisma.$transaction(async (tx) => {
        const userIds = rows.map((r) => r.candidateUserId);
        const before = await tx.recruiterAssessmentAssignment.findMany({
          where: { assessmentId, candidateUserId: { in: userIds } },
          select: { candidateUserId: true },
        });
        // skipDuplicates + the (assessmentId, candidateUserId) unique index is
        // the duplicate guard. Two concurrent assigns may both report a row as
        // created; the notification dedupe key still sends one.
        await tx.recruiterAssessmentAssignment.createMany({
          data: rows.map((r) => ({
            assessmentId,
            candidateUserId: r.candidateUserId,
            candidateRef: r.candidateRef,
          })),
          skipDuplicates: true,
        });
        const after = await tx.recruiterAssessmentAssignment.findMany({
          where: { assessmentId, candidateUserId: { in: userIds } },
          select: { id: true, candidateUserId: true },
        });
        const existed = new Set(before.map((b) => b.candidateUserId));
        return after.map((a) => ({
          ...a,
          created: !existed.has(a.candidateUserId),
        }));
      });
    },

    async listAssignments(assessmentId, scope): Promise<AssignmentRow[]> {
      const rows = await prisma.recruiterAssessmentAssignment.findMany({
        where: { assessmentId, assessment: scopeWhere(scope) },
        orderBy: { assignedAt: "asc" },
        select: {
          id: true,
          candidateUserId: true,
          candidateRef: true,
          status: true,
          assignedAt: true,
          startedAt: true,
          submittedAt: true,
          scorePercent: true,
          passed: true,
          endReason: true,
        },
      });
      // The same repository reader the desk uses. No contact field is read.
      const names = await listUserDisplayNames(rows.map((r) => r.candidateUserId));
      return rows.map((r) => ({
        ...r,
        label: names.get(r.candidateUserId) || refPublicId(r.candidateRef),
      }));
    },

    async countResults(scope, assessmentIds) {
      const out = new Map<string, ResultCounts>();
      if (assessmentIds.length === 0) return out;
      const groups = await prisma.recruiterAssessmentAssignment.groupBy({
        by: ["assessmentId", "passed"],
        where: {
          assessmentId: { in: assessmentIds },
          assessment: scopeWhere(scope),
        },
        _count: { _all: true },
      });
      for (const g of groups) {
        const counts = out.get(g.assessmentId) ?? {
          students: 0,
          passed: 0,
          failed: 0,
        };
        counts.students += g._count._all;
        if (g.passed === true) counts.passed += g._count._all;
        if (g.passed === false) counts.failed += g._count._all;
        out.set(g.assessmentId, counts);
      }
      return out;
    },

    async countActivityEvents(assessmentId, scope) {
      const groups = await prisma.assessmentAttemptEvent.groupBy({
        by: ["assignmentId"],
        where: { session: { assignment: { assessmentId, assessment: scopeWhere(scope) } } },
        _count: { _all: true },
      });
      return Object.fromEntries(groups.map((g) => [g.assignmentId, g._count._all]));
    },

    async findAttemptActivity(assessmentId, assignmentId, scope): Promise<AttemptActivityRow | null> {
      const assignment = await prisma.recruiterAssessmentAssignment.findFirst({
        where: { id: assignmentId, assessmentId, assessment: scopeWhere(scope) },
        select: {
          id: true,
          candidateUserId: true,
          candidateRef: true,
          status: true,
          assignedAt: true,
          startedAt: true,
          submittedAt: true,
          endReason: true,
          assessment: {
            select: {
              title: true,
              strictMode: true,
              cameraRequired: true,
              questions: { select: { id: true, position: true } },
            },
          },
          sessions: {
            orderBy: { firstSeenAt: "asc" },
            select: { clientSessionId: true, firstSeenAt: true, lastSeenAt: true },
          },
        },
      });
      if (!assignment) return null;

      const events = await prisma.assessmentAttemptEvent.findMany({
        where: {
          assignmentId,
          session: { assignment: { assessmentId, assessment: scopeWhere(scope) } },
        },
        orderBy: [{ occurredAt: "asc" }, { seq: "asc" }],
        take: MAX_EVENTS_PER_ATTEMPT + MAX_EVENTS_PER_BATCH,
        select: {
          sessionId: true,
          seq: true,
          type: true,
          occurredAt: true,
          questionId: true,
          count: true,
        },
      });

      const names = await listUserDisplayNames([assignment.candidateUserId]);
      const questionNumbers: Record<string, number> = {};
      for (const q of assignment.assessment.questions) {
        questionNumbers[q.id] = q.position + 1;
      }

      return {
        assignmentId: assignment.id,
        label: names.get(assignment.candidateUserId) || refPublicId(assignment.candidateRef),
        status: assignment.status,
        assignedAt: assignment.assignedAt,
        startedAt: assignment.startedAt,
        submittedAt: assignment.submittedAt,
        endReason: assignment.endReason,
        assessment: {
          title: assignment.assessment.title,
          strictMode: assignment.assessment.strictMode,
          cameraRequired: assignment.assessment.cameraRequired,
        },
        questionNumbers,
        sessions: assignment.sessions,
        events,
      };
    },
  };
}
