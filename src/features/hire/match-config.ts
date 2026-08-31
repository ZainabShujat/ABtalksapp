/**
 * What counts as "we have this person already".
 *
 * `score-candidate.ts` decides a tier (STRONG / PARTIAL / NONE) from the
 * evidence. That is a statement about one candidate. This file answers a
 * different question, asked once per search: given the people we found, is the
 * pool good enough that showing a requirement-based profile would be noise?
 *
 * The two must not be collapsed. Tier thresholds are scoring rules and belong
 * with the scorer; this is a product decision about when the desk falls back to
 * demand, and it moves without touching how anybody is ranked.
 *
 * Pure: no DB, no `server-only`. Read on both sides of the boundary so the card
 * and the search agree on what "sufficient" meant.
 */

/** Score at or above which a real candidate satisfies the requirement alone. */
export const DEFAULT_MATCH_THRESHOLD = 70;

/** How many candidates at or above the threshold count as a real result. */
export const DEFAULT_MIN_STRONG_MATCHES = 1;

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export type MatchConfig = {
  /** A candidate scoring this or better answers the requirement on their own. */
  threshold: number;
  /** How many such candidates are needed before we stop offering to source. */
  minMatches: number;
};

export function matchConfig(): MatchConfig {
  return {
    threshold: intFromEnv("HIRE_MATCH_THRESHOLD", DEFAULT_MATCH_THRESHOLD, 1, 100),
    minMatches: intFromEnv("HIRE_MIN_MATCHES", DEFAULT_MIN_STRONG_MATCHES, 1, 50),
  };
}

export type ScoredLike = { score: number; tier?: string };

/**
 * Whether the real pool answered the requirement.
 *
 * Deliberately counts score rather than tier. `tierFor` caps a candidate at
 * PARTIAL when they have no passed missions, which is right for ranking — a
 * claim about proven work needs proven work — but it would mean a pool of
 * genuinely close people never clears the bar and every search ends in a demand
 * card. The tier still decides what the recruiter is told about each person.
 */
export function hasSufficientRealMatches(
  results: readonly ScoredLike[],
  config: MatchConfig = matchConfig(),
): boolean {
  let n = 0;
  for (const r of results) {
    if (r.score >= config.threshold) n += 1;
    if (n >= config.minMatches) return true;
  }
  return false;
}
