import "server-only";

import { logger } from "@/lib/logger";
import type { JobSpec } from "@/lib/validations/hire";
import { pickSearchMatches, rankCandidates } from "@/features/hire/score-candidate";
import { readPoolExtra } from "@/features/hire/pool-brief";
import { estimateCompensation } from "@/features/hire/compensation";
import { enabledTracks, isKnownTrack } from "@/features/hire/track-registry";
import {
  EMPTY_COVERAGE,
  loadTrack,
  mergeTrackLoads,
} from "@/features/hire/track-loaders";
import type {
  EvidenceCoverage,
  ScoreableMember,
  ScoredCandidate,
} from "@/features/hire/types";

export type SearchCandidatesResult =
  | {
      ok: true;
      data: {
        cohortName: string | null;
        /** Whether the pool is a finished cohort or one still running. */
        stage: "PUBLISHED" | "OPEN_MIDCOHORT" | null;
        matches: ScoredCandidate[];
        /** Near-miss / hard-filtered, for gap analysis only (not shortlist). */
        nearMisses: ScoredCandidate[];
        totalEligible: number;
        /** Consenting members held back by the evidence floor — the honest
         *  denominator behind a thin shortlist. */
        belowEvidenceFloor: number;
        coverage: EvidenceCoverage;
      };
    }
  | { ok: false; message: string };

/**
 * Below this, a shortlist is padded out with the next best people rather than
 * left short. Five is enough to read a pool from; a strict list of one tells
 * the recruiter nothing about who else is here.
 */
const MIN_RESULTS = 5;

/**
 * How many challenge candidates are loaded before ranking.
 *
 * Scoring is a pure function over an in-memory array, so the cost of the pool
 * is the dossier assembly. Six hundred is comfortably above the whole eligible
 * cohort today (320 at a ten-day floor) and low enough that a future track with
 * thousands of enrolments cannot turn one Server Action into a full table scan.
 * Rows are ordered by days submitted before the cap, so the ceiling can only
 * ever trim the least-evidenced people.
 */
const CHALLENGE_POOL_CAP = 600;


/**
 * Phase B: deterministic Prisma load + pure scoring.
 * Never invents candidates. Empty pool → empty arrays (caller's gap UI).
 */
export async function searchCandidates(
  spec: JobSpec,
  opts?: { limit?: number },
): Promise<SearchCandidatesResult> {
  try {
    const extra = readPoolExtra(spec);

    // Which tracks to search, from the registry rather than a fixed set of
    // booleans. An unscoped search means "everything that is open" — previously
    // that was PROGRAM plus CLAUDE by hand, and CHALLENGE_60 and HACKATHON were
    // unreachable unless named, which is not what "no filter" should mean.
    const wanted =
      extra.sources.length > 0
        ? extra.sources.filter((s) => isKnownTrack(s))
        : enabledTracks().map((t) => t.slug);

    const loads = await Promise.all(
      wanted.map((slug) =>
        loadTrack(slug, {
          minEvidenceDays: extra.minEvidenceDays ?? 0,
          limit: CHALLENGE_POOL_CAP,
        }),
      ),
    );

    const merged = mergeTrackLoads(loads);
    const scoreable: ScoreableMember[] = merged.members;
    const { coverage, belowEvidenceFloor } = merged;

    if (scoreable.length === 0) {
      return {
        ok: true,
        data: {
          cohortName: merged.cohortName,
          stage: merged.stage,
          matches: [],
          nearMisses: [],
          totalEligible: 0,
          belowEvidenceFloor,
          coverage: EMPTY_COVERAGE,
        },
      };
    }

    const hardCap = extra.resultLimit;
    const limit = hardCap ?? opts?.limit ?? 25;
    const ranked = rankCandidates(scoreable, spec, {
      includeHardFiltered: true,
      limit: 100,
      coverage,
    });

    // The band needs the tier, and the tier needs the score — so the estimate
    // is attached after ranking rather than during dossier assembly.
    for (const r of ranked) {
      const d = r.dossier;
      if (!d) continue;
      d.compensation.estimate = estimateCompensation({
        roleFamily: d.roleFamily.value,
        yearsExperience: d.yearsExperience.value,
        evidenceTier: r.tier,
        missionsPassed: d.evidence.missionsPassed.value,
      });
    }

    // A recruiter with nobody on screen cannot judge the pool, the role or us.
    // So the shortlist is the ranked STRONG/PARTIAL list, and when that comes
    // back thin it is topped up with the next best people the pool has — still
    // carrying their real tier and their real gaps, never dressed up.
    const matches = pickSearchMatches(ranked, spec, {
      hardCap,
      limit,
      minResults: MIN_RESULTS,
    });

    const shownIds = new Set(matches.map((m) => m.programMemberId));
    const nearMisses = ranked
      .filter(
        (r) =>
          !shownIds.has(r.programMemberId) &&
          (r.hardFiltered ||
            r.tier === "NONE" ||
            (r.tier === "PARTIAL" && r.gaps.length > 0)),
      )
      .slice(0, 10);

    return {
      ok: true,
      data: {
        cohortName: merged.cohortName,
        stage: merged.stage,
        matches,
        nearMisses,
        totalEligible: scoreable.length,
        belowEvidenceFloor,
        coverage,
      },
    };
  } catch (error) {
    logger.error("[hire] searchCandidates failed", { error: String(error) });
    return {
      ok: false,
      message:
        "Could not search the talent pool. If tables are missing, apply the hire migration on a Neon branch first.",
    };
  }
}
