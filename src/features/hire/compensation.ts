import type { RoleFamily } from "@/features/hire/role-family";
import type { MatchTier } from "@/features/hire/types";

/**
 * What ABTalks thinks the role pays — never what the candidate asked for.
 *
 * No member of the platform has ever filled in a salary expectation
 * (`CandidateAvailability` is empty), so a shortlist that shows a number
 * without saying whose number it is invents a negotiating position for someone
 * who never gave one. This produces a band from the role family and the
 * verified evidence, labels it as ours, and never filters anybody out with it.
 * The moment a candidate states an expectation, that replaces this entirely —
 * the two are never blended.
 *
 * Pure and shared: the card renders it, so no `server-only`.
 */
export type CompensationBand = {
  min: number;
  max: number;
  currency: "INR";
  confidence: "LOW" | "MEDIUM";
};

/** The one sentence this band may ever be shown under. */
export const COMPENSATION_DISCLAIMER =
  "ABTalks indicative band, from role and verified evidence — not the candidate's ask.";

type ExperienceBand = "0-1" | "2-3" | "4-6" | "7+";

function experienceBandFor(years: number): ExperienceBand {
  if (years <= 1) return "0-1";
  if (years <= 3) return "2-3";
  if (years <= 6) return "4-6";
  return "7+";
}

/**
 * Annual INR, whole rupees. Indian market, entry-to-mid, 2026.
 *
 * Deliberately wide — a narrow band implies a precision this data does not
 * have. Tune here and nowhere else.
 */
const BASE_BANDS: Record<RoleFamily, Record<ExperienceBand, [number, number]>> = {
  AI_ML: {
    "0-1": [600_000, 1_200_000],
    "2-3": [1_200_000, 2_200_000],
    "4-6": [2_200_000, 3_800_000],
    "7+": [3_500_000, 6_000_000],
  },
  DATA: {
    "0-1": [500_000, 1_000_000],
    "2-3": [1_000_000, 1_900_000],
    "4-6": [1_900_000, 3_200_000],
    "7+": [3_000_000, 5_000_000],
  },
  BACKEND: {
    "0-1": [500_000, 1_000_000],
    "2-3": [1_000_000, 1_800_000],
    "4-6": [1_800_000, 3_000_000],
    "7+": [2_800_000, 4_800_000],
  },
  FULLSTACK: {
    "0-1": [450_000, 950_000],
    "2-3": [950_000, 1_700_000],
    "4-6": [1_700_000, 2_800_000],
    "7+": [2_600_000, 4_500_000],
  },
  FRONTEND: {
    "0-1": [400_000, 850_000],
    "2-3": [850_000, 1_500_000],
    "4-6": [1_500_000, 2_500_000],
    "7+": [2_400_000, 4_000_000],
  },
  ANALYST: {
    "0-1": [400_000, 800_000],
    "2-3": [800_000, 1_400_000],
    "4-6": [1_400_000, 2_400_000],
    "7+": [2_200_000, 3_800_000],
  },
  MANAGER: {
    "0-1": [600_000, 1_200_000],
    "2-3": [1_200_000, 2_000_000],
    "4-6": [2_000_000, 3_500_000],
    "7+": [3_500_000, 7_000_000],
  },
  STUDENT: {
    "0-1": [300_000, 700_000],
    "2-3": [600_000, 1_100_000],
    "4-6": [1_100_000, 1_800_000],
    "7+": [1_800_000, 3_000_000],
  },
  // No band. A role we could not classify plus a guessed number is two
  // guesses stacked, and the recruiter cannot see that from the output.
  OTHER: {
    "0-1": [0, 0],
    "2-3": [0, 0],
    "4-6": [0, 0],
    "7+": [0, 0],
  },
};

/** Verified evidence moves the band, but only within the role's own range. */
const TIER_MULTIPLIER: Record<MatchTier, number> = {
  STRONG: 1.1,
  PARTIAL: 1.0,
  NONE: 0.9,
};

export function estimateCompensation(input: {
  roleFamily: RoleFamily;
  yearsExperience: number;
  evidenceTier: MatchTier;
  /** Earned mission passes — the confidence gate. */
  missionsPassed: number;
}): CompensationBand | null {
  if (input.roleFamily === "OTHER") return null;

  const band = BASE_BANDS[input.roleFamily][experienceBandFor(input.yearsExperience)];
  const [lo, hi] = band;
  if (lo <= 0 || hi <= 0) return null;

  const mult = TIER_MULTIPLIER[input.evidenceTier];
  const round = (n: number) => Math.round(n / 10_000) * 10_000;

  return {
    min: round(lo * mult),
    max: round(hi * mult),
    currency: "INR",
    // MEDIUM only when the role is classified *and* there is enough verified
    // work behind the tier for it to mean anything.
    confidence: input.missionsPassed >= 8 ? "MEDIUM" : "LOW",
  };
}

/** "₹6.0–12.0 LPA" — the form recruiters in this market actually read. */
export function formatBandLpa(band: CompensationBand): string {
  const lpa = (n: number) => (n / 100_000).toFixed(1).replace(/\.0$/, "");
  return `₹${lpa(band.min)}–${lpa(band.max)} LPA`;
}

/** Monthly, for internships — the same band read the way a stipend is quoted. */
export function formatBandMonthly(band: CompensationBand): string {
  const k = (n: number) => Math.round(n / 12 / 1_000);
  return `₹${k(band.min)}k–${k(band.max)}k / month`;
}
