import "server-only";

import { Domain, ProgramCohortStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hireChallengePool, hireOpenCohortIds } from "@/lib/feature-flags";
import {
  decodeCandidateRef,
  encodeCandidateRef,
  type CandidateRef,
  type CandidateSource,
} from "@/features/hire/candidate-ref";
import { candidatePublicId } from "@/features/hire/public-id";

/**
 * The floor below which someone is not a candidate.
 *
 * Counted in *earned* mission passes — days 1–3 are waived at enrolment and
 * award points to everyone, so a member who has never opened a mission still
 * carries 36 mission points and three "clean passes". Without this floor the
 * first thing a recruiter sees can be a page of people who have done nothing,
 * which is worse for the business than an empty pool.
 */
export const MIN_EARNED_MISSIONS = 3;

export type PoolCohort = {
  id: string;
  name: string;
  startsAt: Date;
  stage: "PUBLISHED" | "OPEN_MIDCOHORT";
};

export type PoolGateResult =
  | { ok: true; cohorts: PoolCohort[] }
  | { ok: false; reason: "NO_COHORT"; message: string };

/**
 * Which cohorts `/hire` may search, and why each one qualifies.
 *
 * This exists because the gate was one line inside `searchCandidates` —
 * `resultsPublishedAt != null` on a single `findFirst` — and it made the whole
 * product unreachable: no cohort on the platform has ever had results
 * published, so the search returned an empty array before it read a single
 * member row.
 *
 * Two deliberate differences from `/talent`:
 *
 * 1. **Every open cohort, not the latest one.** `findFirst` meant a second
 *    running cohort was invisible no matter how good its people were.
 * 2. **A cohort can be opened mid-flight** (see `hireOpenCohortIds`), because
 *    evidence-so-far is real evidence. `/talent` keeps its published-only gate
 *    untouched — see `assertPoolAccess` in features/talent-pool/pool.ts.
 *
 * Consent is *not* configurable here and never will be. It is enforced in
 * `memberEligibilityWhere` on every query, with no override, no admin bypass
 * and no demo exception.
 */
export async function resolvePoolCohorts(): Promise<PoolGateResult> {
  const openIds = hireOpenCohortIds();

  const cohorts = await prisma.programCohort.findMany({
    where: {
      OR: [
        { resultsPublishedAt: { not: null } },
        ...(openIds === "all"
          ? [{ status: { in: [ProgramCohortStatus.ENROLLING, ProgramCohortStatus.ACTIVE] } }]
          : openIds
            ? [{ id: { in: openIds } }]
            : []),
      ],
    },
    orderBy: { startsAt: "desc" },
    select: {
      id: true,
      name: true,
      startsAt: true,
      resultsPublishedAt: true,
    },
  });

  if (cohorts.length === 0) {
    return {
      ok: false,
      reason: "NO_COHORT",
      message: "No cohort is open to hiring yet.",
    };
  }

  return {
    ok: true,
    cohorts: cohorts.map((c) => ({
      id: c.id,
      name: c.name,
      startsAt: c.startsAt,
      stage: c.resultsPublishedAt ? ("PUBLISHED" as const) : ("OPEN_MIDCOHORT" as const),
    })),
  };
}

/**
 * The one where-clause every `/hire` surface must use to load candidates.
 *
 * Reused by search and by the engagement-request actions so a recruiter can
 * never raise a request against somebody Scout would not have shown them.
 */
export function memberEligibilityWhere(
  cohortIds: string[],
): Prisma.ProgramMemberWhereInput {
  return {
    cohortId: { in: cohortIds },
    status: { in: ["ENROLLED", "COMPLETED"] },
    // Non-negotiable. The member ticked a box saying recruiters may see their
    // work; nothing else in this file may weaken it.
    recruiterVisibilityConsentAt: { not: null },
  };
}

/** Does this candidate clear the evidence floor? Takes earned passes, never
 *  `missionPoints`. */
export function clearsEvidenceFloor(missionsPassed: number): boolean {
  return missionsPassed >= MIN_EARNED_MISSIONS;
}

export type EligibleCandidate = {
  candidateRef: string;
  source: CandidateSource;
  userId: string;
  /** Program members only — the FK on the engagement row. */
  programMemberId: string | null;
  publicId: string;
};

/**
 * Turn candidate handles from a browser into candidates a recruiter is
 * genuinely allowed to ask about.
 *
 * The check is the point. A ref is a name, not a capability: it arrives from
 * the client, and anything the search would not have shown must not become an
 * engagement request just because someone can construct the string. So every
 * ref is re-tested against the same conditions its own pool applies — program
 * members against status and consent, challenge participants against the flag
 * and the evidence floor.
 *
 * Unknown or ineligible refs are dropped rather than erroring: a shortlist
 * placed the moment a cohort closes is a race, not an attack, and the caller
 * reports how many were skipped.
 */
export async function resolveEligibleCandidates(
  refs: string[],
): Promise<EligibleCandidate[]> {
  const parsed = refs
    .map((raw) => ({ raw, ref: decodeCandidateRef(raw) }))
    .filter((r): r is { raw: string; ref: CandidateRef } => r.ref !== null);

  const programIds = parsed
    .filter((r) => r.ref.source === "PROGRAM")
    .map((r) => r.ref.id);
  const claudeUserIds = parsed
    .filter((r) => r.ref.source === "CLAUDE")
    .map((r) => r.ref.id);
  const sixtyUserIds = parsed
    .filter((r) => r.ref.source === "CHALLENGE_60")
    .map((r) => r.ref.id);
  const hackathonUserIds = parsed
    .filter((r) => r.ref.source === "HACKATHON")
    .map((r) => r.ref.id);

  const flag = hireChallengePool();

  const [members, claudeEnrollments, sixtyEnrollments, hackathonRows] =
    await Promise.all([
      programIds.length > 0
        ? prisma.programMember.findMany({
            where: {
              id: { in: programIds },
              status: { in: ["ENROLLED", "COMPLETED"] },
              recruiterVisibilityConsentAt: { not: null },
            },
            select: { id: true, userId: true },
          })
        : [],
      flag.enabled && claudeUserIds.length > 0
        ? prisma.enrollment.findMany({
            where: {
              userId: { in: claudeUserIds },
              challenge: { domain: Domain.CLAUDE },
            },
            select: { userId: true, _count: { select: { submissions: true } } },
          })
        : [],
      flag.enabled && sixtyUserIds.length > 0
        ? prisma.enrollment.findMany({
            where: {
              userId: { in: sixtyUserIds },
              challenge: { domain: { in: [Domain.SE, Domain.DS, Domain.AI] } },
            },
            select: { userId: true, _count: { select: { submissions: true } } },
          })
        : [],
      hackathonUserIds.length > 0
        ? prisma.hackathonParticipant.findMany({
            where: {
              userId: { in: hackathonUserIds },
              team: { submission: { isNot: null } },
            },
            select: { userId: true },
          })
        : [],
    ]);

  const out: EligibleCandidate[] = [];
  for (const m of members) {
    out.push({
      candidateRef: encodeCandidateRef("PROGRAM", m.id),
      source: "PROGRAM",
      userId: m.userId,
      programMemberId: m.id,
      publicId: candidatePublicId(m.id),
    });
  }
  for (const e of claudeEnrollments) {
    if (e._count.submissions < flag.minDays) continue;
    out.push({
      candidateRef: encodeCandidateRef("CLAUDE", e.userId),
      source: "CLAUDE",
      userId: e.userId,
      programMemberId: null,
      publicId: candidatePublicId(e.userId),
    });
  }
  for (const e of sixtyEnrollments) {
    if (e._count.submissions < flag.minDays) continue;
    out.push({
      candidateRef: encodeCandidateRef("CHALLENGE_60", e.userId),
      source: "CHALLENGE_60",
      userId: e.userId,
      programMemberId: null,
      publicId: candidatePublicId(e.userId),
    });
  }
  for (const h of hackathonRows) {
    out.push({
      candidateRef: encodeCandidateRef("HACKATHON", h.userId),
      source: "HACKATHON",
      userId: h.userId,
      programMemberId: null,
      publicId: candidatePublicId(h.userId),
    });
  }
  // Someone enrolled in more than one CLAUDE challenge would appear twice.
  const seen = new Set<string>();
  return out.filter((c) => {
    if (seen.has(c.candidateRef)) return false;
    seen.add(c.candidateRef);
    return true;
  });
}
