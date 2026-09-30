/**
 * How much of a candidate's name a recruiter sees, for the candidate's own
 * preview (plan 155).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT JUST `splitName`
 *
 * The rule itself belongs to `splitName` in `components/hire/desk-match-card.tsx`
 * and that file is the source of truth for it. This does not reimplement the rule
 * casually — `recruiter-view-checks.test.ts` asserts the two agree on every input
 * it checks, so a change to the recruiter card's masking fails the build here.
 *
 * The duplication exists for one concrete reason: `desk-match-card.tsx` is a
 * `"use client"` module, and `recruiter-view.ts` is `server-only`. In the App
 * Router a Server Component importing a named export from a client module can be
 * handed a client reference rather than the function, so calling it on the server
 * is a runtime hazard rather than a style question. A four-line pure module with
 * a test pinning it to the original is the cheaper of the two risks.
 *
 * WHAT IS DELIBERATELY DIFFERENT
 *
 * `splitName` returns a DECOY surname — a plausible fake of the right length that
 * the recruiter card renders under a CSS blur, so the real family name is never in
 * the DOM. The candidate's own preview has no reason to invent one: it renders a
 * run of block glyphs instead, and only needs to know how many. So this returns a
 * length, never a string that could be mistaken for a name.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type RecruiterVisibleName = {
  /** The given name, which a recruiter sees in the clear. */
  given: string;
  /**
   * How many glyphs the surname placeholder should cover, or null when there is
   * no family name to hide. Matches `splitName`'s four-glyph floor: a two-letter
   * surname still has to read as a word.
   */
  maskedLength: number | null;
};

export function recruiterVisibleName(fullName: string): RecruiterVisibleName {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  // A single-token name is left alone — there is no family name to hide, and
  // masking the only word would leave the card anonymous.
  if (parts.length < 2) return { given: fullName.trim(), maskedLength: null };
  const family = parts.slice(1).join(" ");
  return {
    given: parts[0]!,
    maskedLength: Math.max(4, Array.from(family).length),
  };
}
