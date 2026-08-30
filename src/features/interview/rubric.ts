import type { Competency, EvidenceTier } from "@/features/interview/types";

/**
 * The rubric is IDENTICAL for every candidate — that is what makes scores
 * comparable. Personalization happens in question phrasing and source material,
 * never in the competency set or its weights.
 */

export type CompetencyDefinition = {
  competency: Competency;
  label: string;
  weight: number;
  expectations: string;
  /** What the evaluator must look for, per evidence axis. */
  evidenceRequired: {
    conceptual: string;
    practical: string;
    tradeoffs: string;
  };
};

export const RUBRIC: readonly CompetencyDefinition[] = [
  {
    competency: "CONCEPTUAL",
    label: "Conceptual understanding",
    weight: 25,
    expectations:
      "Explains the underlying idea correctly and in their own words, not recited definitions.",
    evidenceRequired: {
      conceptual: "States what the concept is and why it exists.",
      practical: "Connects the concept to something they built or used.",
      tradeoffs: "Knows when the concept does not apply.",
    },
  },
  {
    competency: "PRACTICAL",
    label: "Practical application",
    weight: 25,
    expectations:
      "Cites concrete work they personally did, with specifics a bystander could not invent.",
    evidenceRequired: {
      conceptual: "Understands what the work was for.",
      practical: "Names specific files, tools, data, or steps they executed.",
      tradeoffs: "Describes what broke and how they responded.",
    },
  },
  {
    competency: "PROBLEM_SOLVING",
    label: "Problem solving & reasoning",
    weight: 20,
    expectations:
      "Decomposes an unfamiliar problem and reasons forward instead of pattern-matching.",
    evidenceRequired: {
      conceptual: "Frames the problem before solving it.",
      practical: "Walks through a concrete approach end to end.",
      tradeoffs: "Compares at least two approaches on real constraints.",
    },
  },
  {
    competency: "TECHNICAL_DEPTH",
    label: "Code & technical depth",
    weight: 20,
    expectations:
      "Reasons accurately about code behaviour, failure modes, and implementation detail.",
    evidenceRequired: {
      conceptual: "Predicts what code does and why.",
      practical: "Refers to real implementation detail from their own work.",
      tradeoffs: "Identifies edge cases, complexity, or failure modes.",
    },
  },
  {
    competency: "COMMUNICATION",
    label: "Communication clarity",
    weight: 10,
    expectations:
      "Structured, concise, audience-aware answers; handles not-knowing honestly.",
    evidenceRequired: {
      conceptual: "Answers the question actually asked.",
      practical: "Gives an example without being asked twice.",
      tradeoffs: "Signals uncertainty accurately rather than bluffing.",
    },
  },
] as const;

const RUBRIC_BY_COMPETENCY = new Map(RUBRIC.map((r) => [r.competency, r]));

export function getCompetencyDefinition(
  competency: Competency,
): CompetencyDefinition {
  const def = RUBRIC_BY_COMPETENCY.get(competency);
  if (!def) throw new Error(`Unknown competency: ${competency}`);
  return def;
}

/** Score contributed by each evidence tier, before weighting. */
export const EVIDENCE_TIER_SCORE: Record<EvidenceTier, number> = {
  NONE: 0,
  CLAIMED: 40,
  EXPLAINED: 70,
  DEMONSTRATED: 100,
};

export const TOTAL_RUBRIC_WEIGHT = RUBRIC.reduce((sum, r) => sum + r.weight, 0);

/**
 * Snapshot stored on each attempt so historical scores stay interpretable if
 * the rubric is ever reweighted.
 */
export function buildRubricSnapshot() {
  return {
    version: 1 as const,
    competencies: RUBRIC.map((r) => ({
      competency: r.competency,
      label: r.label,
      weight: r.weight,
    })),
  };
}
