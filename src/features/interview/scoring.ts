import {
  EVIDENCE_TIER_SCORE,
  RUBRIC,
  TOTAL_RUBRIC_WEIGHT,
  getCompetencyDefinition,
} from "@/features/interview/rubric";
import { deriveCompetencyTier } from "@/features/interview/evidence";
import {
  scoreToTier,
  type QuestionScore,
} from "@/features/interview/module-scoring";
import type {
  Competency,
  CompetencyJudgment,
  EvidenceTier,
  InterviewPlan,
  InterviewScores,
  InterviewState,
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

/* ------------------------------------------- evidence-backed competencies */

export type CompetencyAssessment = {
  competency: Competency;
  label: string;
  weight: number;
  score: number;
  tier: EvidenceTier;
  /** Question ids this score was computed from. Empty for COMMUNICATION. */
  evidenceRefs: string[];
  /** How the number was reached, in one sentence a candidate could check. */
  justification: string;
};

/**
 * Competency scores computed from per-question evidence.
 *
 * This replaces asking a model for a tier. The rubric still decides WHAT is
 * measured and how much each axis is worth; the arithmetic decides the number.
 * The model's only remaining job in the whole scoring path is judging which
 * checklist items an individual answer covered — and even that is validated
 * against the checklist before it counts.
 *
 * COMMUNICATION has no questions of its own by design (it is observed across
 * every answer), so it is derived from behaviour across the transcript rather
 * than scored as zero for want of a slot.
 */
export function assessCompetencies(
  questionScores: QuestionScore[],
  state: InterviewState,
  plan: InterviewPlan,
): CompetencyAssessment[] {
  return RUBRIC.map((definition) => {
    if (definition.competency === "COMMUNICATION") {
      const tier = deriveCompetencyTier("COMMUNICATION", state, plan);
      return {
        competency: definition.competency,
        label: definition.label,
        weight: definition.weight,
        score: EVIDENCE_TIER_SCORE[tier],
        tier,
        evidenceRefs: [],
        justification:
          "Observed across every answer — clarity, staying on the question, and handling not-knowing honestly.",
      };
    }

    // JUDGED only. An answer the evaluator never assessed carries no verdict,
    // so averaging it in as a zero would manufacture a failure nobody
    // established — the defect that made a good answer read as 0/10.
    const forCompetency = questionScores.filter(
      (s) => s.competency === definition.competency && s.answered && s.judged,
    );

    if (forCompetency.length === 0) {
      const attempted = questionScores.filter(
        (s) => s.competency === definition.competency && s.answered,
      ).length;
      return {
        competency: definition.competency,
        label: definition.label,
        weight: definition.weight,
        score: 0,
        tier: "NONE" as EvidenceTier,
        evidenceRefs: [],
        justification:
          attempted > 0
            ? `Not assessed — the evaluator was unavailable for ${attempted} answered question${attempted === 1 ? "" : "s"}.`
            : "No question for this competency was answered.",
      };
    }

    const score = Math.round(
      forCompetency.reduce((sum, s) => sum + s.score, 0) / forCompetency.length,
    );
    const cleared = forCompetency.filter((s) => s.cleared).length;

    return {
      competency: definition.competency,
      label: definition.label,
      weight: definition.weight,
      score,
      tier: scoreToTier(score),
      evidenceRefs: forCompetency.map((s) => s.questionId),
      justification:
        `Cleared the evidence bar on ${cleared} of ${forCompetency.length} ` +
        `question${forCompetency.length === 1 ? "" : "s"} for this competency.`,
    };
  });
}

/**
 * The single overall number, weighted by the rubric.
 *
 * Computed from CORE questions only — extension questions about work beyond the
 * milestone are reported separately and never move this number, because two
 * DAY_15 scores have to mean the same thing.
 */
export function overallFromCompetencies(
  assessments: CompetencyAssessment[],
): number {
  const weighted = assessments.reduce((sum, a) => sum + a.score * a.weight, 0);
  return clampScore(weighted / TOTAL_RUBRIC_WEIGHT);
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
