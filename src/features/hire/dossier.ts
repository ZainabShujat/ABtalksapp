import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { encodeCandidateRef } from "@/features/hire/candidate-ref";
import { candidatePublicId } from "@/features/hire/public-id";
import {
  declared,
  derived,
  verified,
} from "@/features/hire/dossier-provenance";
import { roleFamilyFor, tidyRoleLabel } from "@/features/hire/role-family";
import type {
  CandidateDossier,
  EvidenceCoverage,
  ScoreDimension,
} from "@/features/hire/types";
import { PROGRAM_TOTAL_DAYS } from "@/features/program/constants";
import { getCohortCalendarDay } from "@/features/program/progression";

/**
 * The identifying fields a dossier deliberately refuses to carry.
 *
 * Ranking still needs a name (a stable sort tiebreak, and the admin side of an
 * engagement request), so it is returned alongside rather than inside — a
 * dossier that never holds identity cannot leak it, whichever of the four
 * surfaces forgets to strip a field.
 */
export type MemberIdentity = {
  fullName: string;
  jobRole: string;
  company: string;
};

export type DossierSet = {
  dossiers: CandidateDossier[];
  coverage: EvidenceCoverage;
  /** Cohort calendar day per member id — scoring scales expectations to it. */
  cohortDayByMember: Map<string, number>;
  /** Server-side only. Never spread into anything sent to a browser. */
  identityByMember: Map<string, MemberIdentity>;
  /** Denormalised columns the scorer still reads. */
  legacyStatsByMember: Map<
    string,
    { missionPoints: number; totalScore: number; status: string }
  >;
};

/**
 * A mission day the platform handed over at enrolment rather than one the
 * member earned.
 *
 * Every member starts on content day 4 and days 1–3 are written as passed
 * submissions carrying `{reason: "cohort_start_day", waived: true}`. They award
 * points and count toward `cleanPassCount`, so any figure derived from those
 * columns overstates what the person did. Evidence means work, so these are
 * counted separately and never as a pass.
 */
function isWaivedPayload(payload: unknown): boolean {
  return (
    !!payload &&
    typeof payload === "object" &&
    (payload as { waived?: unknown }).waived === true
  );
}

/** Static seeded curriculum; re-reading it per search is a query per turn for
 *  content that changes only on a content seed. */
let dayMetaCache: {
  at: number;
  byDay: Map<number, { language: string | null; missionType: string }>;
} | null = null;
const DAY_META_TTL_MS = 5 * 60 * 1000;

async function getDayMeta(): Promise<
  Map<number, { language: string | null; missionType: string }>
> {
  if (dayMetaCache && Date.now() - dayMetaCache.at < DAY_META_TTL_MS) {
    return dayMetaCache.byDay;
  }
  const days = await prisma.programDay.findMany({
    select: { dayNumber: true, language: true, missionType: true },
  });
  const byDay = new Map(
    days.map((d) => [
      d.dayNumber,
      { language: d.language as string | null, missionType: d.missionType as string },
    ]),
  );
  dayMetaCache = { at: Date.now(), byDay };
  return byDay;
}

const MEMBER_SELECT = {
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
  recruiterVisibilityConsentAt: true,
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

export type AvailabilityRow = {
  userId: string;
  openToWork: boolean;
  expectedSalaryMin: number | null;
  expectedSalaryMax: number | null;
  salaryCurrency: string;
  noticePeriodDays: number | null;
  preferredWorkMode: string | null;
  preferredCities: string[];
  openToRelocate: boolean;
};

/**
 * Opt-in logistics, loaded separately so a missing `CandidateAvailability`
 * table cannot take the whole search down with it. Nested Prisma selects
 * JOIN that table; if the hire migration has not been applied, every
 * member query 500s and the recruiter sees a toast instead of cards.
 */
let availabilityMissing = false;

export async function loadAvailabilityByUserId(
  userIds: string[],
): Promise<Map<string, AvailabilityRow>> {
  if (availabilityMissing) return new Map();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  try {
    const rows = await prisma.candidateAvailability.findMany({
      where: { userId: { in: ids } },
      select: {
        userId: true,
        openToWork: true,
        expectedSalaryMin: true,
        expectedSalaryMax: true,
        salaryCurrency: true,
        noticePeriodDays: true,
        preferredWorkMode: true,
        preferredCities: true,
        openToRelocate: true,
      },
    });
    return new Map(rows.map((r) => [r.userId, r]));
  } catch (error) {
    availabilityMissing = true;
    logger.error("[hire] CandidateAvailability unread", {
      error: String(error).slice(0, 240),
    });
    return new Map();
  }
}

/**
 * Assemble dossiers for every member matching `where`, plus the coverage of
 * the resulting pool.
 *
 * Coverage is a property of the pool, not of a person: whether the projects
 * dimension means anything depends on whether *anybody* here could have a
 * graded project yet. That is why this returns a set rather than exposing a
 * per-member builder — a dossier built alone would have to guess.
 *
 * Four queries regardless of pool size: members (with their nested evidence),
 * mission submissions, the curriculum day map, and nothing else.
 */
export async function buildDossierSet(
  where: Prisma.ProgramMemberWhereInput,
): Promise<DossierSet> {
  const members = await prisma.programMember.findMany({
    where,
    select: MEMBER_SELECT,
  });

  if (members.length === 0) {
    return {
      dossiers: [],
      coverage: {
        dimensions: fullCoverage(false),
        note: "No candidates in the pool yet.",
      },
      cohortDayByMember: new Map(),
      identityByMember: new Map(),
      legacyStatsByMember: new Map(),
    };
  }

  const memberIds = members.map((m) => m.id);
  const [submissions, dayMeta, availability] = await Promise.all([
    prisma.programMissionSubmission.findMany({
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
    }),
    getDayMeta(),
    loadAvailabilityByUserId(members.map((m) => m.userId)),
  ]);

  const subsByMember = new Map<string, typeof submissions>();
  for (const s of submissions) {
    const list = subsByMember.get(s.memberId) ?? [];
    list.push(s);
    subsByMember.set(s.memberId, list);
  }

  const cohortDayByMember = new Map<string, number>();
  const identityByMember = new Map<string, MemberIdentity>();
  const legacyStatsByMember = new Map<
    string,
    { missionPoints: number; totalScore: number; status: string }
  >();
  const dossiers: CandidateDossier[] = [];

  for (const m of members) {
    identityByMember.set(m.id, {
      fullName: m.fullName,
      jobRole: m.jobRole,
      company: m.company,
    });
    legacyStatsByMember.set(m.id, {
      missionPoints: m.missionPoints,
      totalScore: m.totalScore,
      status: m.status,
    });

    const subs = subsByMember.get(m.id) ?? [];

    // Earned work only. A waived day is recorded, reported, and never counted
    // as a pass.
    const waivedDays = new Set<number>();
    const passedDays = new Set<number>();
    const attemptedDays = new Set<number>();
    const cleanPassDays = new Set<number>();
    let lastSubmissionAt: Date | null = null;

    for (const s of subs) {
      if (isWaivedPayload(s.payload)) {
        waivedDays.add(s.dayNumber);
        continue;
      }
      attemptedDays.add(s.dayNumber);
      if (!lastSubmissionAt || s.createdAt > lastSubmissionAt) {
        lastSubmissionAt = s.createdAt;
      }
      if (s.passed) {
        passedDays.add(s.dayNumber);
        // First run through the checks. `subs` is ordered by attempt, so the
        // first passing row for a day is its earliest pass.
        if (s.attemptNumber === 1) cleanPassDays.add(s.dayNumber);
      }
    }

    const missionsPassed = passedDays.size;
    const missionsAttempted = attemptedDays.size;
    const cleanPassCount = cleanPassDays.size;
    const cleanPassPct =
      missionsPassed > 0
        ? Math.round((cleanPassCount / missionsPassed) * 100)
        : 0;

    const workingLanguages = [
      ...new Set(
        [...passedDays]
          .map((d) => dayMeta.get(d)?.language)
          .filter((l): l is string => Boolean(l)),
      ),
    ].sort();

    const missionTypesPassed = [
      ...new Set(
        [...passedDays]
          .map((d) => dayMeta.get(d)?.missionType)
          .filter((t): t is string => Boolean(t)),
      ),
    ].sort();

    const commitDates = m.commitDays
      .map((c) => c.date.getTime())
      .sort((a, b) => a - b);
    const activeDaysSpan =
      commitDates.length > 1
        ? Math.round(
            (commitDates[commitDates.length - 1]! - commitDates[0]!) / 86_400_000,
          ) + 1
        : commitDates.length;

    const lastCommitAt =
      commitDates.length > 0
        ? new Date(commitDates[commitDates.length - 1]!)
        : null;
    const lastActiveAt =
      lastSubmissionAt && lastCommitAt
        ? new Date(Math.max(lastSubmissionAt.getTime(), lastCommitAt.getTime()))
        : (lastSubmissionAt ?? lastCommitAt);

    const projectScores = m.projects
      .filter((p) => p.status === "GRADED")
      .map((p) => p.adminScore ?? p.aiScore)
      .filter((n): n is number => typeof n === "number");

    const iv = m.interview;
    const interviewScores =
      iv &&
      (iv.overallScore != null ||
        iv.commScore != null ||
        iv.techScore != null ||
        iv.problemScore != null)
        ? {
            overall: iv.overallScore,
            comm: iv.commScore,
            tech: iv.techScore,
            problem: iv.problemScore,
          }
        : null;

    const cohortDay = getCohortCalendarDay({ startsAt: m.cohort.startsAt });
    cohortDayByMember.set(m.id, cohortDay);

    const av = availability.get(m.userId) ?? null;

    dossiers.push({
      publicId: candidatePublicId(m.id),
      source: "PROGRAM",
      candidateRef: encodeCandidateRef("PROGRAM", m.id),
      programMemberId: m.id,
      userId: m.userId,

      roleFamily: derived(roleFamilyFor(m.jobRole)),
      rawRoleLabel: declared(tidyRoleLabel(m.jobRole)),
      yearsExperience: declared(m.yearsExperience),
      education: declared({
        level: m.education,
        university: m.university,
        gradYear: m.graduationYear,
      }),
      declaredSkills: declared(m.skills),
      links: declared({
        linkedin: Boolean(m.linkedinUrl),
        github: Boolean(m.githubUsername),
        resume: Boolean(m.resumeUrl),
      }),

      evidence: {
        missionsPassed: verified(missionsPassed, lastSubmissionAt),
        missionsAttempted: verified(missionsAttempted, lastSubmissionAt),
        missionsWaived: verified(waivedDays.size),
        cleanPassCount: verified(cleanPassCount, lastSubmissionAt),
        cleanPassPct: derived(cleanPassPct),
        commitDays: verified(m.commitDays.length, lastCommitAt),
        activeDaysSpan: derived(activeDaysSpan),
        lastActiveAt: verified(lastActiveAt ? lastActiveAt.toISOString() : null),
        projectScores: verified(projectScores),
        interview: verified(interviewScores),
        workingLanguages: derived(workingLanguages),
        missionTypesPassed: verified(missionTypesPassed),
        cohortProgress: derived({ day: cohortDay, ofDays: PROGRAM_TOTAL_DAYS }),
      },

      compensation: {
        declared:
          av?.expectedSalaryMin != null || av?.expectedSalaryMax != null
            ? {
                min: av.expectedSalaryMin ?? 0,
                max: av.expectedSalaryMax ?? av.expectedSalaryMin ?? 0,
                currency: av.salaryCurrency,
              }
            : null,
        // Filled by the caller that knows the evidence tier — see
        // features/hire/compensation.ts. Left null here so the dossier never
        // carries a band nobody asked for.
        estimate: null,
      },

      availability: av
        ? {
            openToWork: av.openToWork,
            expectedSalaryMin: av.expectedSalaryMin,
            expectedSalaryMax: av.expectedSalaryMax,
            salaryCurrency: av.salaryCurrency,
            noticePeriodDays: av.noticePeriodDays,
            preferredWorkMode: av.preferredWorkMode,
            preferredCities: av.preferredCities,
            openToRelocate: av.openToRelocate,
          }
        : null,
    });
  }

  return {
    dossiers,
    coverage: computeCoverage(dossiers),
    cohortDayByMember,
    identityByMember,
    legacyStatsByMember,
  };
}

function fullCoverage(value: boolean): Record<ScoreDimension, boolean> {
  return {
    stack: value,
    missions: value,
    cleanPass: value,
    projects: value,
    consistency: value,
    interview: value,
    experience: value,
  };
}

/**
 * Which dimensions this pool can produce evidence for at all.
 *
 * Declared dimensions (stack, experience) always count — the member typed
 * them, so they exist. Mission, clean-pass and consistency evidence exists as
 * soon as anybody has earned a pass or logged a commit day. Projects and
 * interviews are the ones that lag: they are cohort milestones, so on day 4
 * they are absent for everyone and scoring against them ranks nobody.
 */
export function computeCoverage(
  dossiers: Pick<CandidateDossier, "evidence">[],
): EvidenceCoverage {
  const anyMission = dossiers.some((d) => d.evidence.missionsPassed.value > 0);
  const anyCommit = dossiers.some((d) => d.evidence.commitDays.value > 0);
  const anyProject = dossiers.some((d) => d.evidence.projectScores.value.length > 0);
  const anyInterview = dossiers.some((d) => d.evidence.interview.value !== null);
  // Read from clean passes, not from missions.
  //
  // Deriving it from `anyMission` assumed every track records how many attempts
  // a pass took. The challenge track does not — its submissions are logged, not
  // re-run — so the dimension would switch on and score everybody zero on 15%
  // of the rubric for an attempt count nobody ever measured.
  const anyCleanPass = dossiers.some((d) => d.evidence.cleanPassCount.value > 0);

  const dimensions: Record<ScoreDimension, boolean> = {
    stack: true,
    experience: true,
    missions: anyMission,
    cleanPass: anyCleanPass,
    consistency: anyCommit,
    projects: anyProject,
    interview: anyInterview,
  };

  const missing: string[] = [];
  if (!anyProject) missing.push("graded projects");
  if (!anyInterview) missing.push("exit interviews");
  if (!anyMission) missing.push("completed missions");
  if (!anyCommit) missing.push("commit history");
  if (anyMission && !anyCleanPass) missing.push("first-attempt records");

  const used = Object.values(dimensions).filter(Boolean).length;
  const note =
    missing.length === 0
      ? `Ranked on all ${used} evidence dimensions.`
      : `Ranked on ${used} of 7 evidence dimensions — ${listPhrase(missing)} ${
          missing.length === 1 ? "has" : "have"
        } not been recorded for this cohort yet, so ${
          missing.length === 1 ? "it is" : "they are"
        } excluded rather than counted as zero.`;

  return { dimensions, note };
}

function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
