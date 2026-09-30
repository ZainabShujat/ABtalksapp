import "server-only";

import { Domain } from "@prisma/client";
import { logger } from "@/lib/logger";
import { hireChallengePool } from "@/lib/feature-flags";
import { CHALLENGE_POOL_CAP } from "@/features/hire/search-candidates";
import { memberEligibilityWhere, resolvePoolCohorts } from "@/features/hire/pool-policy";
import { buildDossierSet } from "@/features/hire/dossier";
import { buildChallengeDossierSet } from "@/features/hire/challenge-dossier";
import { buildHackathonDossierSet } from "@/features/hire/hackathon-dossier";
import { buildProfileDossierSet } from "@/features/hire/profile-dossier";
import { CHALLENGE_TOTAL_DAYS } from "@/features/hire/challenge-dossier";
import type { CandidateDossier, CandidateSource } from "@/features/hire/types";

/**
 * One candidate's OWN evidence counts, for the candidate's own recruiter-view
 * preview (`/profile/recruiter-view`, plan 155).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS REUSES THE POOL BUILDERS INSTEAD OF QUERYING DIRECTLY
 *
 * The preview's whole claim is that a candidate is seeing what a recruiter sees.
 * A second, hand-rolled count of "missions passed" would be a second definition
 * of it, and the day the two disagree the page is lying. So this calls the same
 * `build*DossierSet` functions the recruiter search calls and picks the one row
 * that belongs to this user — the same trick `features/admin/
 * inspect-talent-project.ts` uses to guarantee an admin sees byte-for-byte what
 * the recruiter sees.
 *
 * WHAT THIS DELIBERATELY DOES NOT RETURN
 *
 * No `coverage`, and no `ScoreableMember`. Coverage is a property of a POOL —
 * "could anybody here have a graded project yet?" — and `dossier.ts` says in as
 * many words that a dossier built alone "would have to guess" it. Narrowed to
 * one person it is meaningless, so it is not returned and nothing here may be
 * fed back into ranking or written to a `TalentMatch` row.
 *
 * COST, STATED RATHER THAN HIDDEN
 *
 * Each builder assembles its pool, so a cold load of this page costs roughly one
 * `searchCandidates` pool assembly. That is acceptable: it is a page a candidate
 * visits, not a hot path, and the recruiter search already pays it on every
 * query. The cheap optimisation — an optional `userIds` narrowing threaded into
 * the three builders' where clauses — is deliberately NOT done here, because it
 * would change signatures on the live search path for the sake of a profile
 * feature.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type OwnTrackEvidence = {
  source: CandidateSource;
  candidateRef: string;
  /** Missions passed by doing them — excludes days waived at enrolment. */
  missionsPassed: number;
  missionsAttempted: number;
  cleanPassCount: number;
  commitDays: number;
  projectScores: number[];
  interview: {
    overall: number | null;
    comm: number | null;
    tech: number | null;
    problem: number | null;
  } | null;
  /** How far into the track this candidate is — what every count is judged against. */
  cohortDay: number;
  /** Ceiling on missions there has been time to earn. */
  maxEarnable: number;
  /** Window the consistency dimension measures commit days against. */
  consistencyWindow: number;
  certificateIssued: boolean;
  quizAverage: number | null;
  totalTrackDays: number | null;
  /** Declared facts the recruiter card also carries, read off the same dossier. */
  declaredSkills: string[];
  yearsExperience: number;
  educationLevel: string | null;
  workingLanguages: string[];
  hasLinkedin: boolean;
  hasGithub: boolean;
  openToWork: boolean;
  /** `availability.preferredWorkMode`, raw. The label is applied at render. */
  workMode: string | null;
  /**
   * The cities the CARD shows, which are the candidate's stated preferred
   * cities — not their profile city. `to-public-match.ts:197` builds
   * `locationLabel` from `availability.preferredCities`, so a candidate who
   * never stated a preference has no location on their card however complete
   * their profile is. Surfacing that is half the point of the preview.
   */
  preferredCities: string[];
  /** No `availability` row at all: the card reads "availability unconfirmed". */
  availabilityUnknown: boolean;
};

/** The cohort's mission ceiling, as `score-candidate.ts` applies it by default. */
const PROGRAM_MAX_EARNABLE = 31;

function pick(
  dossiers: CandidateDossier[],
  userId: string,
): CandidateDossier | null {
  return dossiers.find((d) => d.userId === userId) ?? null;
}

function shape(
  d: CandidateDossier,
  opts: { cohortDay: number; maxEarnable: number; consistencyWindow: number },
): OwnTrackEvidence {
  const e = d.evidence;
  return {
    source: d.source,
    candidateRef: d.candidateRef,
    missionsPassed: e.missionsPassed.value,
    missionsAttempted: e.missionsAttempted.value,
    cleanPassCount: e.cleanPassCount.value,
    commitDays: e.commitDays.value,
    projectScores: e.projectScores.value,
    interview: e.interview.value,
    cohortDay: opts.cohortDay,
    maxEarnable: opts.maxEarnable,
    consistencyWindow: opts.consistencyWindow,
    certificateIssued: e.certificateIssued?.value ?? false,
    quizAverage: e.quizAverage?.value ?? null,
    totalTrackDays: e.cohortProgress.value.ofDays || null,
    declaredSkills: d.declaredSkills.value,
    yearsExperience: d.yearsExperience.value,
    educationLevel: d.education.value.level,
    workingLanguages: e.workingLanguages.value,
    hasLinkedin: d.links.value.linkedin,
    hasGithub: d.links.value.github,
    openToWork: d.availability?.openToWork === true,
    workMode: d.availability?.preferredWorkMode ?? null,
    preferredCities: d.availability?.preferredCities ?? [],
    availabilityUnknown: d.availability == null,
  };
}

/**
 * The candidate's own evidence, from whichever track would carry their card.
 *
 * Tried in the registry's `dedupePriority` order — PROGRAM first, then the
 * challenge tracks, then the hackathon, then profile-only — which is the same
 * "one person, one card" rule `mergeTrackLoads` applies. Null only when the
 * candidate is in no pool at all.
 */
export async function loadOwnTrackEvidence(
  userId: string,
): Promise<OwnTrackEvidence | null> {
  if (!userId) return null;

  try {
    /* ── PROGRAM (dedupePriority highest): the AI cohort ─────────────────── */
    const gate = await resolvePoolCohorts();
    if (gate.ok) {
      const set = await buildDossierSet(
        memberEligibilityWhere(gate.cohorts.map((c) => c.id)),
      );
      const found = pick(set.dossiers, userId);
      if (found) {
        return shape(found, {
          cohortDay: found.programMemberId
            ? (set.cohortDayByMember.get(found.programMemberId) ?? 1)
            : 1,
          maxEarnable: PROGRAM_MAX_EARNABLE,
          // `scoreCandidate` reads `member.consistencyWindow`, which the program
          // loader leaves at 0 so `consistencyScore`'s own default (30) applies.
          consistencyWindow: 30,
        });
      }
    }

    /* ── CLAUDE / CHALLENGE_60: the daily-submission tracks ──────────────── */
    const flag = hireChallengePool();
    if (flag.enabled) {
      for (const domains of [
        [Domain.CLAUDE],
        [Domain.SE, Domain.DS, Domain.AI],
      ]) {
        const set = await buildChallengeDossierSet({
          minDays: flag.minDays,
          domains,
          limit: CHALLENGE_POOL_CAP,
        });
        const found = pick(set.dossiers, userId);
        if (found) {
          return shape(found, {
            cohortDay: set.dayByUser.get(userId) ?? CHALLENGE_TOTAL_DAYS,
            maxEarnable: CHALLENGE_TOTAL_DAYS,
            consistencyWindow: CHALLENGE_TOTAL_DAYS,
          });
        }
      }
    }

    /* ── HACKATHON: one weekend ─────────────────────────────────────────── */
    const hack = await buildHackathonDossierSet();
    const hackFound = pick(hack.dossiers, userId);
    if (hackFound) {
      return shape(hackFound, {
        cohortDay: 1,
        maxEarnable: 3,
        consistencyWindow: 5,
      });
    }

    /* ── PROFILE: searchable on profile state alone, zero activity ───────── */
    const profile = await buildProfileDossierSet({ limit: CHALLENGE_POOL_CAP });
    const profileFound = pick(profile.dossiers, userId);
    if (profileFound) {
      return shape(profileFound, {
        cohortDay: 1,
        maxEarnable: 3,
        consistencyWindow: 5,
      });
    }

    return null;
  } catch (error) {
    // A preview that cannot read its own numbers renders the profile-only state
    // rather than a 500 — the page is a mirror, not a gate.
    logger.error("[profile] loadOwnTrackEvidence failed", {
      error: String(error).slice(0, 240),
    });
    return null;
  }
}
