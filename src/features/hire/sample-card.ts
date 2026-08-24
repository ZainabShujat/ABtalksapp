import type { MatchCardData } from "@/components/hire/match-card";
import type { JobSpec } from "@/lib/validations/hire";

const MAX_SAMPLES = 3;

/**
 * Illustrative cards built from a recruiter's own stated requirement.
 *
 * Shown only when a real search returned nobody. Nothing here is a person —
 * every field is copied from the spec, and the ref prefix is `SAMPLE:`, which
 * the candidate whitelist already rejects. Pure: no DB, no model, no
 * `server-only`.
 */
export function buildSampleCards(
  spec: JobSpec,
  count: number = 1,
): MatchCardData[] {
  const title = spec.title?.trim() || "";
  const stack = (spec.mustHaveStack ?? [])
    .map((s) => s.trim())
    .filter(Boolean);

  if (!title && stack.length === 0) return [];

  const n = Math.min(MAX_SAMPLES, Math.max(0, Math.floor(count)));
  if (n === 0) return [];

  const jobRole = title || roleFromStack(stack);
  const cards: MatchCardData[] = [];

  for (let i = 0; i < n; i++) {
    const skills = rotate(stack, i);
    cards.push({
      candidateRef: `SAMPLE:${crypto.randomUUID()}`,
      programMemberId: null,
      jobRole,
      score: 0,
      tier: "NONE",
      rationale: null,
      gaps: [],
      availabilityUnknown: false,
      shortlisted: false,
      engagementStatus: null,
      highlightSkills: skills.length ? skills : undefined,
      evidence: {
        skills,
        ...(typeof spec.minExperience === "number"
          ? { yearsExperience: spec.minExperience }
          : {}),
      },
    });
  }

  return cards;
}

/** "python" → "Python developer". Never "Candidate". */
function roleFromStack(stack: string[]): string {
  const first = stack[0] ?? "Software";
  const word = first.charAt(0).toUpperCase() + first.slice(1);
  return `${word} developer`;
}

function rotate(items: string[], by: number): string[] {
  if (items.length === 0) return items;
  const k = ((by % items.length) + items.length) % items.length;
  if (k === 0) return items;
  return [...items.slice(k), ...items.slice(0, k)];
}
