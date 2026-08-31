import "server-only";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { JobSpec } from "@/lib/validations/hire";
import {
  generateVirtualCandidate,
  type VirtualCandidateProfile,
} from "@/features/hire/virtual-candidate";
import type {
  Prisma,
  VirtualCandidateRequestStatus,
  TalentEmploymentType,
} from "@prisma/client";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

/**
 * Persistence for requirement-derived profiles and the asks against them.
 *
 * The split matters and is the whole design: one `VirtualCandidate` per
 * distinct requirement, one `VirtualCandidateRequest` per recruiter who asked
 * for it. Deduplicating the profile means the sourcing team does the work once;
 * keeping the requests apart means neither recruiter loses their own timeline,
 * note or priority, and neither is told about the other.
 */

/** Statuses a request may still move out of. Everything else is terminal. */
const OPEN_STATUSES: VirtualCandidateRequestStatus[] = [
  "REQUESTED",
  "SOURCING",
  "CANDIDATE_FOUND",
  "CANDIDATE_SHARED",
];

/** Only these moves are legal. A status machine that allows anything is a log. */
const ALLOWED: Record<VirtualCandidateRequestStatus, VirtualCandidateRequestStatus[]> = {
  REQUESTED: ["SOURCING", "CANCELLED", "EXPIRED"],
  SOURCING: ["CANDIDATE_FOUND", "CANCELLED", "EXPIRED"],
  CANDIDATE_FOUND: ["CANDIDATE_SHARED", "SOURCING", "CANCELLED"],
  CANDIDATE_SHARED: ["FULFILLED", "SOURCING", "CANCELLED"],
  FULFILLED: [],
  CANCELLED: [],
  EXPIRED: ["SOURCING"],
};

export function canTransition(
  from: VirtualCandidateRequestStatus,
  to: VirtualCandidateRequestStatus,
): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

function employmentTypeOf(spec: JobSpec): TalentEmploymentType | null {
  const v = spec.employmentType;
  return v ? (v as TalentEmploymentType) : null;
}

/**
 * Find or create the profile for this requirement.
 *
 * Upserts on the fingerprint, so calling it on every empty search is cheap and
 * idempotent — the same requirement asked a hundred times is one row, and the
 * count of requests against it is the demand signal.
 */
export async function ensureVirtualCandidate(
  spec: JobSpec,
  originRequestId?: string | null,
): Promise<Result<{ id: string; profile: VirtualCandidateProfile }>> {
  const profile = generateVirtualCandidate(spec);
  if (!profile) {
    return { ok: false, message: "Tell me the role or the stack first." };
  }

  try {
    const row = await prisma.virtualCandidate.upsert({
      where: { fingerprintKey: profile.fingerprintKey },
      // A repeat of the same requirement refreshes the wording but never
      // reopens a profile that sourcing has already closed out.
      update: {
        title: profile.title,
        requiredSkills: profile.requiredSkills,
        preferredSkills: profile.preferredSkills,
      },
      create: {
        fingerprintKey: profile.fingerprintKey,
        title: profile.title,
        roleFamily: profile.fingerprint.roleFamily,
        requiredSkills: profile.requiredSkills,
        preferredSkills: profile.preferredSkills,
        experienceMin: profile.experienceMin,
        experienceMax: profile.experienceMax,
        locationLabel: profile.locationLabel,
        employmentType: employmentTypeOf(spec),
        availabilityRequirement: profile.availabilityLabel,
        educationRequirement: profile.educationLabel,
        originRequestId: originRequestId ?? null,
      },
      select: { id: true },
    });
    return { ok: true, data: { id: row.id, profile } };
  } catch (error) {
    logger.error("[hire] ensureVirtualCandidate", { error: String(error) });
    return { ok: false, message: "Could not record the requirement." };
  }
}

export type PlaceVirtualRequestInput = {
  recruiterUserId: string;
  spec: JobSpec;
  talentRequestId?: string | null;
  timelineDays?: number | null;
  recruiterNote?: string | null;
};

/**
 * Record one recruiter's ask.
 *
 * A second click by the same recruiter on the same requirement is the same ask.
 * The unique index says so; this returns the existing row rather than an error,
 * because from the recruiter's side nothing has gone wrong — they asked, and we
 * heard them the first time.
 */
export async function placeVirtualCandidateRequest(
  input: PlaceVirtualRequestInput,
): Promise<Result<{ requestId: string; virtualCandidateId: string; duplicate: boolean }>> {
  const ensured = await ensureVirtualCandidate(input.spec, input.talentRequestId ?? null);
  if (!ensured.ok) return ensured;
  const virtualCandidateId = ensured.data.id;

  try {
    const existing = await prisma.virtualCandidateRequest.findUnique({
      where: {
        virtualCandidateId_recruiterUserId: {
          virtualCandidateId,
          recruiterUserId: input.recruiterUserId,
        },
      },
      select: { id: true, status: true },
    });

    if (existing && OPEN_STATUSES.includes(existing.status)) {
      return {
        ok: true,
        data: { requestId: existing.id, virtualCandidateId, duplicate: true },
      };
    }

    const created = await prisma.$transaction(async (tx) => {
      // A previously cancelled or expired ask is reopened rather than
      // duplicated, so the history of this recruiter/requirement pair stays in
      // one place.
      const row = existing
        ? await tx.virtualCandidateRequest.update({
            where: { id: existing.id },
            data: {
              status: "REQUESTED",
              timelineDays: input.timelineDays ?? null,
              recruiterNote: input.recruiterNote ?? null,
              talentRequestId: input.talentRequestId ?? null,
              cancelledAt: null,
              fulfilledAt: null,
            },
            select: { id: true },
          })
        : await tx.virtualCandidateRequest.create({
            data: {
              virtualCandidateId,
              recruiterUserId: input.recruiterUserId,
              talentRequestId: input.talentRequestId ?? null,
              timelineDays: input.timelineDays ?? null,
              recruiterNote: input.recruiterNote ?? null,
              status: "REQUESTED",
            },
            select: { id: true },
          });

      await tx.virtualCandidateEvent.create({
        data: {
          requestId: row.id,
          kind: existing ? "REOPENED" : "REQUESTED",
          toStatus: "REQUESTED",
          actorUserId: input.recruiterUserId,
          note: input.recruiterNote ?? null,
        },
      });

      // The profile follows its busiest request: once anyone has asked, it is
      // no longer merely "available on request".
      await tx.virtualCandidate.update({
        where: { id: virtualCandidateId },
        data: { status: "REQUESTED" },
      });

      return row;
    });

    return {
      ok: true,
      data: { requestId: created.id, virtualCandidateId, duplicate: false },
    };
  } catch (error) {
    logger.error("[hire] placeVirtualCandidateRequest", { error: String(error) });
    return { ok: false, message: "Could not place the request." };
  }
}

/** Recruiter withdraws their own ask. Terminal, but re-askable later. */
export async function cancelVirtualCandidateRequest(
  requestId: string,
  recruiterUserId: string,
): Promise<Result<{ requestId: string }>> {
  try {
    const owned = await prisma.virtualCandidateRequest.findFirst({
      where: { id: requestId, recruiterUserId },
      select: { id: true, status: true },
    });
    if (!owned) return { ok: false, message: "Request not found." };
    if (!canTransition(owned.status, "CANCELLED")) {
      return { ok: false, message: "This request can no longer be cancelled." };
    }

    await prisma.$transaction(async (tx) => {
      await tx.virtualCandidateRequest.update({
        where: { id: owned.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      await tx.virtualCandidateEvent.create({
        data: {
          requestId: owned.id,
          kind: "CANCELLED",
          fromStatus: owned.status,
          toStatus: "CANCELLED",
          actorUserId: recruiterUserId,
        },
      });
    });

    return { ok: true, data: { requestId: owned.id } };
  } catch (error) {
    logger.error("[hire] cancelVirtualCandidateRequest", { error: String(error) });
    return { ok: false, message: "Could not cancel the request." };
  }
}

export type AdminRequestRow = {
  id: string;
  status: VirtualCandidateRequestStatus;
  createdAt: Date;
  timelineDays: number | null;
  recruiterNote: string | null;
  expectedBy: Date | null;
  priority: number;
  recruiter: { id: string; name: string | null; email: string };
  virtualCandidate: {
    id: string;
    title: string;
    requiredSkills: string[];
    experienceMin: number | null;
    experienceMax: number | null;
    locationLabel: string | null;
    fingerprintKey: string;
  };
  /** How many other recruiters are waiting on this same requirement. */
  siblingCount: number;
};

/** The admin queue. Grouped by requirement so recurring demand is visible. */
export async function listVirtualCandidateRequests(opts?: {
  status?: VirtualCandidateRequestStatus;
  skip?: number;
  take?: number;
}): Promise<Result<{ rows: AdminRequestRow[]; total: number }>> {
  const take = Math.min(100, Math.max(1, opts?.take ?? 25));
  const skip = Math.max(0, opts?.skip ?? 0);
  const where: Prisma.VirtualCandidateRequestWhereInput = opts?.status
    ? { status: opts.status }
    : {};

  try {
    const [rows, total] = await Promise.all([
      prisma.virtualCandidateRequest.findMany({
        where,
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        skip,
        take,
        select: {
          id: true,
          status: true,
          createdAt: true,
          timelineDays: true,
          recruiterNote: true,
          expectedBy: true,
          priority: true,
          recruiter: { select: { id: true, name: true, email: true } },
          virtualCandidate: {
            select: {
              id: true,
              title: true,
              requiredSkills: true,
              experienceMin: true,
              experienceMax: true,
              locationLabel: true,
              fingerprintKey: true,
              _count: { select: { requests: true } },
            },
          },
        },
      }),
      prisma.virtualCandidateRequest.count({ where }),
    ]);

    return {
      ok: true,
      data: {
        total,
        rows: rows.map((r) => ({
          id: r.id,
          status: r.status,
          createdAt: r.createdAt,
          timelineDays: r.timelineDays,
          recruiterNote: r.recruiterNote,
          expectedBy: r.expectedBy,
          priority: r.priority,
          recruiter: r.recruiter,
          virtualCandidate: {
            id: r.virtualCandidate.id,
            title: r.virtualCandidate.title,
            requiredSkills: r.virtualCandidate.requiredSkills,
            experienceMin: r.virtualCandidate.experienceMin,
            experienceMax: r.virtualCandidate.experienceMax,
            locationLabel: r.virtualCandidate.locationLabel,
            fingerprintKey: r.virtualCandidate.fingerprintKey,
          },
          siblingCount: Math.max(0, r.virtualCandidate._count.requests - 1),
        })),
      },
    };
  } catch (error) {
    logger.error("[hire] listVirtualCandidateRequests", { error: String(error) });
    return { ok: false, message: "Could not load the queue." };
  }
}

/** Admin moves a request along. Illegal moves are refused, not logged. */
export async function updateVirtualRequestStatus(input: {
  requestId: string;
  to: VirtualCandidateRequestStatus;
  adminUserId: string | null;
  note?: string | null;
  expectedBy?: Date | null;
  assignedAdminId?: string | null;
}): Promise<Result<{ requestId: string; status: VirtualCandidateRequestStatus }>> {
  try {
    const row = await prisma.virtualCandidateRequest.findUnique({
      where: { id: input.requestId },
      select: { id: true, status: true, virtualCandidateId: true },
    });
    if (!row) return { ok: false, message: "Request not found." };
    if (!canTransition(row.status, input.to)) {
      return {
        ok: false,
        message: `Cannot move a ${row.status} request to ${input.to}.`,
      };
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.virtualCandidateRequest.update({
        where: { id: row.id },
        data: {
          status: input.to,
          ...(input.expectedBy !== undefined ? { expectedBy: input.expectedBy } : {}),
          ...(input.assignedAdminId !== undefined
            ? { assignedAdminId: input.assignedAdminId }
            : {}),
          ...(input.to === "FULFILLED" ? { fulfilledAt: new Date() } : {}),
          ...(input.to === "CANCELLED" ? { cancelledAt: new Date() } : {}),
        },
        select: { id: true, status: true },
      });

      await tx.virtualCandidateEvent.create({
        data: {
          requestId: row.id,
          kind: "STATUS_CHANGED",
          fromStatus: row.status,
          toStatus: input.to,
          note: input.note ?? null,
          actorUserId: input.adminUserId,
        },
      });

      // The profile stops being offered once every ask on it is settled.
      if (input.to === "FULFILLED") {
        const openLeft = await tx.virtualCandidateRequest.count({
          where: {
            virtualCandidateId: row.virtualCandidateId,
            status: { in: OPEN_STATUSES },
          },
        });
        if (openLeft === 0) {
          await tx.virtualCandidate.update({
            where: { id: row.virtualCandidateId },
            data: { status: "FULFILLED", fulfilledAt: new Date() },
          });
        }
      }

      return next;
    });

    return { ok: true, data: { requestId: updated.id, status: updated.status } };
  } catch (error) {
    logger.error("[hire] updateVirtualRequestStatus", { error: String(error) });
    return { ok: false, message: "Could not update the request." };
  }
}

/**
 * Sourcing succeeded: attach the real person to this recruiter's ask.
 *
 * Per request, not per profile — two recruiters chasing one requirement can be
 * served by two different people, and the profile only converts when it is the
 * same person for everyone still waiting.
 */
export async function linkRealCandidate(input: {
  requestId: string;
  candidateUserId: string;
  adminUserId: string | null;
  note?: string | null;
}): Promise<Result<{ requestId: string; status: VirtualCandidateRequestStatus }>> {
  try {
    const [row, candidate] = await Promise.all([
      prisma.virtualCandidateRequest.findUnique({
        where: { id: input.requestId },
        select: { id: true, status: true, virtualCandidateId: true },
      }),
      prisma.user.findUnique({
        where: { id: input.candidateUserId },
        select: { id: true },
      }),
    ]);
    if (!row) return { ok: false, message: "Request not found." };
    if (!candidate) return { ok: false, message: "That candidate does not exist." };
    if (!canTransition(row.status, "CANDIDATE_FOUND")) {
      return {
        ok: false,
        message: `Cannot link a candidate to a ${row.status} request.`,
      };
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.virtualCandidateRequest.update({
        where: { id: row.id },
        data: { status: "CANDIDATE_FOUND", linkedCandidateUserId: candidate.id },
        select: { id: true, status: true },
      });
      await tx.virtualCandidateEvent.create({
        data: {
          requestId: row.id,
          kind: "CANDIDATE_LINKED",
          fromStatus: row.status,
          toStatus: "CANDIDATE_FOUND",
          note: input.note ?? null,
          actorUserId: input.adminUserId,
        },
      });
      await tx.virtualCandidate.update({
        where: { id: row.virtualCandidateId },
        data: { status: "CANDIDATE_FOUND", convertedCandidateUserId: candidate.id },
      });
      return next;
    });

    return { ok: true, data: { requestId: updated.id, status: updated.status } };
  } catch (error) {
    logger.error("[hire] linkRealCandidate", { error: String(error) });
    return { ok: false, message: "Could not link the candidate." };
  }
}

/** One request with its full audit trail, for the admin detail view. */
export async function getVirtualCandidateRequest(requestId: string) {
  return prisma.virtualCandidateRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      timelineDays: true,
      recruiterNote: true,
      adminNotes: true,
      expectedBy: true,
      priority: true,
      linkedCandidateUserId: true,
      recruiter: { select: { id: true, name: true, email: true } },
      assignedAdmin: { select: { id: true, name: true, email: true } },
      virtualCandidate: true,
      events: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          fromStatus: true,
          toStatus: true,
          note: true,
          createdAt: true,
          actor: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
}
