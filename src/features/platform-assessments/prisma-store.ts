import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma, writeClient } from "@/lib/db";
import { writeAudit } from "@/features/admin/audit";
import { questionCreateNested } from "@/features/recruiter-assessments/prisma-store";
import type { AssessmentQuestionRow } from "@/features/recruiter-assessments/service";
import { cohortSlugForDomain } from "@/repositories/ids";
import { listAllEvents } from "@/repositories/workshop";
import {
  DOMAIN_LABELS,
  type AudienceOptions,
  type ChallengeDomain,
  type PlatformAssessmentRow,
  type PlatformAttemptRow,
  type PlatformAudience,
  type PlatformListRow,
  type PlatformStore,
} from "./service";

/**
 * Plan 166 — the real platform-assessment store. Every query pins
 * `source: "PLATFORM"`, so an id belonging to a recruiter's assessment reads
 * as not found here, exactly as a platform id does on the recruiter side.
 */

const PLATFORM = { source: "PLATFORM" } as const;
const DOMAINS: ChallengeDomain[] = ["AI", "DS", "SE", "CLAUDE"];
/** Enrollment states that count as "in" a challenge domain. */
const IN_COHORT = ["ACTIVE", "COMPLETED"] as const;
const INSERT_CHUNK = 1_000;

const ROW_SELECT = {
  id: true,
  title: true,
  subheading: true,
  instructions: true,
  status: true,
  durationMinutes: true,
  passMarkPercent: true,
  strictMode: true,
  cameraRequired: true,
  deadlineAt: true,
  audienceAll: true,
  audienceDomains: true,
  audienceWorkshopEventIds: true,
  publishedAt: true,
  updatedAt: true,
  createdBy: { select: { name: true, email: true } },
  questions: {
    orderBy: { position: "asc" as const },
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
      sectionId: true,
      options: {
        orderBy: { position: "asc" as const },
        select: { id: true, position: true, body: true, isCorrect: true },
      },
    },
  },
} satisfies Prisma.RecruiterAssessmentSelect;

function audienceOf(row: {
  audienceAll: boolean;
  audienceDomains: ChallengeDomain[];
  audienceWorkshopEventIds: string[];
}): PlatformAudience {
  return {
    all: row.audienceAll,
    domains: row.audienceDomains,
    workshopEventIds: row.audienceWorkshopEventIds,
  };
}

function label(user: { name: string | null; email: string }): string {
  return user.name?.trim() || user.email;
}

/** Only real, active accounts receive an assessment. */
const LIVE_USER = {
  deletedAt: null,
  disabledAt: null,
} satisfies Prisma.UserWhereInput;

export function prismaPlatformStore(): PlatformStore {
  return {
    async create(createdByUserId, input) {
      // One nested create — assessment, questions and options atomically.
      const row = await prisma.recruiterAssessment.create({
        data: {
          source: "PLATFORM",
          organizationId: null,
          createdByUserId,
          title: input.title,
          subheading: input.subheading,
          instructions: input.instructions,
          status: "DRAFT",
          durationMinutes: input.durationMinutes,
          passMarkPercent: input.passMarkPercent,
          cameraRequired: input.cameraRequired,
          shortlistRefs: [],
          questions: {
            create: input.questions.map((q, i) => questionCreateNested(q, i)),
          },
        },
        select: { id: true },
      });
      return { id: row.id };
    },

    async replaceDraftContent(assessmentId, input) {
      const draft = await prisma.recruiterAssessment.findFirst({
        where: { id: assessmentId, ...PLATFORM, status: "DRAFT" },
        select: { id: true },
      });
      if (!draft) return false;
      await prisma.recruiterAssessment.update({
        where: { id: assessmentId },
        data: {
          title: input.title,
          subheading: input.subheading,
          instructions: input.instructions,
          durationMinutes: input.durationMinutes,
          passMarkPercent: input.passMarkPercent,
          cameraRequired: input.cameraRequired,
          questions: {
            deleteMany: {},
            create: input.questions.map((q, i) => questionCreateNested(q, i)),
          },
        },
        select: { id: true },
      });
      return true;
    },

    async find(assessmentId): Promise<PlatformAssessmentRow | null> {
      const row = await prisma.recruiterAssessment.findFirst({
        where: { id: assessmentId, ...PLATFORM },
        select: ROW_SELECT,
      });
      if (!row) return null;
      return {
        id: row.id,
        title: row.title,
        subheading: row.subheading,
        instructions: row.instructions,
        status: row.status,
        durationMinutes: row.durationMinutes,
        passMarkPercent: row.passMarkPercent,
        strictMode: row.strictMode,
        cameraRequired: row.cameraRequired,
        deadlineAt: row.deadlineAt,
        audience: audienceOf(row),
        publishedAt: row.publishedAt,
        updatedAt: row.updatedAt,
        createdByLabel: label(row.createdBy),
        questions: row.questions as AssessmentQuestionRow[],
      };
    },

    async list(): Promise<PlatformListRow[]> {
      const rows = await prisma.recruiterAssessment.findMany({
        where: PLATFORM,
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: {
          id: true,
          title: true,
          status: true,
          deadlineAt: true,
          audienceAll: true,
          audienceDomains: true,
          audienceWorkshopEventIds: true,
          updatedAt: true,
          createdBy: { select: { name: true, email: true } },
          _count: { select: { questions: true, assignments: true } },
        },
      });
      const submitted = await prisma.recruiterAssessmentAssignment.groupBy({
        by: ["assessmentId"],
        where: {
          assessmentId: { in: rows.map((r) => r.id) },
          status: "SUBMITTED",
        },
        _count: { _all: true },
      });
      const submittedBy = new Map(
        submitted.map((s) => [s.assessmentId, s._count._all]),
      );
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        deadlineAt: r.deadlineAt,
        audience: audienceOf(r),
        questionCount: r._count.questions,
        sent: r._count.assignments,
        submitted: submittedBy.get(r.id) ?? 0,
        updatedAt: r.updatedAt,
        createdByLabel: label(r.createdBy),
      }));
    },

    async deleteDraft(assessmentId) {
      const res = await prisma.recruiterAssessment.deleteMany({
        where: { id: assessmentId, ...PLATFORM, status: "DRAFT" },
      });
      return res.count === 1;
    },

    async resolveAudience(audience) {
      const ids = new Set<string>();

      if (audience.all) {
        const rows = await prisma.candidateProfile.findMany({
          where: { user: LIVE_USER },
          select: { userId: true },
        });
        for (const r of rows) ids.add(r.userId);
      } else if (audience.domains.length > 0) {
        const rows = await prisma.programEnrollment.findMany({
          where: {
            status: { in: [...IN_COHORT] },
            cohort: {
              slug: { in: audience.domains.map((d) => cohortSlugForDomain(d)) },
            },
            user: LIVE_USER,
          },
          select: { userId: true },
          distinct: ["userId"],
        });
        for (const r of rows) ids.add(r.userId);
      }

      // Workshop registrants are added even with `all`: a workshop-only
      // attendee has no candidate profile, so "all" does not include them.
      if (audience.workshopEventIds.length > 0) {
        const rows = await prisma.workshopRegistration.findMany({
          where: {
            eventId: { in: audience.workshopEventIds },
            user: LIVE_USER,
          },
          select: { userId: true },
          distinct: ["userId"],
        });
        for (const r of rows) ids.add(r.userId);
      }

      return [...ids];
    },

    async publishAndAssign(input) {
      return writeClient().$transaction(
        async (tx) => {
          // The DRAFT guard is in the WHERE: a double click publishes once.
          const moved = await tx.recruiterAssessment.updateMany({
            where: { id: input.assessmentId, ...PLATFORM, status: "DRAFT" },
            data: {
              status: "PUBLISHED",
              publishedAt: input.at,
              strictMode: true,
              deadlineAt: input.deadlineAt,
              audienceAll: input.audience.all,
              audienceDomains: input.audience.domains,
              audienceWorkshopEventIds: input.audience.workshopEventIds,
            },
          });
          if (moved.count !== 1) return { published: false, assigned: 0 };

          let assigned = 0;
          for (
            let i = 0;
            i < input.candidateUserIds.length;
            i += INSERT_CHUNK
          ) {
            const chunk = input.candidateUserIds.slice(i, i + INSERT_CHUNK);
            const res = await tx.recruiterAssessmentAssignment.createMany({
              data: chunk.map((candidateUserId) => ({
                assessmentId: input.assessmentId,
                candidateUserId,
                candidateRef: `PLATFORM:${candidateUserId}`,
                assignedAt: input.at,
              })),
              skipDuplicates: true,
            });
            assigned += res.count;
          }

          await writeAudit(tx, {
            actorUserId: input.actorUserId,
            adminUserId: input.actorUserId,
            entityType: "RecruiterAssessment",
            entityId: input.assessmentId,
            actionType: "PLATFORM_ASSESSMENT_SENT",
            reason: "Platform assessment published and sent",
            newState: {
              deadlineAt: input.deadlineAt.toISOString(),
              audience: input.audience,
              assigned,
            },
          });

          return { published: true, assigned };
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
    },

    async summarize(assessmentId, now) {
      const [byStatus, passed, failed, started, deadline] = await Promise.all([
        prisma.recruiterAssessmentAssignment.groupBy({
          by: ["status"],
          where: { assessmentId },
          _count: { _all: true },
        }),
        prisma.recruiterAssessmentAssignment.count({
          where: { assessmentId, passed: true },
        }),
        prisma.recruiterAssessmentAssignment.count({
          where: { assessmentId, passed: false },
        }),
        prisma.recruiterAssessmentAssignment.count({
          where: { assessmentId, startedAt: { not: null } },
        }),
        prisma.recruiterAssessment.findFirst({
          where: { id: assessmentId, ...PLATFORM },
          select: { deadlineAt: true },
        }),
      ]);
      const count = (s: "ASSIGNED" | "STARTED" | "SUBMITTED") =>
        byStatus.find((b) => b.status === s)?._count._all ?? 0;
      const closed = deadline?.deadlineAt != null && deadline.deadlineAt <= now;
      return {
        sent: count("ASSIGNED") + count("STARTED") + count("SUBMITTED"),
        started,
        submitted: count("SUBMITTED"),
        missed: closed ? count("ASSIGNED") : 0,
        passed,
        failed,
      };
    },

    async listAttempts(assessmentId, page): Promise<PlatformAttemptRow[]> {
      const rows = await prisma.recruiterAssessmentAssignment.findMany({
        where: { assessmentId },
        // Finished first (newest submission on top), then in progress, then
        // not started.
        orderBy: [
          { submittedAt: { sort: "desc", nulls: "last" } },
          { startedAt: { sort: "desc", nulls: "last" } },
          { id: "asc" },
        ],
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          candidateUserId: true,
          status: true,
          startedAt: true,
          submittedAt: true,
          scorePercent: true,
          passed: true,
          endReason: true,
          candidate: { select: { name: true, email: true } },
        },
      });
      return rows.map((r) => ({
        assignmentId: r.id,
        candidateUserId: r.candidateUserId,
        name: label(r.candidate),
        email: r.candidate.email,
        status: r.status,
        startedAt: r.startedAt,
        submittedAt: r.submittedAt,
        scorePercent: r.scorePercent,
        passed: r.passed,
        endReason: r.endReason,
      }));
    },

    async audienceOptions(): Promise<AudienceOptions> {
      const [allCount, byCohort, byWorkshop, events] = await Promise.all([
        prisma.candidateProfile.count({ where: { user: LIVE_USER } }),
        // (userId, cohortId) is unique, so a count is a count of people.
        Promise.all(
          DOMAINS.map((domain) =>
            prisma.programEnrollment
              .count({
                where: {
                  status: { in: [...IN_COHORT] },
                  cohort: { slug: cohortSlugForDomain(domain) },
                  user: LIVE_USER,
                },
              })
              .then((count) => ({
                domain,
                label: DOMAIN_LABELS[domain],
                count,
              })),
          ),
        ),
        prisma.workshopRegistration.groupBy({
          by: ["eventId"],
          where: { user: LIVE_USER },
          _count: { _all: true },
        }),
        // Plan 163: the schedule is in the database. All events, archived
        // included — registrations point at past (archived) workshops too.
        listAllEvents(),
      ]);

      const eventsById = new Map(events.map((e) => [e.id, e]));
      const workshops = byWorkshop
        .map((w) => {
          const event = eventsById.get(w.eventId);
          return {
            eventId: w.eventId,
            label: event ? `${event.title} · ${event.date}` : w.eventId,
            date: event?.date ?? "",
            count: w._count._all,
          };
        })
        // Newest workshop first; unknown ids (no calendar entry) last.
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(({ eventId, label: l, count }) => ({ eventId, label: l, count }));

      return { allCount, domains: byCohort, workshops };
    },
  };
}
