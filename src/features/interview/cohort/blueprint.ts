/**
 * The two AI Cohort interview blueprints — pure constants, no I/O.
 *
 * This is the single source of truth for what a blueprint *covers*. Both the
 * eligibility gate (`cohort-eligibility.ts`) and the question bank import from
 * here, so a scope can never drift between "what unlocks it" and "what it may
 * ask about".
 *
 * Deliberately free of `server-only` and of any Prisma import: the scope rule is
 * the most safety-critical invariant in the feature and must be unit-testable
 * without a database.
 */

export const INTERVIEW_BLUEPRINTS = ["DAY_15", "DAY_31"] as const;
export type InterviewBlueprintKey = (typeof INTERVIEW_BLUEPRINTS)[number];

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}

/**
 * Cohort day numbers each blueprint covers.
 *
 * DAY_15 stops at 15 because that is where Module 4 (LLM Core, Prompting &
 * Fine-Tuning) ends — a real curriculum boundary, not an arbitrary halfway
 * point. DAY_31 covers the whole programme including the Day 31 capstone, which
 * is what makes it a true exit interview.
 */
export const BLUEPRINT_SCOPE: Record<InterviewBlueprintKey, number[]> = {
  DAY_15: range(15),
  DAY_31: range(31),
};

export const BLUEPRINT_LABEL: Record<InterviewBlueprintKey, string> = {
  DAY_15: "Day 15 Checkpoint Interview",
  DAY_31: "Day 31 Final Interview",
};

/** Highest cohort day a blueprint is allowed to reference. */
export function maxScopeDay(blueprint: InterviewBlueprintKey): number {
  return BLUEPRINT_SCOPE[blueprint].length;
}

export function isInterviewBlueprint(
  value: unknown,
): value is InterviewBlueprintKey {
  return (
    typeof value === "string" &&
    (INTERVIEW_BLUEPRINTS as readonly string[]).includes(value)
  );
}

/**
 * Parses a URL segment into a blueprint. Accepts the lowercase/hyphenated form
 * used in routes (`day-15`) as well as the canonical enum value (`DAY_15`), and
 * returns null for anything else — a route param is client input.
 */
export function parseBlueprintParam(
  value: string,
): InterviewBlueprintKey | null {
  const normalized = value.trim().toUpperCase().replace(/-/g, "_");
  return isInterviewBlueprint(normalized) ? normalized : null;
}

/** The canonical route segment for a blueprint. */
export function blueprintSlug(blueprint: InterviewBlueprintKey): string {
  return blueprint.toLowerCase().replace(/_/g, "-");
}
