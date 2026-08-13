import {
  EVIDENCE_TIER_SCORE,
  RUBRIC,
  TOTAL_RUBRIC_WEIGHT,
  getCompetencyDefinition,
} from "@/features/interview/rubric";
import type {
  CompetencyJudgment,
  InterviewScores,
} from "@/features/interview/types";

/**
 * Score aggregation is deterministic and never delegated to a model. The LLM
 * returns an evidence tier per competency; the weighting, the arithmetic, and
 * the final number all happen here, so two candidates with identical evidence
 * always get identical scores.
 */

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function aggregateScores(
  judgments: CompetencyJudgment[],
  summary: string,
): InterviewScores {
  const byCompetency = new Map(judgments.map((j) => [j.competency, j]));

  const perCompetency = RUBRIC.map((r) => {
    const judgment = byCompetency.get(r.competency);
    const tier = judgment?.tier ?? "NONE";
    return {
      competency: r.competency,
      score: EVIDENCE_TIER_SCORE[tier],
      tier,
    };
  });

  const weightedSum = perCompetency.reduce((sum, entry) => {
    const def = getCompetencyDefinition(entry.competency);
    return sum + entry.score * def.weight;
  }, 0);

  return {
    perCompetency,
    overallScore: clampScore(weightedSum / TOTAL_RUBRIC_WEIGHT),
    summary,
  };
}
