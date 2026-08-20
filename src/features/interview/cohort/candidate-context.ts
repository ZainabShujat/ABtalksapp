import "server-only";
import { prisma } from "@/lib/db";
import {
  collectPassSkipSets,
  getMemberDayStates,
  getMemberProgressDay,
} from "@/features/program/progression";
import {
  BLUEPRINT_SCOPE,
  maxScopeDay,
  type InterviewBlueprintKey,
} from "@/features/interview/cohort/blueprint";

/**
 * What the interviewer actually knows about this candidate.
 *
 * The gap this closes: until now `planCohortInterview(blueprint)` never received
 * a member id, so every interview was identical and the interviewer knew nothing
 * about the person in front of it. Everything here is read from the member's own
 * cohort record — nothing is inferred, and nothing is generated.
 *
 * THE NON-INVENTION RULE, which the rest of the feature depends on: every field
 * below is a fact already stored in the database. Consumers may template these
 * facts into spoken text (`grounding.ts`) but may never ask a model to describe
 * the candidate's work. If an artifact is absent, the reference to it is dropped
 * rather than softened — an interviewer that says "your Day 11 repo" about a
 * repo that does not exist destroys the candidate's trust in every other
 * question it asks.
 *
 * The per-module rollup and the project-title extraction are ported from the
 * legacy exit interview (`features/program/interview.ts:80-125`), which already
 * derived them correctly; see docs/plans/072 §10.
 */

/** A day the member actually submitted work for. */
export type SubmittedDay = {
  dayNumber: number;
  /** Curriculum title, e.g. "RAG End-to-End & LLM API Basics". */
  title: string;
  moduleNumber: number;
  passed: boolean;
  /** Attempts taken. 1 with `passed` is a clean pass. */
  attempts: number;
  /** Repo path/ref the member submitted, when the mission type carries one. */
  repoRef: string | null;
  submittedAt: Date;
};

export type ModuleProgress = {
  moduleNumber: number;
  title: string;
  passed: number;
  total: number;
};

export type SubmittedProject = {
  moduleNumber: number;
  /** First line of the writeup, capped — the member's own name for their build. */
  title: string;
  repoUrl: string;
  score: number | null;
};

export type CohortCandidateContext = {
  memberId: string;
  fullName: string;
  jobRole: string;
  company: string;
  yearsExperience: number;
  cohortName: string;
  githubRepoUrl: string;

  /** Highest consecutive day passed — the member's LIVE progress right now. */
  progressDay: number;
  /** Every day with a passing submission. */
  passedDays: number[];
  /** Module the member is currently working in. */
  currentModule: number;
  moduleProgress: ModuleProgress[];

  submissions: SubmittedDay[];
  projects: SubmittedProject[];

  /** Days this blueprint assesses. Fixed by the blueprint, never by progress. */
  scopeDays: number[];
  /**
   * Days PASSED beyond the blueprint's scope — the "took DAY_15 on day 18" case.
   * Source for extension questions. Empty when the member interviewed on time.
   */
  beyondScopePassedDays: number[];
};

/** `payload` is mission-type specific: {code} | {repoRef} | {answers} | … */
function extractRepoRef(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const ref = (payload as { repoRef?: unknown }).repoRef;
  return typeof ref === "string" && ref.trim().length > 0 ? ref.trim() : null;
}

/** Ported from the legacy interview: the member's own words, first line only. */
function projectTitleFromWriteup(writeup: string, moduleNumber: number): string {
  const firstLine = writeup.split("\n")[0]?.trim();
  return (firstLine && firstLine.length > 0
    ? firstLine
    : `Module ${moduleNumber} project`
  ).slice(0, 120);
}

/**
 * Loads everything the interview knows about one member.
 *
 * Four reads, no N+1. `memberId` is always resolved from the session by the
 * caller — this function never sees client input, and takes the blueprint only
 * to compute which passed days fall beyond its scope.
 */
export async function buildCohortCandidateContext(
  memberId: string,
  blueprint: InterviewBlueprintKey,
): Promise<CohortCandidateContext | null> {
  const [member, submissions, projects, dayStates] = await Promise.all([
    prisma.programMember.findUnique({
      where: { id: memberId },
      select: {
        fullName: true,
        jobRole: true,
        company: true,
        yearsExperience: true,
        githubRepoUrl: true,
        cohort: { select: { name: true } },
      },
    }),
    prisma.programMissionSubmission.findMany({
      where: { memberId },
      select: {
        dayNumber: true,
        passed: true,
        payload: true,
        attemptNumber: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.programProject.findMany({
      where: { memberId },
      select: {
        moduleNumber: true,
        repoUrl: true,
        writeup: true,
        aiScore: true,
        adminScore: true,
      },
      orderBy: { moduleNumber: "asc" },
    }),
    getMemberDayStates(memberId),
  ]);

  if (!member) return null;

  const { passedDays } = collectPassSkipSets(
    submissions.map((s) => ({
      dayNumber: s.dayNumber,
      passed: s.passed,
      payload: s.payload,
    })),
  );
  const progressDay = getMemberProgressDay(passedDays);

  // Per-module rollup, ported from the legacy exit interview.
  const moduleProgress: ModuleProgress[] = dayStates.modules.map((mod) => {
    const modDays = dayStates.days.filter((d) => d.moduleNumber === mod.number);
    return {
      moduleNumber: mod.number,
      title: mod.title,
      passed: modDays.filter((d) => d.state === "PASSED").length,
      total: modDays.length,
    };
  });

  const dayMeta = new Map(
    dayStates.days.map((d) => [
      d.dayNumber,
      { title: d.title, moduleNumber: d.moduleNumber },
    ]),
  );

  // One entry per day: the latest attempt wins, but the attempt COUNT is what
  // says whether it was a clean pass, so it is carried rather than discarded.
  const byDay = new Map<number, SubmittedDay>();
  for (const s of submissions) {
    const meta = dayMeta.get(s.dayNumber);
    const prior = byDay.get(s.dayNumber);
    byDay.set(s.dayNumber, {
      dayNumber: s.dayNumber,
      title: meta?.title ?? `Day ${s.dayNumber}`,
      moduleNumber: meta?.moduleNumber ?? 0,
      passed: s.passed || (prior?.passed ?? false),
      attempts: Math.max(s.attemptNumber, prior?.attempts ?? 0),
      repoRef: extractRepoRef(s.payload) ?? prior?.repoRef ?? null,
      submittedAt: s.createdAt,
    });
  }

  const scopeDays = [...BLUEPRINT_SCOPE[blueprint]];
  const ceiling = maxScopeDay(blueprint);

  return {
    memberId,
    fullName: member.fullName,
    jobRole: member.jobRole,
    company: member.company,
    yearsExperience: member.yearsExperience,
    cohortName: member.cohort.name,
    githubRepoUrl: member.githubRepoUrl,

    progressDay,
    passedDays: [...passedDays].sort((a, b) => a - b),
    currentModule:
      dayStates.days.find((d) => d.dayNumber === Math.max(1, progressDay))
        ?.moduleNumber ?? 1,
    moduleProgress,

    submissions: [...byDay.values()].sort((a, b) => a.dayNumber - b.dayNumber),
    projects: projects.map((p) => ({
      moduleNumber: p.moduleNumber,
      title: projectTitleFromWriteup(p.writeup, p.moduleNumber),
      repoUrl: p.repoUrl,
      score: p.adminScore ?? p.aiScore,
    })),

    scopeDays,
    beyondScopePassedDays: [...passedDays]
      .filter((day) => day > ceiling)
      .sort((a, b) => a - b),
  };
}
