/**
 * Where a fact about a candidate came from — and therefore how much weight a
 * recruiter is entitled to put on it.
 *
 * The three categories are not cosmetic. A shortlist that presents a
 * self-typed skill list and a server-verified mission pass in the same
 * typeface is making a claim ABTalks cannot stand behind. Every field on a
 * dossier carries one of these, the card renders them differently, and the
 * rationale writer may only quote VERIFIED and DERIVED figures as fact.
 *
 * No `import "server-only"` — the match card renders these labels.
 */
export type Provenance =
  /** The platform ran a check and recorded the outcome. Missions, clean
   *  passes, commit days, graded projects, interview scores. */
  | "VERIFIED"
  /** The person typed it about themselves. Skills, job role, education,
   *  years of experience, links. True or not, we did not test it. */
  | "DECLARED"
  /** ABTalks computed it from the two above. Role family, working languages,
   *  evidence tier, the indicative salary band. */
  | "DERIVED";

export type Fact<T> = {
  value: T;
  provenance: Provenance;
  /** ISO string, or null when the source carries no timestamp. Never a Date —
   *  this object is serialised to the client and into LLM payloads. */
  asOf: string | null;
};

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  VERIFIED: "Verified by ABTalks",
  DECLARED: "Self-declared",
  DERIVED: "ABTalks estimate",
};

/** Short badge text for a card, where the full label does not fit. */
export const PROVENANCE_BADGE: Record<Provenance, string> = {
  VERIFIED: "Verified",
  DECLARED: "Declared",
  DERIVED: "Estimated",
};

function toIso(asOf?: Date | string | null): string | null {
  if (!asOf) return null;
  return typeof asOf === "string" ? asOf : asOf.toISOString();
}

export function verified<T>(value: T, asOf?: Date | string | null): Fact<T> {
  return { value, provenance: "VERIFIED", asOf: toIso(asOf) };
}

export function declared<T>(value: T, asOf?: Date | string | null): Fact<T> {
  return { value, provenance: "DECLARED", asOf: toIso(asOf) };
}

export function derived<T>(value: T, asOf?: Date | string | null): Fact<T> {
  return { value, provenance: "DERIVED", asOf: toIso(asOf) };
}
