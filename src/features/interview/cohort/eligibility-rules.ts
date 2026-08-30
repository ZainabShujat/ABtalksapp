import {
  BLUEPRINT_SCOPE,
  type InterviewBlueprintKey,
} from "@/features/interview/cohort/blueprint";

/**
 * The unlock rule, as pure functions over a set of passed cohort days.
 *
 * Separated from `cohort-eligibility.ts` — which is `server-only` because it
 * reads Prisma — so the most safety-critical logic in the feature can be tested
 * without a database. `cohort-eligibility.ts` re-exports these, so there is
 * still one public entry point.
 *
 * The rule is deliberately the strictest available reading of "completed":
 * EVERY day in the blueprint's scope must have a PASSED mission submission.
 *
 * Explicitly NOT valid substitutes, each for a concrete reason:
 *   - `cleanPassCount` or any aggregate count — fifteen passed days is not the
 *     same claim as "days 1..15 were passed"
 *   - `progressDay` (highest passed day) — an admin lock bypass can leave a
 *     passed day 20 with nothing before it
 *   - `highestUnlockedDay` / `getMaxContentDay` — availability, not completion
 *   - `cohort.endsAt` — elapsed time is not completed work
 *
 * A skipped day needs no special handling: it is `passed: false`, so it is
 * simply absent from the set and blocks the unlock.
 */

/** True only when EVERY day in scope has `passed === true`. */
export function isBlueprintUnlocked(
  blueprint: InterviewBlueprintKey,
  passedDays: Set<number>,
): boolean {
  return BLUEPRINT_SCOPE[blueprint].every((day) => passedDays.has(day));
}

/** Days still outstanding for a blueprint — drives "3 days to go" copy. */
export function missingDaysFor(
  blueprint: InterviewBlueprintKey,
  passedDays: Set<number>,
): number[] {
  return BLUEPRINT_SCOPE[blueprint].filter((day) => !passedDays.has(day));
}

/** How many scope days the member has actually passed. */
export function passedScopeCount(
  blueprint: InterviewBlueprintKey,
  passedDays: Set<number>,
): number {
  return BLUEPRINT_SCOPE[blueprint].filter((day) => passedDays.has(day)).length;
}
