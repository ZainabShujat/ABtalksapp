import "server-only";

import { Domain, TalentCandidateSource } from "@prisma/client";

import { logger } from "@/lib/logger";
import { hireChallengePool } from "@/lib/feature-flags";
import { buildDossierSet, computeCoverage } from "@/features/hire/dossier";
import {
  CHALLENGE_TOTAL_DAYS,
  buildChallengeDossierSet,
} from "@/features/hire/challenge-dossier";
import { buildHackathonDossierSet } from "@/features/hire/hackathon-dossier";
import {
  clearsEvidenceFloor,
  memberEligibilityWhere,
  resolvePoolCohorts,
} from "@/features/hire/pool-policy";
import type { EvidenceCoverage, ScoreableMember } from "@/features/hire/types";
import { findTrack } from "@/features/hire/track-registry";

/**
 * One loader per track, behind one signature.
 *
 * `searchCandidates` used to branch on four hardcoded booleans —
 * `wantProgram / wantClaude / wantSixty / wantHackathon` — each with its own
 * builder, its own return type and its own normalisation. A fifth track could be
 * named by the agent and then matched nothing, because nothing here knew how to
 * load it. This is the seam that makes a new descriptor actually return cards.
 *
 * The three builders genuinely differ — different tables, different arguments,
 * different shapes — so unifying them means an adapter each. That work is here
 * rather than in the search, and the merge that follows it is pure and tested.
 */

/**
 * The one place the world is still closed, and it is the database.
 *
 * `TalentRequestMatch.source` and `TalentEngagementRequest.source` are a Prisma
 * enum with exactly four values, so a track added to the registry can be
 * described, filtered, searched and ranked — but its matches cannot be WRITTEN
 * until that enum gains a value, which is a migration.
 *
 * This narrows explicitly and returns null rather than casting, so the limit
 * surfaces as a logged, handled case at the two write sites instead of a runtime
 * Prisma error a recruiter would meet as a failed intro request. Completing the
 * future-proofing means widening the enum; that is plan 081's job, and it needs
 * a schema change nobody should make silently.
 */
export function persistableSource(slug: string): TalentCandidateSource | null {
  const hit = (
    Object.values(TalentCandidateSource) as string[]
  ).includes(slug);
  return hit ? (slug as TalentCandidateSource) : null;
}

export const EMPTY_COVERAGE: EvidenceCoverage = {
  dimensions: {
    stack: false,
    missions: false,
    cleanPass: false,
    projects: false,
    consistency: false,
    interview: false,
    experience: false,
  },
  note: "No candidates in the pool yet.",
};

export type TrackLoad = {
  slug: string;
  members: ScoreableMember[];
  coverage: EvidenceCoverage;
  /** Consenting people held back by the evidence floor — the honest denominator. */
  belowEvidenceFloor: number;
  cohortName: string | null;
  stage: "PUBLISHED" | "OPEN_MIDCOHORT" | null;
};

export type TrackLoadOpts = {
  /** Registry-wide floor: the feature flag's minimum, raised by any stated one. */
  minEvidenceDays: number;
  /** Ceiling on rows pulled before ranking. */
  limit: number;
};

const emptyLoad = (slug: string): TrackLoad => ({
  slug,
  members: [],
  coverage: EMPTY_COVERAGE,
  belowEvidenceFloor: 0,
  cohortName: null,
  stage: null,
});

/* ── PROGRAM: the AI Cohort ───────────────────────────────────────────────── */

async function loadProgram(): Promise<TrackLoad> {
  const gate = await resolvePoolCohorts();
  if (!gate.ok) return emptyLoad("PROGRAM");

  const set = await buildDossierSet(
    memberEligibilityWhere(gate.cohorts.map((c) => c.id)),
  );
  const dossiers = set?.dossiers ?? [];

  // The floor is a preference, not a wall. As a hard exclusion it emptied the
  // board: two weeks into a cohort the members who opted in are mostly the ones
  // who have not finished three missions yet. Below-floor people rank below the
  // rest and say why on the card.
  const aboveFloor = dossiers.filter((d) =>
    clearsEvidenceFloor(d.evidence.missionsPassed.value),
  );
  const belowEvidenceFloor = dossiers.length - aboveFloor.length;

  // Coverage is read from the members who cleared the floor when there are any:
  // someone who has not started cannot tell us whether this cohort produces
  // project scores.
  const coverage =
    dossiers.length > 0
      ? computeCoverage(aboveFloor.length > 0 ? aboveFloor : dossiers)
      : EMPTY_COVERAGE;

  return {
    slug: "PROGRAM",
    coverage,
    belowEvidenceFloor,
    cohortName: gate.cohorts[0]?.name ?? null,
    stage: gate.cohorts[0]?.stage ?? null,
    members: dossiers.map((d): ScoreableMember => {
      const id = d.programMemberId!;
      const identity = set?.identityByMember.get(id);
      const legacy = set?.legacyStatsByMember.get(id);
      return {
        id,
        source: "PROGRAM",
        candidateRef: d.candidateRef,
        userId: d.userId ?? "",
        fullName: identity?.fullName ?? "",
        jobRole: identity?.jobRole ?? "",
        company: identity?.company ?? "",
        yearsExperience: d.yearsExperience.value,
        skills: d.declaredSkills.value,
        missionPoints: legacy?.missionPoints ?? 0,
        missionsPassed: d.evidence.missionsPassed.value,
        missionsAttempted: d.evidence.missionsAttempted.value,
        cleanPassCount: d.evidence.cleanPassCount.value,
        totalScore: legacy?.totalScore ?? 0,
        commitDayCount: d.evidence.commitDays.value,
        projectScores: d.evidence.projectScores.value,
        interview: d.evidence.interview.value,
        // The policy query already enforced both; re-stating them keeps the pure
        // scorer's own hard filters meaningful when it is called directly.
        hasVisibilityConsent: true,
        cohortPublished: true,
        status: legacy?.status ?? "ENROLLED",
        availability: d.availability,
        cohortDay: set?.cohortDayByMember.get(id) ?? 1,
        coverage,
        dossier: d,
      };
    }),
  };
}

/* ── CLAUDE / CHALLENGE_60: the daily-submission tracks ───────────────────── */

const CHALLENGE_DOMAINS: Record<string, Domain[]> = {
  CLAUDE: [Domain.CLAUDE],
  CHALLENGE_60: [Domain.SE, Domain.DS, Domain.AI],
};

async function loadChallenge(
  slug: string,
  opts: TrackLoadOpts,
): Promise<TrackLoad> {
  const flag = hireChallengePool();
  const domains = CHALLENGE_DOMAINS[slug];
  if (!flag.enabled || !domains) return emptyLoad(slug);

  const set = await buildChallengeDossierSet({
    minDays: Math.max(flag.minDays, opts.minEvidenceDays),
    domains,
    limit: opts.limit,
  });
  const dossiers = set?.dossiers ?? [];
  const coverage = set?.coverage ?? EMPTY_COVERAGE;

  return {
    slug,
    coverage,
    // Their floor is applied in the query that loads them, so everyone who
    // arrives has already cleared it and none is being held back.
    belowEvidenceFloor: 0,
    cohortName: dossiers.length > 0 ? "60-Day Challenge" : null,
    // A rolling track has no single publish state — people are on day 12 and day
    // 60 at the same time — so it reports none rather than borrowing one.
    stage: null,
    members: dossiers.map((d): ScoreableMember => ({
      id: d.userId ?? "",
      source: d.source,
      candidateRef: d.candidateRef,
      userId: d.userId ?? "",
      fullName: (d.userId && set?.nameByUser.get(d.userId)) || "",
      jobRole: d.rawRoleLabel.value,
      company: "",
      yearsExperience: d.yearsExperience.value,
      skills: d.declaredSkills.value,
      missionPoints: 0,
      missionsPassed: d.evidence.missionsPassed.value,
      missionsAttempted: d.evidence.missionsAttempted.value,
      cleanPassCount: d.evidence.cleanPassCount.value,
      totalScore: 0,
      commitDayCount: d.evidence.commitDays.value,
      projectScores: d.evidence.projectScores.value,
      interview: d.evidence.interview.value,
      // Neither gate applies here. Consent to be *contacted* is asked at the
      // introduction, and there is no cohort to publish — the work is done and
      // recorded either way.
      hasVisibilityConsent: true,
      cohortPublished: true,
      status: "ENROLLED",
      availability: d.availability,
      cohortDay: set?.dayByUser.get(d.userId ?? "") ?? CHALLENGE_TOTAL_DAYS,
      maxEarnableMissions: CHALLENGE_TOTAL_DAYS,
      consistencyWindow: CHALLENGE_TOTAL_DAYS,
      coverage,
      dossier: d,
    })),
  };
}

/* ── HACKATHON: one weekend ───────────────────────────────────────────────── */

async function loadHackathon(): Promise<TrackLoad> {
  const set = await buildHackathonDossierSet();
  const dossiers = set?.dossiers ?? [];
  const coverage = set?.coverage ?? EMPTY_COVERAGE;

  return {
    slug: "HACKATHON",
    coverage,
    belowEvidenceFloor: 0,
    cohortName: null,
    stage: null,
    members: dossiers.map((d): ScoreableMember => ({
      id: d.userId ?? "",
      source: "HACKATHON",
      candidateRef: d.candidateRef,
      userId: d.userId ?? "",
      fullName: (d.userId && set?.nameByUser.get(d.userId)) || "",
      jobRole: d.rawRoleLabel.value,
      company: "",
      yearsExperience: d.yearsExperience.value,
      skills: d.declaredSkills.value,
      missionPoints: 0,
      missionsPassed: d.evidence.missionsPassed.value,
      missionsAttempted: d.evidence.missionsAttempted.value,
      cleanPassCount: 0,
      totalScore: 0,
      commitDayCount: d.evidence.commitDays.value,
      projectScores: [],
      interview: null,
      hasVisibilityConsent: true,
      cohortPublished: true,
      status: "ENROLLED",
      availability: d.availability,
      // One weekend: there is no day scale to judge against, so expectations are
      // pinned to a single day rather than a cohort calendar.
      cohortDay: 1,
      maxEarnableMissions: 1,
      consistencyWindow: 1,
      coverage,
      dossier: d,
    })),
  };
}

/**
 * Load one track by slug.
 *
 * A slug with no loader returns empty rather than throwing: the registry can
 * legitimately describe a track before its rows are wired up, and the agent
 * naming it should produce "nobody yet", not a 500.
 */
export async function loadTrack(
  slug: string,
  opts: TrackLoadOpts,
): Promise<TrackLoad> {
  const track = findTrack(slug);
  if (!track || !(track.enabled?.() ?? true)) return emptyLoad(slug);

  try {
    switch (track.slug) {
      case "PROGRAM":
        return await loadProgram();
      case "CLAUDE":
      case "CHALLENGE_60":
        return await loadChallenge(track.slug, opts);
      case "HACKATHON":
        return await loadHackathon();
      default:
        return emptyLoad(track.slug);
    }
  } catch (error) {
    logger.error("[hire] loadTrack failed", {
      slug,
      error: String(error).slice(0, 240),
    });
    return emptyLoad(slug);
  }
}

/**
 * Fold several tracks into one scoreable pool.
 *
 * PURE, and deliberately so: the dedupe and the coverage choice are the subtle
 * parts of this whole path and they are the parts a database cannot help me
 * test. Given synthetic members, everything below is assertable offline.
 *
 * One person, one card. Somebody who did the challenge and then joined the
 * cohort has evidence in both tables, and the richer record wins —
 * `dedupePriority` on the descriptor is that rule, previously a `programUserIds`
 * set spelled out inline.
 */
export function mergeTrackLoads(loads: TrackLoad[]): {
  members: ScoreableMember[];
  coverage: EvidenceCoverage;
  belowEvidenceFloor: number;
  cohortName: string | null;
  stage: "PUBLISHED" | "OPEN_MIDCOHORT" | null;
} {
  const ordered = [...loads].sort(
    (a, b) =>
      (findTrack(b.slug)?.dedupePriority ?? 0) -
      (findTrack(a.slug)?.dedupePriority ?? 0),
  );

  const members: ScoreableMember[] = [];
  const seenUsers = new Set<string>();
  for (const load of ordered) {
    for (const m of load.members) {
      // An empty userId is not an identity, so it can never collide with one.
      if (m.userId && seenUsers.has(m.userId)) continue;
      if (m.userId) seenUsers.add(m.userId);
      members.push(m);
    }
  }

  // Coverage describes what evidence the shown pool actually has, so it comes
  // from the highest-priority track that contributed anybody.
  const contributing = ordered.find((l) => l.members.length > 0);

  return {
    members,
    coverage: contributing?.coverage ?? EMPTY_COVERAGE,
    belowEvidenceFloor: loads.reduce((n, l) => n + l.belowEvidenceFloor, 0),
    cohortName: ordered.find((l) => l.cohortName)?.cohortName ?? null,
    stage: ordered.find((l) => l.stage)?.stage ?? null,
  };
}
