import { RUBRIC } from "@/features/interview/rubric";
import type {
  AnswerEvidence,
  Competency,
  CompetencyJudgment,
  EvidenceTier,
  InterviewPlan,
  InterviewState,
} from "@/features/interview/types";

/**
 * Pure evidence arithmetic. Deliberately free of `server-only` and of any LLM
 * dependency so the deterministic half of evaluation stays testable and cannot
 * drift with prompt changes.
 */

/**
 * Merges a follow-up answer's evidence into what a question already established.
 *
 * Evidence axes are OR-ed: a follow-up that finally surfaces practical detail
 * must not erase the conceptual credit earned on the first pass. Issue flags are
 * unioned for the audit trail — callers doing turn ROUTING must use the raw
 * per-answer evidence instead, or a recovered candidate would stay marked stuck.
 */
export function mergeEvidence(
  prior: AnswerEvidence | undefined,
  next: AnswerEvidence,
): AnswerEvidence {
  if (!prior) return next;
  return {
    conceptualFound: prior.conceptualFound || next.conceptualFound,
    practicalFound: prior.practicalFound || next.practicalFound,
    tradeoffsFound: prior.tradeoffsFound || next.tradeoffsFound,
    flaggedIssues: [
      ...new Set([...prior.flaggedIssues, ...next.flaggedIssues]),
    ],
    reasoning: next.reasoning,
  };
}

/**
 * COMMUNICATION carries no dedicated question slots — it is observed across
 * every answer rather than asked about directly. Scoping it to "questions
 * tagged COMMUNICATION" would therefore always find zero evidence and silently
 * zero out 10% of the score, so it gets its own transcript-wide derivation.
 */
function deriveCommunicationTier(state: InterviewState): EvidenceTier {
  const evidences = Object.values(state.evidenceByQuestionId);
  if (evidences.length === 0) return "NONE";

  const answered = evidences.length;
  const derailed = evidences.filter(
    (e) =>
      e.flaggedIssues.includes("off_topic") ||
      e.flaggedIssues.includes("stuck_or_evasive"),
  ).length;
  const explained = evidences.filter((e) => e.conceptualFound).length;

  const derailRate = derailed / answered;
  const explainRate = explained / answered;

  if (derailRate > 0.5) return "NONE";
  if (derailRate > 0.25) return "CLAIMED";
  if (explainRate >= 0.6) return "DEMONSTRATED";
  if (explainRate >= 0.3) return "EXPLAINED";
  return "CLAIMED";
}

/**
 * Deterministic tier for one competency, used whenever the semantic judgment
 * call is unavailable. Competencies with no mapped questions fall back to the
 * whole transcript rather than scoring NONE by construction.
 */
export function deriveCompetencyTier(
  competency: Competency,
  state: InterviewState,
  plan: InterviewPlan,
): EvidenceTier {
  if (competency === "COMMUNICATION") return deriveCommunicationTier(state);

  const questionIds = plan.questions
    .filter((q) => q.competency === competency)
    .map((q) => q.id);

  const evidences = (
    questionIds.length > 0
      ? questionIds.map((id) => state.evidenceByQuestionId[id])
      : Object.values(state.evidenceByQuestionId)
  ).filter((e): e is AnswerEvidence => Boolean(e));

  if (evidences.length === 0) return "NONE";

  const anyConceptual = evidences.some((e) => e.conceptualFound);
  const anyPractical = evidences.some((e) => e.practicalFound);

  if (anyConceptual && anyPractical) return "DEMONSTRATED";
  if (anyConceptual) return "EXPLAINED";
  if (anyPractical) return "CLAIMED";
  return "NONE";
}

export function deriveFallbackJudgments(
  state: InterviewState,
  plan: InterviewPlan,
): { judgments: CompetencyJudgment[]; summary: string } {
  return {
    judgments: RUBRIC.map((r) => ({
      competency: r.competency,
      tier: deriveCompetencyTier(r.competency, state, plan),
      justification:
        "Derived from per-answer evidence; semantic review unavailable.",
    })),
    summary:
      "Scored from per-answer evidence only — the final semantic review did not complete.",
  };
}
