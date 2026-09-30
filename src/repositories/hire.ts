import "server-only";
import type { Prisma } from "@prisma/client";
import {
  Domain,
  EnrollmentStatus,
  ProgramCohortStatus,
  ProgramMemberStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { listAiCohortMemberships } from "@/repositories/program-state";
import {
  cohortSlugForDomain,
  domainFromChallengeCohortSlug,
  peIdForMember,
  memberIdFromPe,
} from "@/repositories/ids";
import { issuedChallengeEnrollmentIds } from "@/repositories/credentials";
import { overlayChallengeProgressFields } from "@/repositories/progress";
import { mapPeToEnrollmentStatus } from "@/repositories/learning";
import {
  loadRecruiterIdentities,
  RECRUITER_FIELD_POLICY,
  searchableUserWhere,
  type RecruiterPublicIdentity,
} from "@/repositories/talent";

/**
 * Candidate reads for `/hire`.
 *
 * This is the Phase 6 seam for the recruiter desk. Everything in
 * `src/features/hire/` that needs a row about a *person* comes through here, so
 * the day the 078 model becomes authoritative the desk switches with the rest of
 * the platform instead of being rewritten.
 *
 * What is deliberately NOT here: `TalentRequest`, `TalentRequestMatch`,
 * `TalentEngagementRequest` and friends. Those tables are owned by the hire
 * product, have no legacy/new duality, and are not part of the 078 migration —
 * wrapping them in a flag-branched repository would buy nothing and cost a layer.
 * The rule this file exists to enforce is narrower and more useful: **no `/hire`
 * code reads a table that 078 migrates.**
 *
 * Shaping stays in `features/hire/`. This returns rows; dossiers, scores and
 * cards are built on top. The row types below are therefore the contract both
 * implementations must satisfy (078 §8.2).
 */


/**
 * Identity for a candidate with no `CandidateProfile` row, or on the legacy
 * read path. Field exposure follows the same {@link RECRUITER_FIELD_POLICY} as
 * every other path (plan 133) — this fallback used to hard-code assessment
 * scores as shown, so the same person was treated differently by row source.
 */
function identityFromLegacyProfile(p: {
  fullName?: string | null;
  role?: string | null;
  yearsExperience?: number | null;
  graduationYear?: number | null;
  college?: string | null;
  skills?: string[] | null;
  linkedinUrl?: string | null;
  githubUsername?: string | null;
  resumeUrl?: string | null;
} | null): RecruiterPublicIdentity {
  return {
    fullName: p?.fullName ?? "",
    role: p?.role ?? null,
    yearsExperience: p?.yearsExperience ?? null,
    graduationYear: p?.graduationYear ?? null,
    education: null,
    university: p?.college ?? null,
    skills: p?.skills ?? [],
    hasLinkedin: RECRUITER_FIELD_POLICY.linkedin && Boolean(p?.linkedinUrl),
    hasGithub: RECRUITER_FIELD_POLICY.github && Boolean(p?.githubUsername),
    hasResume: RECRUITER_FIELD_POLICY.resume && Boolean(p?.resumeUrl),
  };
}

/* ── program (AI cohort) ──────────────────────────────────────────────────── */

export type ProgramPoolWhere = {
  cohortId?: string | { in: string[] };
  status?: ProgramMemberStatus | { in: ProgramMemberStatus[] };
};

function programWhereCohortIds(
  where: ProgramPoolWhere,
): string[] | undefined {
  const value = where.cohortId;
  if (typeof value === "string") return [value];
  if (
    value &&
    typeof value === "object" &&
    "in" in value &&
    Array.isArray(value.in)
  ) {
    return value.in.filter((id): id is string => typeof id === "string");
  }
  return undefined;
}

function programWhereStatuses(
  where: ProgramPoolWhere,
): ProgramMemberStatus[] {
  const value = where.status;
  if (typeof value === "string") return [value as ProgramMemberStatus];
  if (
    value &&
    typeof value === "object" &&
    "in" in value &&
    Array.isArray(value.in)
  ) {
    return value.in.filter(
      (s): s is ProgramMemberStatus => typeof s === "string",
    );
  }
  return [ProgramMemberStatus.ENROLLED, ProgramMemberStatus.COMPLETED];
}

export type ProgramCandidateRow = {
  id: string;
  userId: string;
  cohortId: string;
  status: ProgramMemberStatus;
  fullName: string;
  jobRole: string | null;
  company: string | null;
  missionPoints: number;
  totalScore: number;
  yearsExperience: number | null;
  education: string | null;
  university: string | null;
  graduationYear: number | null;
  skills: string[];
  updatedAt: Date;
  /** The learner's own Day-1 anchor. Day math reads this, not cohort.startsAt (plan 157). */
  startedAt: Date;
  cohort: { id: string; startsAt: Date | null };
  commitDays: { date: Date }[];
  projects: {
    aiScore: number | null;
    adminScore: number | null;
    status: string;
  }[];
  interview: {
    status: string;
    overallScore: number | null;
    commScore: number | null;
    techScore: number | null;
    problemScore: number | null;
  } | null;
  hasLinkedin: boolean;
  hasGithub: boolean;
  hasResume: boolean;
};

/**
 * `where` describes which *pool* to search — cohorts, statuses. The visibility
 * gate is added here and cannot be passed in, overridden or omitted: 078 §10.1
 * requires it to be a single object that cannot be half-applied, and a gate a
 * caller has to remember is one a caller will eventually forget.
 */
export async function listProgramCandidates(
  where: ProgramPoolWhere,
): Promise<ProgramCandidateRow[]> {
  const members = await listAiCohortMemberships({
    programCohortIds: programWhereCohortIds(where),
    statuses: programWhereStatuses(where),
  });
  if (members.length === 0) return [];
  const searchable = await prisma.user.findMany({
    where: {
      AND: [
        searchableUserWhere(),
        { id: { in: members.map((m) => m.userId) } },
      ],
    },
    select: { id: true },
  });
  const visibleIds = new Set(searchable.map((u) => u.id));
  const visible = members.filter((m) => visibleIds.has(m.userId));
  if (visible.length === 0) return [];

  const peIds = visible.map((m) => peIdForMember(m.id));
  const [commitDays, projects, interviews, identities] = await Promise.all([
    prisma.programCommitDay.findMany({
      where: { programEnrollmentId: { in: peIds } },
      select: { programEnrollmentId: true, date: true },
    }),
    prisma.programProject.findMany({
      where: { programEnrollmentId: { in: peIds } },
      select: {
        programEnrollmentId: true,
        aiScore: true,
        adminScore: true,
        status: true,
      },
    }),
    prisma.programInterview.findMany({
      where: { programEnrollmentId: { in: peIds } },
      select: {
        programEnrollmentId: true,
        status: true,
        overallScore: true,
        commScore: true,
        techScore: true,
        problemScore: true,
      },
    }),
    loadRecruiterIdentities(visible.map((m) => m.userId)),
  ]);

  const commitsByPe = new Map<string, { date: Date }[]>();
  for (const row of commitDays) {
    const list = commitsByPe.get(row.programEnrollmentId) ?? [];
    list.push({ date: row.date });
    commitsByPe.set(row.programEnrollmentId, list);
  }
  const projectsByPe = new Map<string, typeof projects>();
  for (const row of projects) {
    const list = projectsByPe.get(row.programEnrollmentId) ?? [];
    list.push(row);
    projectsByPe.set(row.programEnrollmentId, list);
  }
  const interviewByPe = new Map(
    interviews.map((row) => [row.programEnrollmentId, row]),
  );

  return visible.map((m) => {
    const peId = peIdForMember(m.id);
    const idn = identities.get(m.userId);
    const interviewRow = interviewByPe.get(peId) ?? null;
    const interview = RECRUITER_FIELD_POLICY.interviewResults
      ? interviewRow
        ? {
            status: interviewRow.status,
            overallScore: interviewRow.overallScore,
            commScore: interviewRow.commScore,
            techScore: interviewRow.techScore,
            problemScore: interviewRow.problemScore,
          }
        : null
      : null;
    return {
      id: m.id,
      userId: m.userId,
      cohortId: m.cohortId,
      status: m.status,
      fullName: idn?.fullName || m.fullName,
      jobRole: idn?.role ?? m.jobRole,
      company: RECRUITER_FIELD_POLICY.currentEmployer ? m.company : null,
      missionPoints: m.missionPoints,
      totalScore: m.totalScore,
      yearsExperience: idn?.yearsExperience ?? m.yearsExperience,
      education: idn?.education ?? m.education,
      university: idn?.university ?? m.university,
      graduationYear: idn?.graduationYear ?? m.graduationYear,
      skills: idn?.skills.length ? idn.skills : m.skills,
      updatedAt: m.updatedAt,
      startedAt: m.startedAt,
      cohort: { id: m.cohort.id, startsAt: m.cohort.startsAt },
      commitDays: commitsByPe.get(peId) ?? [],
      projects: (projectsByPe.get(peId) ?? []).map((p) => ({
        aiScore: p.aiScore,
        adminScore: p.adminScore,
        status: p.status,
      })),
      interview,
      hasLinkedin: idn?.hasLinkedin ?? false,
      hasGithub: idn?.hasGithub ?? false,
      hasResume: idn?.hasResume ?? false,
    };
  });
}

export type MissionAttemptRow = {
  memberId: string;
  dayNumber: number;
  attemptNumber: number;
  passed: boolean;
  payload: Prisma.JsonValue;
  createdAt: Date;
};

export async function listMissionAttempts(
  memberIds: string[],
): Promise<MissionAttemptRow[]> {
  if (memberIds.length === 0) return [];
const rows = await prisma.activityAttempt.findMany({
  where: {
    enrollmentId: { in: memberIds.map(peIdForMember) },
    id: { startsWith: "aa_ms_" },
    activityId: { startsWith: "act_pd_" },
  },
  select: {
    enrollmentId: true,
    attemptNumber: true,
    passed: true,
    payload: true,
    submittedAt: true,
    createdAt: true,
    activity: { select: { dayNumber: true } },
    evaluations: {
      where: { isAuthoritative: true },
      select: { passed: true },
      take: 1,
    },
  },
  orderBy: [{ createdAt: "asc" }],
});
return rows.flatMap((row) => {
  const memberId = memberIdFromPe(row.enrollmentId);
  const dayNumber = row.activity.dayNumber;
  if (!memberId || dayNumber == null) return [];
  return [
    {
      memberId,
      dayNumber,
      attemptNumber: row.attemptNumber,
      passed: row.evaluations[0]?.passed ?? row.passed,
      payload: row.payload ?? null,
      createdAt: row.submittedAt ?? row.createdAt,
    },
  ];
});
}

export type CurriculumDayRow = {
  dayNumber: number;
  language: string | null;
  missionType: string;
};

export async function listCurriculumDays(): Promise<CurriculumDayRow[]> {
  const days = await prisma.programDay.findMany({
    select: { dayNumber: true, language: true, missionType: true },
  });
  return days.map((d) => ({
    dayNumber: d.dayNumber,
    language: d.language as string | null,
    missionType: d.missionType as string,
  }));
}

/**
 * Which cohorts `/hire` may search. Published cohorts always; running ones only
 * when explicitly opened. Kept here because it is a query; *why* a cohort
 * qualifies stays in `features/hire/pool-policy.ts`.
 */
export async function listPoolCohorts(openIds: string[] | "all" | null): Promise<
  { id: string; name: string; startsAt: Date; resultsPublishedAt: Date | null }[]
> {
  return prisma.programCohort.findMany({
    where: {
      OR: [
        { resultsPublishedAt: { not: null } },
        ...(openIds === "all"
          ? [
              {
                status: {
                  in: [ProgramCohortStatus.ENROLLING, ProgramCohortStatus.ACTIVE],
                },
              },
            ]
          : openIds
            ? [{ id: { in: openIds } }]
            : []),
      ],
    },
    orderBy: { startsAt: "desc" },
    select: { id: true, name: true, startsAt: true, resultsPublishedAt: true },
  });
}

/* ── challenge (60-day + Claude) ──────────────────────────────────────────── */

export type ChallengeCandidateRow = {
  id: string;
  userId: string;
  domain: Domain;
  status: EnrollmentStatus;
  startedAt: Date;
  completedAt: Date | null;
  longestStreak: number;
  currentStreak: number;
  certificateIssued: boolean;
  _count: { submissions: number };
  user: { name: string | null };
  recruiterIdentity: RecruiterPublicIdentity;
};

export async function listChallengeCandidates(
  domains: Domain[],
): Promise<ChallengeCandidateRow[]> {
  const slugs = domains.map((d) => cohortSlugForDomain(d));
  const pes = await prisma.programEnrollment.findMany({
    where: {
      id: { startsWith: "pe_enr_" },
      cohort: { slug: { in: slugs } },
      user: searchableUserWhere(),
    },
    select: {
      id: true,
      userId: true,
      status: true,
      joinedAt: true,
      startedAt: true,
      completedAt: true,
      trackLongestStreak: true,
      trackCurrentStreak: true,
      cohort: { select: { slug: true } },
      user: { select: { name: true } },
    },
  });
  if (pes.length === 0) return [];

  const counts = await prisma.activityAttempt.groupBy({
    by: ["enrollmentId"],
    where: {
      enrollmentId: { in: pes.map((p) => p.id) },
      id: { startsWith: "aa_sub_" },
    },
    _count: { id: true },
  });
  const countByPe = new Map(counts.map((c) => [c.enrollmentId, c._count.id]));
  const withSubs = pes.filter((pe) => (countByPe.get(pe.id) ?? 0) > 0);
  if (withSubs.length === 0) return [];

  const enrollmentIds = withSubs
    .map((pe) => pe.id.slice("pe_enr_".length))
    .filter(Boolean);
  const identities = await loadRecruiterIdentities(
    withSubs.map((r) => r.userId),
  );
  const issued = await issuedChallengeEnrollmentIds(enrollmentIds);
  const overlaid = await overlayChallengeProgressFields(
    withSubs.map((pe) => ({
      id: pe.id.slice("pe_enr_".length),
      daysCompleted: 0,
      currentStreak: pe.trackCurrentStreak,
      longestStreak: pe.trackLongestStreak,
      lastSubmittedDay: null as number | null,
    })),
  );
  const overlayById = new Map(overlaid.map((r) => [r.id, r]));

  return withSubs.flatMap((pe) => {
    const enrollmentId = pe.id.slice("pe_enr_".length);
    const domain = domainFromChallengeCohortSlug(pe.cohort.slug);
    if (!enrollmentId || !domain) return [];
    const overlay = overlayById.get(enrollmentId);
    return [
      {
        id: enrollmentId,
        userId: pe.userId,
        domain,
        status: mapPeToEnrollmentStatus(pe.status),
        startedAt: pe.joinedAt ?? pe.startedAt,
        completedAt: pe.completedAt,
        longestStreak: overlay?.longestStreak ?? pe.trackLongestStreak,
        currentStreak: overlay?.currentStreak ?? pe.trackCurrentStreak,
        certificateIssued: issued.has(enrollmentId),
        _count: { submissions: countByPe.get(pe.id) ?? 0 },
        user: pe.user,
        recruiterIdentity:
          identities.get(pe.userId) ?? identityFromLegacyProfile(null),
      },
    ];
  });
}

/** First / last submission per candidate — the consistency evidence dimension. */
export async function listSubmissionActivity(userIds: string[]) {
  if (userIds.length === 0)
    return [] as {
      userId: string;
      _max: { submittedAt: Date | null; dayNumber: number | null };
      _min: { submittedAt: Date | null };
    }[];
  const attempts = await prisma.activityAttempt.findMany({
    where: {
      id: { startsWith: "aa_sub_" },
      submittedAt: { not: null },
      enrollment: { userId: { in: userIds } },
    },
    select: {
      submittedAt: true,
      enrollment: { select: { userId: true } },
      activity: { select: { dayNumber: true } },
    },
  });
  const byUser = new Map<
    string,
    { maxAt: Date | null; minAt: Date | null; maxDay: number | null }
  >();
  for (const a of attempts) {
    const uid = a.enrollment.userId;
    const cur = byUser.get(uid) ?? {
      maxAt: null,
      minAt: null,
      maxDay: null,
    };
    const at = a.submittedAt;
    if (at && (!cur.maxAt || at > cur.maxAt)) cur.maxAt = at;
    if (at && (!cur.minAt || at < cur.minAt)) cur.minAt = at;
    const day = a.activity.dayNumber;
    if (day != null && (cur.maxDay == null || day > cur.maxDay)) {
      cur.maxDay = day;
    }
    byUser.set(uid, cur);
  }
  return [...byUser.entries()].map(([userId, v]) => ({
    userId,
    _max: { submittedAt: v.maxAt, dayNumber: v.maxDay },
    _min: { submittedAt: v.minAt },
  }));
  
}

export async function listQuizAggregates(userIds: string[]) {
  if (userIds.length === 0)
    return [] as { userId: string; _avg: { score: number | null }; _count: number }[];
  const attempts = await prisma.activityAttempt.findMany({
    where: {
      id: { startsWith: "aa_qa_" },
      enrollment: { userId: { in: userIds } },
    },
    select: {
      score: true,
      enrollment: { select: { userId: true } },
      evaluations: {
        where: { isAuthoritative: true },
        select: { score: true },
        take: 1,
      },
    },
  });
  const byUser = new Map<string, { sum: number; count: number }>();
  for (const a of attempts) {
    const score = a.evaluations[0]?.score ?? a.score;
    if (score == null) continue;
    const cur = byUser.get(a.enrollment.userId) ?? { sum: 0, count: 0 };
    cur.sum += score;
    cur.count += 1;
    byUser.set(a.enrollment.userId, cur);
  }
  return [...byUser.entries()].map(([userId, v]) => ({
    userId,
    _avg: { score: v.count > 0 ? v.sum / v.count : null },
    _count: v.count,
  }));
  
}

/* ── hackathon ────────────────────────────────────────────────────────────── */

const HACKATHON_EVIDENCE_SELECT = {
  userId: true,
  user: { select: { name: true } },
} satisfies Prisma.HackathonParticipantSelect;

export type ProfileCandidateRow = {
  userId: string;
  user: { name: string | null };
  recruiterIdentity: RecruiterPublicIdentity;
};

/**
 * Candidates who are discoverable from their PROFILE alone.
 *
 * "Usable profile" is deliberately narrow and deliberately not a toggle:
 *
 *   - `searchableUserWhere()` — searchable, not withdrawn, not deleted. The one
 *     discovery gate, shared with every other track. NOT `openToWork`, which is
 *     a different question (plan 113).
 *   - at least one skill the candidate claimed by hand. Every search is
 *     stack-matching, so a profile with no skills can never match a requirement;
 *     including it would be noise, not reach. This is NOT an evidence floor —
 *     no cohort, challenge, hackathon or mission is required or consulted.
 *   - a non-blank name, because a card with no name is not a candidate.
 *
 * Nothing here reads `CandidateVisibility` a second time: the gate is merged in
 * via `searchableUserWhere()` so it cannot be forgotten or overwritten.
 */
export async function listProfileCandidates(
  take = 200,
  opts?: { skills?: string[] },
): Promise<ProfileCandidateRow[]> {
  // When the brief names skills, the POOL is people who hold them.
  //
  // Without this the query is `orderBy createdAt desc, take N` — a recency
  // window, not a search. That was harmless while 86 candidates were
  // searchable; with the whole pool open it means an older candidate is
  // unrankable no matter how well they match, because scoring never sees them
  // (plan 161 §2g). Ranking still belongs to score-candidate.ts — this only
  // decides who is considered.
  const wanted = [...new Set((opts?.skills ?? []).map((s) => s.trim()).filter(Boolean))];
  const skillWhere = wanted.length
    ? {
        claimedByCandidate: true,
        skill: { name: { in: wanted, mode: "insensitive" as const } },
      }
    : { claimedByCandidate: true };

  const rows = await prisma.user.findMany({
    where: {
      ...searchableUserWhere(),
      candidateProfile: {
        is: {
          fullName: { not: "" },
          skills: { some: skillWhere },
        },
      },
    },
    select: { id: true, name: true },
    // A stable tiebreaker within the filtered set, no longer the selection.
    orderBy: { createdAt: "desc" },
    take,
  });
  if (rows.length === 0) return [];

  const identities = await loadRecruiterIdentities(rows.map((r) => r.id));
  return rows.map((r) => ({
    userId: r.id,
    user: { name: r.name },
    recruiterIdentity:
      identities.get(r.id) ?? identityFromLegacyProfile(null),
  }));
}

export type HackathonCandidateRow = {
  userId: string;
  user: { name: string | null };
  recruiterIdentity: RecruiterPublicIdentity;
};

/** Default hackathon rows per search. Exported for the search QA probe's cap check. */
export const HACKATHON_POOL_TAKE = 200;

export async function listHackathonCandidates(
  take = HACKATHON_POOL_TAKE,
): Promise<HackathonCandidateRow[]> {
const rows = await prisma.hackathonParticipant.findMany({
  where: {
    team: { submission: { isNot: null } },
    user: searchableUserWhere(),
  },
  select: HACKATHON_EVIDENCE_SELECT,
  take,
});
const identities = await loadRecruiterIdentities(rows.map((r) => r.userId));
return rows.map((r) => ({
  userId: r.userId,
  user: r.user,
  recruiterIdentity:
    identities.get(r.userId) ?? identityFromLegacyProfile(null),
}));
}

/* ── provenance and display ───────────────────────────────────────────────── */

/**
 * Professional name / role for candidates whose profile lives on `ProgramMember`
 * rather than `StudentProfile`. Keyed by the un-FK'd provenance id carried on a
 * match or engagement — never used to *identify* the candidate, only to label a
 * row whose candidate is already known.
 */
export async function listProgramMemberLabels(
  memberIds: string[],
  opts?: { shortlistedByRecruiterUserId?: string },
): Promise<
  {
    id: string;
    fullName: string;
    jobRole: string | null;
    shortlistedBy: { id: string }[];
  }[]
> {
  if (memberIds.length === 0) return [];
  const rows = await listAiCohortMemberships({ memberIds });
  const identities = await loadRecruiterIdentities(rows.map((r) => r.userId));
  const shortlisted = opts?.shortlistedByRecruiterUserId
    ? await prisma.recruiterShortlistItem.findMany({
        where: {
          recruiterUserId: opts.shortlistedByRecruiterUserId,
          memberId: { in: memberIds },
        },
        select: { memberId: true, id: true },
      })
    : [];
  const shortByMember = new Map<string, { id: string }[]>();
  for (const row of shortlisted) {
    const list = shortByMember.get(row.memberId) ?? [];
    list.push({ id: row.id });
    shortByMember.set(row.memberId, list);
  }
  return rows.map((r) => {
    const idn = identities.get(r.userId);
    return {
      id: r.id,
      fullName: idn?.fullName || r.fullName,
      jobRole: idn?.role ?? r.jobRole,
      shortlistedBy: shortByMember.get(r.id) ?? [],
    };
  });
}

export async function listUserDisplayNames(
  userIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
const rows = await prisma.candidateProfile.findMany({
  where: { userId: { in: ids } },
  select: { userId: true, fullName: true },
});
return new Map(
  rows
    .filter((u) => u.fullName.trim())
    .map((u) => [u.userId, u.fullName.trim()]),
);
}

/* ── candidate-ref resolution ─────────────────────────────────────────────── */

/**
 * A candidate ref arrives from a browser. It is a name, not a capability — so
 * each one is re-tested against the same conditions its own pool applies before
 * it may become a shortlist entry or an engagement request. These three carry
 * the gate for that re-test.
 */
export async function resolveProgramRefs(
  memberIds: string[],
): Promise<{ id: string; userId: string }[]> {
  if (memberIds.length === 0) return [];
const pes = await prisma.programEnrollment.findMany({
  where: {
    id: { in: memberIds.map(peIdForMember) },
    status: { in: ["ACTIVE", "COMPLETED"] },
    user: searchableUserWhere(),
  },
  select: { id: true, userId: true },
});
return pes.flatMap((pe) => {
  const id = memberIdFromPe(pe.id);
  return id ? [{ id, userId: pe.userId }] : [];
});
}

export async function resolveChallengeRefs(
  userIds: string[],
  domains: Domain[],
): Promise<{ userId: string; _count: { submissions: number } }[]> {
  if (userIds.length === 0) return [];
  const slugs = domains.map((d) => cohortSlugForDomain(d));
  const pes = await prisma.programEnrollment.findMany({
    where: {
      userId: { in: userIds },
      id: { startsWith: "pe_enr_" },
      cohort: { slug: { in: slugs } },
      user: searchableUserWhere(),
    },
    select: { id: true, userId: true },
  });
  if (pes.length === 0) return [];
  const counts = await prisma.activityAttempt.groupBy({
    by: ["enrollmentId"],
    where: {
      enrollmentId: { in: pes.map((p) => p.id) },
      id: { startsWith: "aa_sub_" },
    },
    _count: { id: true },
  });
  const countByPe = new Map(counts.map((c) => [c.enrollmentId, c._count.id]));
  return pes.map((pe) => ({
    userId: pe.userId,
    _count: { submissions: countByPe.get(pe.id) ?? 0 },
  }));
}

export async function resolveHackathonRefs(
  userIds: string[],
): Promise<{ userId: string }[]> {
  if (userIds.length === 0) return [];
  return prisma.hackathonParticipant.findMany({
    where: {
      userId: { in: userIds },
      team: { submission: { isNot: null } },
      user: searchableUserWhere(),
    },
    select: { userId: true },
  });
}

/**
 * Re-test profile-only refs against the SAME usable-profile condition
 * `listProfileCandidates` searches on.
 *
 * A ref is a name, not a capability: it arrives from the client, so a candidate
 * who has since withdrawn, been deleted, or removed their last skill must stop
 * being shortlistable even though the recruiter still holds the string.
 */
export async function resolveProfileRefs(
  userIds: string[],
): Promise<{ userId: string }[]> {
  if (userIds.length === 0) return [];
  const rows = await prisma.user.findMany({
    where: {
      ...searchableUserWhere(),
      id: { in: userIds },
      candidateProfile: {
        is: {
          fullName: { not: "" },
          skills: { some: { claimedByCandidate: true } },
        },
      },
    },
    select: { id: true },
  });
  return rows.map((r) => ({ userId: r.id }));
}

export type SubmissionActivityRow = Awaited<
  ReturnType<typeof listSubmissionActivity>
>[number];
export type QuizAggregateRow = Awaited<
  ReturnType<typeof listQuizAggregates>
>[number];
