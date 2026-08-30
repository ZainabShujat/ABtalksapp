import "server-only";
import type { Prisma } from "@prisma/client";
import { Domain, ProgramCohortStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isNewTalentRepoEnabled } from "@/lib/feature-flags";
import { peIdForMember, memberIdFromPe } from "@/repositories/ids";
import {
  loadRecruiterIdentities,
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

function newModelActive(): boolean {
  return isNewTalentRepoEnabled();
}

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
    hasLinkedin: Boolean(p?.linkedinUrl),
    hasGithub: Boolean(p?.githubUsername),
    hasResume: Boolean(p?.resumeUrl),
    showInterviewResults: false,
    showAssessmentScores: true,
    showCurrentEmployer: true,
  };
}

/* ── program (AI cohort) ──────────────────────────────────────────────────── */

export const PROGRAM_CANDIDATE_SELECT = {
  id: true,
  userId: true,
  cohortId: true,
  status: true,
  fullName: true,
  jobRole: true,
  company: true,
  missionPoints: true,
  totalScore: true,
  yearsExperience: true,
  education: true,
  university: true,
  graduationYear: true,
  skills: true,
  updatedAt: true,
  cohort: { select: { id: true, startsAt: true } },
  commitDays: { select: { date: true } },
  projects: { select: { aiScore: true, adminScore: true, status: true } },
  interview: {
    select: {
      status: true,
      overallScore: true,
      commScore: true,
      techScore: true,
      problemScore: true,
    },
  },
} satisfies Prisma.ProgramMemberSelect;

const PROGRAM_EVIDENCE_SELECT = {
  id: true,
  userId: true,
  cohortId: true,
  status: true,
  jobRole: true,
  company: true,
  missionPoints: true,
  totalScore: true,
  yearsExperience: true,
  education: true,
  university: true,
  graduationYear: true,
  skills: true,
  updatedAt: true,
  cohort: { select: { id: true, startsAt: true } },
  commitDays: { select: { date: true } },
  projects: { select: { aiScore: true, adminScore: true, status: true } },
  interview: {
    select: {
      status: true,
      overallScore: true,
      commScore: true,
      techScore: true,
      problemScore: true,
    },
  },
} satisfies Prisma.ProgramMemberSelect;

export type ProgramCandidateRow = Prisma.ProgramMemberGetPayload<{
  select: typeof PROGRAM_CANDIDATE_SELECT;
}> & {
  hasLinkedin: boolean;
  hasGithub: boolean;
  hasResume: boolean;
};

function withLegacyLinkFlags(
  row: Prisma.ProgramMemberGetPayload<{ select: typeof PROGRAM_CANDIDATE_SELECT }>,
  extras?: { linkedinUrl?: string | null; githubUsername?: string | null; resumeUrl?: string | null },
): ProgramCandidateRow {
  return {
    ...row,
    hasLinkedin: Boolean(extras?.linkedinUrl),
    hasGithub: Boolean(extras?.githubUsername),
    hasResume: Boolean(extras?.resumeUrl),
  };
}

/**
 * `where` describes which *pool* to search — cohorts, statuses. The visibility
 * gate is added here and cannot be passed in, overridden or omitted: 078 §10.1
 * requires it to be a single object that cannot be half-applied, and a gate a
 * caller has to remember is one a caller will eventually forget.
 *
 * Combined with `AND` rather than spread alongside the caller's clause: two
 * `user:` keys in one Prisma where-clause silently overwrite each other, which
 * is exactly how a gate disappears without anybody editing it. `AND` cannot be
 * overwritten by anything the caller passes.
 */
export async function listProgramCandidates(
  where: Prisma.ProgramMemberWhereInput,
): Promise<ProgramCandidateRow[]> {
  if (newModelActive()) {
    const rows = await prisma.programMember.findMany({
      where: { AND: [where, { user: searchableUserWhere() }] },
      select: PROGRAM_EVIDENCE_SELECT,
    });
    const identities = await loadRecruiterIdentities(rows.map((r) => r.userId));
    return rows.map((r) => {
      const idn = identities.get(r.userId);
      const interview = idn?.showInterviewResults ? r.interview : null;
      return {
        id: r.id,
        userId: r.userId,
        cohortId: r.cohortId,
        status: r.status,
        fullName: idn?.fullName || "",
        jobRole: idn?.role ?? r.jobRole,
        company: idn?.showCurrentEmployer === false ? null : r.company,
        missionPoints: r.missionPoints,
        totalScore: r.totalScore,
        yearsExperience: idn?.yearsExperience ?? r.yearsExperience,
        education: idn?.education ?? r.education,
        university: idn?.university ?? r.university,
        graduationYear: idn?.graduationYear ?? r.graduationYear,
        skills: idn?.skills.length ? idn.skills : r.skills,
        updatedAt: r.updatedAt,
        cohort: r.cohort,
        commitDays: r.commitDays,
        projects: r.projects,
        interview,
        hasLinkedin: idn?.hasLinkedin ?? false,
        hasGithub: idn?.hasGithub ?? false,
        hasResume: idn?.hasResume ?? false,
      };
    });
  }

  const rows = await prisma.programMember.findMany({
    where: { AND: [where, { user: searchableUserWhere() }] },
    select: {
      ...PROGRAM_CANDIDATE_SELECT,
      linkedinUrl: true,
      githubUsername: true,
      resumeUrl: true,
    },
  });
  return rows.map(({ linkedinUrl, githubUsername, resumeUrl, ...row }) =>
    withLegacyLinkFlags(row, { linkedinUrl, githubUsername, resumeUrl }),
  );
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
  if (newModelActive()) {
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
  return prisma.programMissionSubmission.findMany({
    where: { memberId: { in: memberIds } },
    select: {
      memberId: true,
      dayNumber: true,
      attemptNumber: true,
      passed: true,
      payload: true,
      createdAt: true,
    },
    orderBy: [{ dayNumber: "asc" }, { attemptNumber: "asc" }],
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

const CHALLENGE_EVIDENCE_SELECT = {
  id: true,
  userId: true,
  domain: true,
  status: true,
  startedAt: true,
  completedAt: true,
  longestStreak: true,
  currentStreak: true,
  certificate: { select: { status: true } },
  _count: { select: { submissions: true } },
  user: { select: { name: true } },
} satisfies Prisma.EnrollmentSelect;

export type ChallengeCandidateRow = {
  id: string;
  userId: string;
  domain: Domain;
  status: Prisma.EnrollmentGetPayload<{ select: typeof CHALLENGE_EVIDENCE_SELECT }>["status"];
  startedAt: Date;
  completedAt: Date | null;
  longestStreak: number;
  currentStreak: number;
  certificate: { status: string } | null;
  _count: { submissions: number };
  user: { name: string | null };
  recruiterIdentity: RecruiterPublicIdentity;
};

export async function listChallengeCandidates(
  domains: Domain[],
): Promise<ChallengeCandidateRow[]> {
  if (newModelActive()) {
    const rows = await prisma.enrollment.findMany({
      where: {
        challenge: { domain: { in: domains } },
        submissions: { some: {} },
        user: searchableUserWhere(),
      },
      select: CHALLENGE_EVIDENCE_SELECT,
    });
    const identities = await loadRecruiterIdentities(rows.map((r) => r.userId));
    return rows.map((r) => ({
      ...r,
      recruiterIdentity:
        identities.get(r.userId) ?? identityFromLegacyProfile(null),
    }));
  }

  const rows = await prisma.enrollment.findMany({
    where: {
      challenge: { domain: { in: domains } },
      submissions: { some: {} },
      user: searchableUserWhere(),
    },
    select: {
      ...CHALLENGE_EVIDENCE_SELECT,
      user: {
        select: {
          name: true,
          studentProfile: {
            select: {
              skills: true,
              role: true,
              yearsExperience: true,
              graduationYear: true,
              linkedinUrl: true,
              githubUsername: true,
              college: true,
              fullName: true,
              resumeUrl: true,
            },
          },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    domain: r.domain,
    status: r.status,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    longestStreak: r.longestStreak,
    currentStreak: r.currentStreak,
    certificate: r.certificate,
    _count: r._count,
    user: { name: r.user.name },
    recruiterIdentity: identityFromLegacyProfile(r.user.studentProfile),
  }));
}

/** First / last submission per candidate — the consistency evidence dimension. */
export async function listSubmissionActivity(userIds: string[]) {
  if (userIds.length === 0)
    return [] as {
      userId: string;
      _max: { submittedAt: Date | null; dayNumber: number | null };
      _min: { submittedAt: Date | null };
    }[];
  if (newModelActive()) {
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
  return prisma.submission.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds } },
    _max: { submittedAt: true, dayNumber: true },
    _min: { submittedAt: true },
  });
}

export async function listQuizAggregates(userIds: string[]) {
  if (userIds.length === 0)
    return [] as { userId: string; _avg: { score: number | null }; _count: number }[];
  if (newModelActive()) {
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
  return prisma.quizAttempt.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds } },
    _avg: { score: true },
    _count: true,
  });
}

/* ── hackathon ────────────────────────────────────────────────────────────── */

const HACKATHON_EVIDENCE_SELECT = {
  userId: true,
  user: { select: { name: true } },
} satisfies Prisma.HackathonParticipantSelect;

export type HackathonCandidateRow = {
  userId: string;
  user: { name: string | null };
  recruiterIdentity: RecruiterPublicIdentity;
};

export async function listHackathonCandidates(
  take = 200,
): Promise<HackathonCandidateRow[]> {
  if (newModelActive()) {
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

  const rows = await prisma.hackathonParticipant.findMany({
    where: {
      team: { submission: { isNot: null } },
      user: searchableUserWhere(),
    },
    select: {
      userId: true,
      user: {
        select: {
          name: true,
          studentProfile: {
            select: {
              skills: true,
              role: true,
              yearsExperience: true,
              graduationYear: true,
              linkedinUrl: true,
              githubUsername: true,
              resumeUrl: true,
            },
          },
        },
      },
    },
    take,
  });
  return rows.map((r) => ({
    userId: r.userId,
    user: { name: r.user.name },
    recruiterIdentity: identityFromLegacyProfile(r.user.studentProfile),
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
  const rows = await prisma.programMember.findMany({
    where: { id: { in: memberIds } },
    select: {
      id: true,
      userId: true,
      fullName: true,
      jobRole: true,
      shortlistedBy: opts?.shortlistedByRecruiterUserId
        ? {
            where: { recruiterUserId: opts.shortlistedByRecruiterUserId },
            select: { id: true },
            take: 1,
          }
        : { where: { id: "" }, select: { id: true }, take: 0 },
    },
  });
  if (!newModelActive()) {
    return rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      jobRole: r.jobRole,
      shortlistedBy: r.shortlistedBy,
    }));
  }
  const identities = await loadRecruiterIdentities(rows.map((r) => r.userId));
  return rows.map((r) => {
    const idn = identities.get(r.userId);
    return {
      id: r.id,
      fullName: idn?.fullName || r.fullName,
      jobRole: idn?.role ?? r.jobRole,
      shortlistedBy: r.shortlistedBy,
    };
  });
}

export async function listUserDisplayNames(
  userIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  if (newModelActive()) {
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
  const rows = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(
    rows
      .filter((u) => u.name && u.name.trim())
      .map((u) => [u.id, u.name!.trim()]),
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
  return prisma.programMember.findMany({
    where: {
      id: { in: memberIds },
      status: { in: ["ENROLLED", "COMPLETED"] },
      user: searchableUserWhere(),
    },
    select: { id: true, userId: true },
  });
}

export async function resolveChallengeRefs(
  userIds: string[],
  domains: Domain[],
): Promise<{ userId: string; _count: { submissions: number } }[]> {
  if (userIds.length === 0) return [];
  return prisma.enrollment.findMany({
    where: {
      userId: { in: userIds },
      challenge: { domain: { in: domains } },
      user: searchableUserWhere(),
    },
    select: { userId: true, _count: { select: { submissions: true } } },
  });
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

export type SubmissionActivityRow = Awaited<
  ReturnType<typeof listSubmissionActivity>
>[number];
export type QuizAggregateRow = Awaited<
  ReturnType<typeof listQuizAggregates>
>[number];
