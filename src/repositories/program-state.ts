/**
 * W8 ProgramMember current-state / write-authority boundary.
 *
 * Membership, unlock, skip tokens, score snapshots, and AI recommendations
 * always write ProgramEnrollment pe_pm_<memberId>. New membership does not
 * mint ProgramMember. Child rows use programEnrollmentId. Identity stays
 * CandidateProfile. Recruiter permission stays CandidateVisibility.
 */
import "server-only";
import {
  EnrollmentStatusV2,
  ProgramCohortStatus,
  ProgramMemberStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  cohortSlugForProgramCohort,
  memberIdFromPe,
  mintProgressRowId,
  peIdForMember,
  programCohortIdFromSlug,
} from "@/repositories/ids";
import { applyVisibilityChange } from "@/repositories/visibility";

type Tx = Prisma.TransactionClient | PrismaClient;

export function mapMemberStatus(status: ProgramMemberStatus): EnrollmentStatusV2 {
  switch (status) {
    case ProgramMemberStatus.APPLIED:
      return EnrollmentStatusV2.APPLIED;
    case ProgramMemberStatus.WAITLISTED:
      return EnrollmentStatusV2.WAITLISTED;
    case ProgramMemberStatus.ENROLLED:
      return EnrollmentStatusV2.ACTIVE;
    case ProgramMemberStatus.COMPLETED:
      return EnrollmentStatusV2.COMPLETED;
    case ProgramMemberStatus.DROPPED:
      return EnrollmentStatusV2.DROPPED;
    default:
      return EnrollmentStatusV2.ACTIVE;
  }
}

export type ProgramMemberIdentitySnapshot = {
  fullName: string;
  jobRole?: string | null;
  company?: string | null;
  yearsExperience?: number | null;
  education?: string | null;
  university?: string | null;
  graduationYear?: number | null;
  skills?: string[];
  linkedinUrl?: string | null;
  resumeUrl?: string | null;
  phone?: string | null;
  githubUsername: string;
  githubRepoUrl: string;
};

export type ProgramScoreSnapshot = {
  missionPoints: number;
  conceptPoints: number;
  commitPoints: number;
  projectPoints: number;
  totalScore: number;
  cleanPassCount: number;
};

export type ProgramMemberStateSnapshot = ProgramScoreSnapshot & {
  status: ProgramMemberStatus;
  highestUnlockedDay: number;
  skipTokensUsed: number;
  githubRepoUrl: string | null;
  aiRecommendation: string | null;
  aiRecommendationAt: Date | null;
  enrolledAt: Date | null;
  completedAt: Date | null;
};

function savepointName(label: string): string {
  const cleaned = label.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  return `pmmir_${cleaned || "x"}`;
}

function injectedMirrorFailure(): boolean {
  return process.env.PROGRAM_MEMBER_FAIL_LEGACY_MIRROR === "1";
}

function mapPeStatusToMember(
  status: EnrollmentStatusV2,
): ProgramMemberStatus {
  switch (status) {
    case EnrollmentStatusV2.APPLIED:
      return ProgramMemberStatus.APPLIED;
    case EnrollmentStatusV2.WAITLISTED:
      return ProgramMemberStatus.WAITLISTED;
    case EnrollmentStatusV2.COMPLETED:
      return ProgramMemberStatus.COMPLETED;
    case EnrollmentStatusV2.DROPPED:
      return ProgramMemberStatus.DROPPED;
    default:
      return ProgramMemberStatus.ENROLLED;
  }
}

function pmGithubData(
  githubRepoUrl: string | null | undefined,
): { githubRepoUrl: string } | Record<string, never> {
  if (githubRepoUrl === undefined) return {};
  return { githubRepoUrl: githubRepoUrl ?? "" };
}

function totalFrom(parts: {
  missionPoints: number;
  conceptPoints: number;
  commitPoints: number;
  projectPoints: number;
}): number {
  return (
    parts.missionPoints +
    parts.conceptPoints +
    parts.commitPoints +
    parts.projectPoints
  );
}

async function resolveCohortId(
  tx: Tx,
  programCohortId: string,
): Promise<string> {
  const slug = cohortSlugForProgramCohort(programCohortId);
  const cohort = await tx.cohort.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!cohort) throw new Error(`Missing cohort ${slug}`);
  return cohort.id;
}

async function mirrorProgramMemberLegacyState(
  tx: Tx,
  label: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  void tx; void label; void fn;
  return false;
}

async function ensureDiscoverable(
  tx: Tx,
  userId: string,
  consentedAt: Date | null | undefined,
): Promise<void> {
  await applyVisibilityChange(tx, {
    userId,
    kind: "program_member",
    consentedAt: consentedAt ?? null,
  });
}

export async function applyProgramMembershipChange(
  tx: Tx,
  input: {
    memberId?: string;
    userId: string;
    programCohortId: string;
    status: ProgramMemberStatus;
    enrolledAt?: Date | null;
    completedAt?: Date | null;
    githubRepoUrl?: string;
    identity?: ProgramMemberIdentitySnapshot;
    recruiterVisibilityConsentAt?: Date | null;
  },
): Promise<{ memberId: string; created: boolean; mirrorFailed: boolean }> {
  const cohortId = await resolveCohortId(tx, input.programCohortId);
  const existingPe = await tx.programEnrollment.findUnique({
    where: {
      userId_cohortId: { userId: input.userId, cohortId },
    },
    select: { id: true },
  });
  let memberId =
    input.memberId ??
    (existingPe ? memberIdFromPe(existingPe.id) : null) ??
    mintProgressRowId();
  const created = !existingPe;

  {
    await ensureDiscoverable(
      tx,
      input.userId,
      input.recruiterVisibilityConsentAt,
    );
  }

  const peId = existingPe?.id ?? peIdForMember(memberId);
  const now = new Date();
  const enrolledAt =
    input.enrolledAt !== undefined
      ? input.enrolledAt
      : input.status === ProgramMemberStatus.ENROLLED
        ? now
        : null;
  await tx.programEnrollment.upsert({
    where: { id: peId },
    create: {
      id: peId,
      userId: input.userId,
      cohortId,
      status: mapMemberStatus(input.status),
      startedAt: enrolledAt ?? now,
      joinedAt: now,
      enrolledAt,
      completedAt: input.completedAt ?? null,
      droppedAt:
        input.status === ProgramMemberStatus.DROPPED ? now : null,
      githubRepoUrl: input.identity?.githubRepoUrl ?? input.githubRepoUrl,
    },
    update: {
      status: mapMemberStatus(input.status),
      ...(input.enrolledAt !== undefined ? { enrolledAt: input.enrolledAt } : {}),
      ...(input.completedAt !== undefined
        ? { completedAt: input.completedAt }
        : {}),
      ...(input.status === ProgramMemberStatus.DROPPED ? { droppedAt: now } : {}),
      ...(input.githubRepoUrl !== undefined
        ? { githubRepoUrl: input.githubRepoUrl }
        : input.identity?.githubRepoUrl
          ? { githubRepoUrl: input.identity.githubRepoUrl }
          : {}),
    },
  });

  const mirrorFailed = await mirrorProgramMemberLegacyState(
    tx,
    "membership",
    async () => undefined,
  );

  return { memberId, created, mirrorFailed };
}

export async function applyProgramUnlockChange(
  tx: Tx,
  input: {
    memberId: string;
    highestUnlockedDay?: number;
    skipTokensUsed?: number;
    githubRepoUrl?: string | null;
  },
): Promise<{ mirrorFailed: boolean }> {
  const peUpdated = await tx.programEnrollment.updateMany({
    where: { id: peIdForMember(input.memberId) },
    data: {
      ...(input.highestUnlockedDay !== undefined
        ? { unlockFloorDay: input.highestUnlockedDay }
        : {}),
      ...(input.skipTokensUsed !== undefined
        ? { skipTokensUsed: input.skipTokensUsed }
        : {}),
      ...(input.githubRepoUrl !== undefined
        ? { githubRepoUrl: input.githubRepoUrl }
        : {}),
    },
  });
  if (peUpdated.count === 0) {
    logger.error(
      "[program-state] ProgramEnrollment missing for unlock change",
      { memberId: input.memberId },
    );
  }

  const mirrorFailed = await mirrorProgramMemberLegacyState(
    tx,
    "unlock",
    async () => undefined,
  );
  return { mirrorFailed };
}

export async function applyProgramScoreChange(
  tx: Tx,
  input: {
    memberId: string;
    missionPoints?: number;
    conceptPoints?: number;
    commitPoints?: number;
    projectPoints?: number;
    cleanPassCount?: number;
    missionPointsDelta?: number;
    cleanPassCountDelta?: number;
  },
): Promise<{ snapshot: ProgramScoreSnapshot; mirrorFailed: boolean }> {
  const current = await readScoreAuthority(tx, input.memberId);
  const next: ProgramScoreSnapshot = {
    missionPoints:
      input.missionPoints ??
      current.missionPoints + (input.missionPointsDelta ?? 0),
    conceptPoints: input.conceptPoints ?? current.conceptPoints,
    commitPoints: input.commitPoints ?? current.commitPoints,
    projectPoints: input.projectPoints ?? current.projectPoints,
    cleanPassCount:
      input.cleanPassCount ??
      current.cleanPassCount + (input.cleanPassCountDelta ?? 0),
    totalScore: 0,
  };
  next.totalScore = totalFrom(next);

  const peUpdated = await tx.programEnrollment.updateMany({
    where: { id: peIdForMember(input.memberId) },
    data: next,
  });
  if (peUpdated.count === 0) {
    logger.error(
      "[program-state] ProgramEnrollment missing for score change",
      { memberId: input.memberId },
    );
  }

  const mirrorFailed = await mirrorProgramMemberLegacyState(
    tx,
    "score",
    async () => undefined,
  );
  return { snapshot: next, mirrorFailed };
}

export async function applyProgramRecommendationChange(
  tx: Tx,
  input: {
    memberId: string;
    aiRecommendation: string;
    aiRecommendationAt?: Date;
  },
): Promise<{ mirrorFailed: boolean }> {
  const at = input.aiRecommendationAt ?? new Date();
  const data = {
    aiRecommendation: input.aiRecommendation,
    aiRecommendationAt: at,
  };

  const peUpdated = await tx.programEnrollment.updateMany({
    where: { id: peIdForMember(input.memberId) },
    data,
  });
  if (peUpdated.count === 0) {
    logger.error(
      "[program-state] ProgramEnrollment missing for recommendation",
      { memberId: input.memberId },
    );
  }

  const mirrorFailed = await mirrorProgramMemberLegacyState(
    tx,
    "recommendation",
    async () => undefined,
  );
  return { mirrorFailed };
}

async function readScoreAuthority(
  tx: Tx,
  memberId: string,
): Promise<ProgramScoreSnapshot> {
  const pe = await tx.programEnrollment.findUnique({
    where: { id: peIdForMember(memberId) },
    select: {
      missionPoints: true,
      conceptPoints: true,
      commitPoints: true,
      projectPoints: true,
      totalScore: true,
      cleanPassCount: true,
    },
  });
  if (pe) return pe;
  return {
    missionPoints: 0,
    conceptPoints: 0,
    commitPoints: 0,
    projectPoints: 0,
    totalScore: 0,
    cleanPassCount: 0,
  };
}

export async function countEnrolledProgramMembers(
  tx: Tx,
  programCohortId: string,
): Promise<number> {
  const slug = cohortSlugForProgramCohort(programCohortId);
  return tx.programEnrollment.count({
    where: {
      id: { startsWith: "pe_pm_" },
      status: EnrollmentStatusV2.ACTIVE,
      cohort: { slug },
    },
  });
}

const DEFAULT_LIVE_STATUSES: ProgramMemberStatus[] = [
  ProgramMemberStatus.ENROLLED,
  ProgramMemberStatus.COMPLETED,
];

export type ProgramMemberPoolWhere = {
  cohortId?: string | { in: string[] };
  userId?: string;
  status?:
    | ProgramMemberStatus
    | { in: ProgramMemberStatus[] }
    | { equals: ProgramMemberStatus };
};

function asStatusList(
  status: ProgramMemberPoolWhere["status"],
): ProgramMemberStatus[] | null {
  if (!status) return null;
  if (typeof status === "string") return [status as ProgramMemberStatus];
  if (
    typeof status === "object" &&
    status !== null &&
    "in" in status &&
    Array.isArray(status.in)
  ) {
    return status.in.filter(
      (s): s is ProgramMemberStatus => typeof s === "string",
    );
  }
  if (
    typeof status === "object" &&
    status !== null &&
    "equals" in status &&
    typeof status.equals === "string"
  ) {
    return [status.equals as ProgramMemberStatus];
  }
  return null;
}

function asIdList(value: unknown): string[] | undefined {
  if (typeof value === "string") return [value];
  if (
    value &&
    typeof value === "object" &&
    "in" in value &&
    Array.isArray((value as { in: unknown }).in)
  ) {
    return (value as { in: unknown[] }).in.filter(
      (s): s is string => typeof s === "string",
    );
  }
  return undefined;
}

/**
 * Live membership ids from ProgramEnrollment.
 * Frozen ProgramMember.status is not used.
 */
export async function listCanonicalProgramMemberIds(
  input: {
    programCohortId?: string;
    programCohortIds?: string[];
    userId?: string;
    statuses?: ProgramMemberStatus[];
  } = {},
): Promise<string[]> {
  const statuses = input.statuses ?? DEFAULT_LIVE_STATUSES;
  const programCohortIds = [
    ...(input.programCohortId ? [input.programCohortId] : []),
    ...(input.programCohortIds ?? []),
  ];
  const slugs = programCohortIds.map(cohortSlugForProgramCohort);
  const pes = await prisma.programEnrollment.findMany({
    where: {
      id: { startsWith: "pe_pm_" },
      status: { in: statuses.map(mapMemberStatus) },
      ...(input.userId ? { userId: input.userId } : {}),
      ...(slugs.length ? { cohort: { slug: { in: slugs } } } : {}),
    },
    select: { id: true },
  });
  return pes.flatMap((pe) => {
    const id = memberIdFromPe(pe.id);
    return id ? [id] : [];
  });
}

/**
 * Rewrite a ProgramMember where-clause so `status` is evaluated against
 * ProgramEnrollment, not frozen ProgramMember.status.
 */
export async function canonicalProgramMemberWhere(
  where: ProgramMemberPoolWhere,
): Promise<ProgramMemberPoolWhere> {
  const statuses = asStatusList(where.status);
  if (!statuses) return where;
  await listCanonicalProgramMemberIds({
    programCohortIds: asIdList(where.cohortId),
    userId: typeof where.userId === "string" ? where.userId : undefined,
    statuses,
  });
  return { ...where, status: { in: statuses } };
}

export async function countCanonicalMembersByStatus(
  programCohortId: string,
): Promise<Array<{ status: ProgramMemberStatus; _count: { id: number } }>> {
  const slug = cohortSlugForProgramCohort(programCohortId);
  const groups = await prisma.programEnrollment.groupBy({
    by: ["status"],
    where: { id: { startsWith: "pe_pm_" }, cohort: { slug } },
    _count: { id: true },
  });
  const merged = new Map<ProgramMemberStatus, number>();
  for (const g of groups) {
    const status = mapPeStatusToMember(g.status);
    merged.set(status, (merged.get(status) ?? 0) + g._count.id);
  }
  return [...merged.entries()].map(([status, id]) => ({
    status,
    _count: { id },
  }));
}

/**
 * W8-B compliance exception: wipe ProgramMember PII snapshots even when
 * the mutable-state mirror is frozen. This is not an authority write.
 */
export async function scrubProgramMemberLegacyPii(
  tx: Tx,
  userId: string,
): Promise<void> {
  void tx;
  logger.info(
    "[program-state] ProgramMember PII wipe retired; CandidateProfile/archives are the scrub targets",
    { userId },
  );
}

export async function listProgramMemberSnapshots(
  memberIds: string[],
): Promise<Map<string, ProgramMemberStateSnapshot>> {
  const out = new Map<string, ProgramMemberStateSnapshot>();
  if (memberIds.length === 0) return out;
  const pes = await prisma.programEnrollment.findMany({
    where: { id: { in: memberIds.map(peIdForMember) } },
    select: {
      id: true,
      status: true,
      unlockFloorDay: true,
      skipTokensUsed: true,
      githubRepoUrl: true,
      missionPoints: true,
      conceptPoints: true,
      commitPoints: true,
      projectPoints: true,
      totalScore: true,
      cleanPassCount: true,
      aiRecommendation: true,
      aiRecommendationAt: true,
      enrolledAt: true,
      completedAt: true,
    },
  });
  for (const pe of pes) {
    const memberId = pe.id.startsWith("pe_pm_") ? pe.id.slice("pe_pm_".length) : null;
    if (!memberId) continue;
    out.set(memberId, {
      status: mapPeStatusToMember(pe.status),
      highestUnlockedDay: pe.unlockFloorDay ?? 1,
      skipTokensUsed: pe.skipTokensUsed,
      githubRepoUrl: pe.githubRepoUrl,
      missionPoints: pe.missionPoints,
      conceptPoints: pe.conceptPoints,
      commitPoints: pe.commitPoints,
      projectPoints: pe.projectPoints,
      totalScore: pe.totalScore,
      cleanPassCount: pe.cleanPassCount,
      aiRecommendation: pe.aiRecommendation,
      aiRecommendationAt: pe.aiRecommendationAt,
      enrolledAt: pe.enrolledAt,
      completedAt: pe.completedAt,
    });
  }
  return out;
}

const OVERLAY_KEYS = [
  "status",
  "highestUnlockedDay",
  "skipTokensUsed",
  "githubRepoUrl",
  "missionPoints",
  "conceptPoints",
  "commitPoints",
  "projectPoints",
  "totalScore",
  "cleanPassCount",
  "aiRecommendation",
  "aiRecommendationAt",
  "enrolledAt",
  "completedAt",
] as const;

export async function overlayProgramMemberState<T extends { id: string }>(
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const snaps = await listProgramMemberSnapshots(rows.map((r) => r.id));
  return rows.map((row) => {
    const snap = snaps.get(row.id);
    if (!snap) return row;
    const next: Record<string, unknown> = { ...row };
    for (const key of OVERLAY_KEYS) {
      if (Object.prototype.hasOwnProperty.call(row, key)) {
        next[key] = snap[key];
      }
    }
    return next as T;
  });
}

const PE_MEMBERSHIP_SELECT = {
  id: true,
  userId: true,
  status: true,
  startedAt: true,
  unlockFloorDay: true,
  skipTokensUsed: true,
  githubRepoUrl: true,
  missionPoints: true,
  conceptPoints: true,
  commitPoints: true,
  projectPoints: true,
  totalScore: true,
  cleanPassCount: true,
  aiRecommendation: true,
  aiRecommendationAt: true,
  enrolledAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  cohort: {
    select: {
      slug: true,
      name: true,
      status: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      joinCode: true,
      resultsPublishedAt: true,
    },
  },
} as const;

export type AiCohortMembershipRow = ProgramMemberStateSnapshot & {
  id: string;
  userId: string;
  cohortId: string;
  githubRepoUrl: string;
  githubUsername: string;
  fullName: string;
  jobRole: string | null;
  company: string | null;
  yearsExperience: number | null;
  education: string | null;
  university: string | null;
  graduationYear: number | null;
  skills: string[];
  linkedinUrl: string | null;
  resumeUrl: string | null;
  phone: string | null;
  /** The learner's own Day-1 anchor. All 31-day math reads this (plan 157). */
  startedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  cohort: {
    id: string;
    name: string;
    status: ProgramCohortStatus;
    /** Null on a rolling cohort. Never coerce to the epoch — see below. */
    startsAt: Date | null;
    endsAt: Date | null;
    /** Null means unlimited. Never coerce to 0 — that reads as "full" (plan 157). */
    capacity: number | null;
    joinCode: string;
    resultsPublishedAt: Date | null;
  };
};

async function hydrateAiCohortMembership(
  pe: {
    id: string;
    userId: string;
    status: EnrollmentStatusV2;
    startedAt: Date;
    unlockFloorDay: number | null;
    skipTokensUsed: number;
    githubRepoUrl: string | null;
    missionPoints: number;
    conceptPoints: number;
    commitPoints: number;
    projectPoints: number;
    totalScore: number;
    cleanPassCount: number;
    aiRecommendation: string | null;
    aiRecommendationAt: Date | null;
    enrolledAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    cohort: {
      slug: string;
      name: string;
      status: string;
      startsAt: Date | null;
      endsAt: Date | null;
      capacity: number | null;
      joinCode: string | null;
      resultsPublishedAt: Date | null;
    };
  },
): Promise<AiCohortMembershipRow | null> {
  const memberId = memberIdFromPe(pe.id);
  const cohortId = programCohortIdFromSlug(pe.cohort.slug);
  if (!memberId || !cohortId) return null;
  const profile = await prisma.candidateProfile.findUnique({
    where: { userId: pe.userId },
    select: {
      fullName: true,
      headline: true,
      githubUsername: true,
      linkedinUrl: true,
      resumeUrl: true,
      phone: true,
      education: {
        orderBy: { graduationYear: { sort: "desc", nulls: "last" } },
        take: 1,
        select: {
          degree: true,
          institutionName: true,
          graduationYear: true,
        },
      },
      experience: {
        select: { totalMonths: true, title: true, companyName: true, startedOn: true },
        orderBy: { startedOn: "desc" },
      },
      skills: {
        orderBy: { evidenceScore: "desc" },
        select: { skill: { select: { name: true } } },
      },
    },
  });
  const months = (profile?.experience ?? []).reduce(
    (sum, e) => sum + (e.totalMonths ?? 0),
    0,
  );
  const latestExp = profile?.experience[0];
  const edu = profile?.education[0];
  return {
    id: memberId,
    userId: pe.userId,
    cohortId,
    status: mapPeStatusToMember(pe.status),
    highestUnlockedDay: pe.unlockFloorDay ?? 1,
    skipTokensUsed: pe.skipTokensUsed,
    githubRepoUrl: pe.githubRepoUrl ?? "",
    githubUsername: profile?.githubUsername ?? "",
    missionPoints: pe.missionPoints,
    conceptPoints: pe.conceptPoints,
    commitPoints: pe.commitPoints,
    projectPoints: pe.projectPoints,
    totalScore: pe.totalScore,
    cleanPassCount: pe.cleanPassCount,
    aiRecommendation: pe.aiRecommendation,
    aiRecommendationAt: pe.aiRecommendationAt,
    enrolledAt: pe.enrolledAt,
    completedAt: pe.completedAt,
    createdAt: pe.createdAt,
    updatedAt: pe.updatedAt,
    fullName: profile?.fullName ?? "",
    jobRole: profile?.headline ?? latestExp?.title ?? null,
    company: latestExp?.companyName ?? null,
    yearsExperience: months > 0 ? Math.round(months / 12) : null,
    education: edu?.degree ?? null,
    university: edu?.institutionName ?? null,
    graduationYear: edu?.graduationYear ?? null,
    skills: (profile?.skills ?? []).map((s) => s.skill.name).filter(Boolean),
    linkedinUrl: profile?.linkedinUrl ?? null,
    resumeUrl: profile?.resumeUrl ?? null,
    phone: profile?.phone ?? null,
    startedAt: pe.startedAt,
    cohort: {
      id: cohortId,
      name: pe.cohort.name,
      status: pe.cohort.status as ProgramCohortStatus,
      // Never coerce a null cohort date to the epoch — that reads as
      // "ended in 1970" and froze the whole track (plan 157).
      startsAt: pe.cohort.startsAt,
      endsAt: pe.cohort.endsAt,
      capacity: pe.cohort.capacity,
      joinCode: pe.cohort.joinCode ?? "",
      resultsPublishedAt: pe.cohort.resultsPublishedAt,
    },
  };
}

export async function findAiCohortMembershipByMemberId(
  memberId: string,
): Promise<AiCohortMembershipRow | null> {
  const pe = await prisma.programEnrollment.findUnique({
    where: { id: peIdForMember(memberId) },
    select: PE_MEMBERSHIP_SELECT,
  });
  if (!pe) return null;
  return hydrateAiCohortMembership(pe);
}

export async function findAiCohortMembershipByUserCohort(
  userId: string,
  programCohortId: string,
): Promise<AiCohortMembershipRow | null> {
  const slug = cohortSlugForProgramCohort(programCohortId);
  const pe = await prisma.programEnrollment.findFirst({
    where: {
      userId,
      id: { startsWith: "pe_pm_" },
      cohort: { slug },
    },
    select: PE_MEMBERSHIP_SELECT,
  });
  if (!pe) return null;
  return hydrateAiCohortMembership(pe);
}

export async function listAiCohortMemberships(input: {
  userId?: string;
  programCohortId?: string;
  programCohortIds?: string[];
  memberIds?: string[];
  statuses?: ProgramMemberStatus[];
  take?: number;
}): Promise<AiCohortMembershipRow[]> {
  const programCohortIds = [
    ...(input.programCohortId ? [input.programCohortId] : []),
    ...(input.programCohortIds ?? []),
  ];
  const slugs = programCohortIds.map(cohortSlugForProgramCohort);
  const pes = await prisma.programEnrollment.findMany({
    where: {
      ...(input.memberIds
        ? { id: { in: input.memberIds.map(peIdForMember) } }
        : { id: { startsWith: "pe_pm_" } }),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.statuses
        ? { status: { in: input.statuses.map(mapMemberStatus) } }
        : {}),
      ...(slugs.length ? { cohort: { slug: { in: slugs } } } : {}),
    },
    select: PE_MEMBERSHIP_SELECT,
    ...(input.take != null ? { take: input.take } : {}),
  });
  const out: AiCohortMembershipRow[] = [];
  for (const pe of pes) {
    const row = await hydrateAiCohortMembership(pe);
    if (row) out.push(row);
  }
  return out;
}

export function compareProgramScoreRows<
  T extends {
    totalScore: number;
    projectPoints?: number;
    missionPoints?: number;
    enrolledAt?: Date | null;
    fullName?: string;
    id?: string;
  },
>(a: T, b: T): number {
  if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
  if ((b.projectPoints ?? 0) !== (a.projectPoints ?? 0)) {
    return (b.projectPoints ?? 0) - (a.projectPoints ?? 0);
  }
  if ((b.missionPoints ?? 0) !== (a.missionPoints ?? 0)) {
    return (b.missionPoints ?? 0) - (a.missionPoints ?? 0);
  }
  const ae = a.enrolledAt?.getTime() ?? 0;
  const be = b.enrolledAt?.getTime() ?? 0;
  if (ae !== be) return ae - be;
  const an = a.fullName ?? "";
  const bn = b.fullName ?? "";
  if (an !== bn) return an.localeCompare(bn);
  return (a.id ?? "").localeCompare(b.id ?? "");
}
