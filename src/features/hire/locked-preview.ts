import type { MatchCardData } from "@/components/hire/match-card";
import type { JobSpec } from "@/lib/validations/hire";

/**
 * Illustrative locked profiles for the empty desk.
 *
 * ## What these are, and what they are not
 *
 * They are **fabricated**. Not anonymised real candidates, not a filtered view
 * of the pool, not inventory sitting behind a paywall. Every value below is
 * generated from the recruiter's own spec plus a fixed word list, and the copy
 * on the card says so.
 *
 * That distinction is the whole design. A blurred name over a real person would
 * mean the paywall had become a second route to somebody's identity — and the
 * only route to a candidate's contact details is a `TalentEngagementRequest`
 * reaching `CONTACT_SHARED`, which a candidate's own visibility settings and an
 * admin both have to allow. **Paying cannot widen that, and must never be built
 * so that it could.** A commercial gate may only ever show a subset of what the
 * privacy gate already permits.
 *
 * So what a recruiter sees blurred here is a *format preview*: this is the shape
 * of a full profile, these are the fields Pro fills in. It is honest about the
 * pool being empty because the existing `SampleCardNotice` keeps saying so.
 *
 * ## Why the ref still says SAMPLE:
 *
 * `candidateRef` keeps the `SAMPLE:` prefix, which `resolveEligibleCandidates`
 * already refuses. A preview card therefore cannot be shortlisted, cannot become
 * an engagement request, and cannot reach an admin queue — enforced by the
 * whitelist rather than by this file remembering to be careful.
 *
 * Pure: no DB, no model, no `server-only`. Rendered on the client.
 */

export type LockedField =
  | "name"
  | "location"
  | "education"
  | "contact"
  | "compensation";

/** Every field a preview card blurs. Pro is presentational for now — see §Pro. */
export const LOCKED_FIELDS: readonly LockedField[] = [
  "name",
  "location",
  "education",
  "contact",
  "compensation",
];

export type LockedPreviewCard = MatchCardData & {
  /** Marks the card as a fabricated format preview. Never set on a real match. */
  locked: true;
  /** Plausible values, shown blurred. Fabricated — see the note above. */
  preview: {
    displayName: string;
    locationLabel: string;
    educationLine: string;
    email: string;
    phone: string;
    compensationBand: string;
  };
};

const MAX_PREVIEWS = 3;

/* Deliberately ordinary, unremarkable names. A preview that reads as a real
 * person's profile is the failure mode; these are placeholders that look like
 * placeholders once the blur is lifted. */
const FIRST = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Ananya"];
const LAST = ["Sharma", "Iyer", "Nair", "Rao", "Bose", "Menon"];
const CITY = ["Bengaluru", "Pune", "Hyderabad", "Chennai", "Delhi NCR", "Kochi"];
const DEGREE = ["B.Tech CSE", "B.E. IT", "MCA", "B.Sc CS", "B.Tech ECE"];
const YEAR = [2023, 2024, 2025, 2026];

/**
 * Deterministic from the spec, so the same search shows the same three people
 * every time. Names that reshuffle on re-render read as a broken page, and a
 * recruiter comparing two searches needs the cards to hold still.
 */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pick<T>(list: readonly T[], seed: number, salt: number): T {
  return list[(seed + salt * 7919) % list.length]!;
}

export function buildLockedPreviewCards(
  spec: JobSpec,
  count: number = MAX_PREVIEWS,
): LockedPreviewCard[] {
  const title = spec.title?.trim() ?? "";
  const stack = (spec.mustHaveStack ?? []).map((s) => s.trim()).filter(Boolean);
  if (!title && stack.length === 0) return [];

  const n = Math.min(MAX_PREVIEWS, Math.max(0, Math.floor(count)));
  if (n === 0) return [];

  const jobRole = title || roleFromStack(stack);
  const seed = hash(`${jobRole}|${stack.join(",")}|${spec.minExperience ?? ""}`);
  const years = typeof spec.minExperience === "number" ? spec.minExperience : 2;

  const cards: LockedPreviewCard[] = [];
  for (let i = 0; i < n; i++) {
    const first = pick(FIRST, seed, i + 1);
    const last = pick(LAST, seed, i + 3);
    const grad = pick(YEAR, seed, i + 11);
    // Descending, so the list reads like a ranked result rather than noise.
    const score = 88 - i * 9;

    cards.push({
      // SAMPLE: keeps it off the candidate whitelist. Do not change this prefix.
      candidateRef: `SAMPLE:preview-${seed}-${i}`,
      programMemberId: null,
      jobRole,
      score,
      tier: i === 0 ? "STRONG" : "PARTIAL",
      rationale: null,
      gaps: [],
      availabilityUnknown: false,
      shortlisted: false,
      engagementStatus: null,
      highlightSkills: stack.length ? stack : undefined,
      evidence: {
        skills: rotate(stack, i),
        yearsExperience: Math.max(0, years),
        missionsPassed: 24 - i * 3,
        cleanPassCount: 15 - i * 2,
        commitDayCount: 41 - i * 6,
        githubConnected: true,
        linkedinConnected: true,
      },
      locked: true,
      preview: {
        displayName: `${first} ${last}`,
        locationLabel: pick(CITY, seed, i + 5),
        educationLine: `${pick(DEGREE, seed, i + 7)} · ${grad}`,
        email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
        phone: "+91 ••••• •••••",
        compensationBand: `₹${8 + i * 2}–${14 + i * 3} LPA`,
      },
    });
  }
  return cards;
}

/** Type guard so the card components can narrow without a string check. */
export function isLockedPreview(
  card: MatchCardData,
): card is LockedPreviewCard {
  return (card as LockedPreviewCard).locked === true;
}

/** "python" → "Python developer". Never "Candidate". */
function roleFromStack(stack: string[]): string {
  const first = stack[0] ?? "Software";
  return `${first.charAt(0).toUpperCase() + first.slice(1)} developer`;
}

function rotate<T>(items: T[], by: number): T[] {
  if (items.length === 0) return items;
  const k = ((by % items.length) + items.length) % items.length;
  return k === 0 ? items : [...items.slice(k), ...items.slice(0, k)];
}
