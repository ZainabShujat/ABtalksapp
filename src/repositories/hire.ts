import "server-only";
import type { Prisma } from "@prisma/client";
import { Domain, ProgramCohortStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isNewTalentRepoEnabled } from "@/lib/feature-flags";
import { logger } from "@/lib/logger";
import { searchableUserWhere } from "@/repositories/talent";

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
 * Whether the 078 tables can actually answer these questions yet.
 *
 * Separate from `ENABLE_NEW_TALENT` on purpose. That flag switches `/talent`'s
 * candidate search, which reads `CandidateProfile` — already backfilled for
 * ~10.9k users. The recruiter desk needs considerably more: per-activity
 * attempts and evaluations (`ProgramEnrollment` / `ActivityAttempt` /
 * `ActivityEvaluation`) for the evidence dimensions, and `SkillEvidence` for
 * stack matching. Phase 2e is **stopped**, so none of that is complete.
 *
 * Flipping `ENABLE_NEW_TALENT` must not silently hand the desk a half-backfilled
 * pool, and it must not throw either — `/talent` has to be able to switch on its
 * own. So the desk stays on legacy and says so, once, in the log.
 *
 * Turn this on only when Phase 2e and 2f are complete and Phase 5 verification
 * has passed. See docs/plans/082-hire-on-078-architecture.md §8.
 */
const NEW_HIRE_POOL_READY = false;

let warnedOnce = false;

function newModelActive(): boolean {
  if (!isNewTalentRepoEnabled()) return false;
  if (NEW_HIRE_POOL_READY) return true;
  if (!warnedOnce) {
    warnedOnce = true;
    logger.error(
      "[hire] ENABLE_NEW_TALENT is on but the 078 candidate pool is not ready " +
        "(Phase 2e/2f incomplete). The recruiter desk is still reading legacy tables.",
      {},
    );
  }
  return false;
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
  linkedinUrl: true,
  githubUsername: true,
  resumeUrl: true,
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
}>;

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
    // 078: ProgramEnrollment + EnrollmentProgress + ActivityAttempt/Evaluation.
    // Not implemented — see NEW_HIRE_POOL_READY.
  }
  return prisma.programMember.findMany({
    where: { AND: [where, { user: searchableUserWhere() }] },
    select: PROGRAM_CANDIDATE_SELECT,
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
  if (newModelActive()) {
    // 078: ActivityAttempt joined to ActivityEvaluation.
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
  if (newModelActive()) {
    // 078: Activity rows on the program's published ProgramVersion.
  }
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

export const CHALLENGE_CANDIDATE_SELECT = {
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
  user: {
    select: {
      name: true,
      studentProfile: {
        select: {
          skills: true,
          role: true,
          yearsExperience: true,
          graduationYear: true,
          domain: true,
          linkedinUrl: true,
          githubUsername: true,
          college: true,
          fullName: true,
          resumeUrl: true,
        },
      },
    },
  },
} satisfies Prisma.EnrollmentSelect;

export type ChallengeCandidateRow = Prisma.EnrollmentGetPayload<{
  select: typeof CHALLENGE_CANDIDATE_SELECT;
}>;

export async function listChallengeCandidates(
  domains: Domain[],
): Promise<ChallengeCandidateRow[]> {
  if (newModelActive()) {
    // 078: ProgramEnrollment on the legacy-<domain> cohorts + EnrollmentProgress.
  }
  return prisma.enrollment.findMany({
    where: {
      challenge: { domain: { in: domains } },
      // A candidate is someone with a track record.
      submissions: { some: {} },
      // Finishing days of the challenge is evidence, not permission.
      user: searchableUserWhere(),
    },
    select: CHALLENGE_CANDIDATE_SELECT,
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
  if (newModelActive()) {
    // 078: ActivityAttempt.submittedAt aggregated per enrollment.
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
    // 078: ActivityEvaluation.score over Activity(type = QUIZ).
  }
  return prisma.quizAttempt.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds } },
    _avg: { score: true },
    _count: true,
  });
}

/* ── hackathon ────────────────────────────────────────────────────────────── */

export const HACKATHON_CANDIDATE_SELECT = {
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
} satisfies Prisma.HackathonParticipantSelect;

export type HackathonCandidateRow = Prisma.HackathonParticipantGetPayload<{
  select: typeof HACKATHON_CANDIDATE_SELECT;
}>;

export async function listHackathonCandidates(
  take = 200,
): Promise<HackathonCandidateRow[]> {
  // Hackathons stay a separate bounded subsystem under 078 (§3.4) and reach the
  // profile through CandidateAchievement / Credential / SkillEvidence, so there
  // is no new-model branch to switch to here — only the gate matters.
  return prisma.hackathonParticipant.findMany({
    where: {
      team: { submission: { isNot: null } },
      user: searchableUserWhere(),
    },
    select: HACKATHON_CANDIDATE_SELECT,
    take,
  });
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
  return prisma.programMember.findMany({
    where: { id: { in: memberIds } },
    select: {
      id: true,
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
}

export async function listUserDisplayNames(
  userIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
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
