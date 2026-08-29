import { scoreQuestion, scoreToTier } from "@/features/interview/module-scoring";
import type { QuestionScore } from "@/features/interview/module-scoring";
import { getRubric } from "@/features/interview/platform/rubrics";
import type { PlatformCompetency } from "@/features/interview/platform/types";
import type {
  AnswerEvidence,
  InterviewPlan,
  InterviewState,
  PlannedQuestion,
} from "@/features/interview/types";

/**
 * Evidence → numbers, for the interview platform.
 *
 * NO MODEL IS CONSULTED ANYWHERE IN THIS FILE. A score is a function of which
 * expected-evidence items a candidate actually covered and nothing else, so two
 * candidates whose answers carry the same evidence receive the same score, and
 * any number here can be explained by pointing at a checklist.
 *
 * WHY THIS IS A SEPARATE FILE FROM `scoring.ts` RATHER THAN A GENERALISATION OF
 * IT. The cohort aggregates by the five-value `Competency` union, backed by five
 * named database columns, under one global `RUBRIC` const. The platform
 * aggregates by arbitrary string competency ids under a per-domain rubric
 * carried on the plan. Refactoring the cohort file to serve both would put a
 * live, once-per-lifetime graded credential behind every future platform
 * change — for the sake of roughly eighty lines. The duplication is the cheaper
 * risk, and this paragraph exists so it reads as a decision rather than an
 * accident.
 *
 * What IS shared: `scoreQuestion` from `module-scoring.ts`, unchanged. It is
 * already domain-blind — with empty `sourceDays` it returns `moduleNumbers: []`
 * — and it owns the UNJUDGED-vs-MISSED rule that everything below depends on.
 *
 * Pure module: no `server-only`, no Prisma, no network.
 */

/* ------------------------------------------------- observed-across-answers */

/**
 * A score for a competency that has no questions of its own.
 *
 * The generalisation of the cohort's `deriveCommunicationTier`. That function is
 * selected by a hard-coded `competency === "COMMUNICATION"` check; here the
 * behaviour is chosen by the rubric's `observedAcrossAnswers` flag, so a rubric
 * without such a dimension simply has none rather than silently scoring one it
 * never measured.
 *
 * Scoped to answers, not turns: a redirect or a repeat records no evidence, so
 * it cannot count for or against anyone.
 */
function scoreObservedAcrossAnswers(state: InterviewState): number {
  const evidences = Object.values(state.evidenceByQuestionId);
  if (evidences.length === 0) return 0;

  const answered = evidences.length;
  const derailed = evidences.filter(
    (e) =>
      e.flaggedIssues.includes("off_topic") ||
      e.flaggedIssues.includes("stuck_or_evasive") ||
      e.relevance === "OFF_TOPIC",
  ).length;

  const derailRate = derailed / answered;
  if (derailRate > 0.5) return 0;

  /**
   * "Landed the point" is the signal, defined as answering the question that
   * was actually asked — an answer that covered checklist items did that,
   * whatever vocabulary it used.
   *
   * Only judged answers count. An answer the evaluator never saw makes no claim
   * either way, and averaging it in as a failure is the defect that made a good
   * cohort interview read as 0/10.
   */
  const judged = evidences.filter(
    (e): e is AnswerEvidence => e.matchedEvidence !== undefined,
  );
  if (judged.length === 0) return 0;

  const landed =
    judged.filter((e) => (e.matchedEvidence?.length ?? 0) > 0).length /
    judged.length;

  // Same bands as the cohort's tier mapping (0 / 40 / 70 / 100), so a reader
  // comparing a cohort report with a platform one is reading one scale.
  const base = landed >= 0.75 ? 100 : landed >= 0.4 ? 70 : landed > 0 ? 40 : 0;

  // A derail rate between 25% and 50% caps the result: repeatedly going off the
  // question is itself a communication outcome, however good the answers that
  // did land.
  return derailRate > 0.25 ? Math.min(base, 40) : base;
}

/* -------------------------------------------------------- per competency */

export type PlatformCompetencyAssessment = {
  competencyId: string;
  label: string;
  weight: number;
  score: number;
  tier: ReturnType<typeof scoreToTier>;
  /** Question ids this score was computed from. Empty when observed-across. */
  evidenceRefs: string[];
  /** How the number was reached, in one sentence a candidate could check. */
  justification: string;
  /** True when nothing judged any question for this competency. */
  unassessed: boolean;
};

/**
 * The question ids assigned to each rubric competency by the PACK.
 *
 * Read from `platformCompetencyId`, never from `question.competency`. The
 * second is the engine's five-value bookkeeping field, which drives the depth
 * ladder; using it here would report a Behavioral interview under the cohort's
 * competency names.
 */
function questionsFor(
  plan: InterviewPlan,
  competencyId: string,
): PlannedQuestion[] {
  return plan.questions.filter(
    (q) => q.platformCompetencyId === competencyId,
  );
}

export function assessPlatformCompetencies(
  plan: InterviewPlan,
  state: InterviewState,
  rubricId: string,
): PlatformCompetencyAssessment[] {
  const rubric = getRubric(rubricId);

  return rubric.competencies.map((definition: PlatformCompetency) => {
    if (definition.observedAcrossAnswers) {
      const score = scoreObservedAcrossAnswers(state);
      return {
        competencyId: definition.id,
        label: definition.label,
        weight: definition.weight,
        score,
        tier: scoreToTier(score),
        evidenceRefs: [],
        justification:
          "Observed across every answer, rather than by a question of its own.",
        unassessed: Object.keys(state.evidenceByQuestionId).length === 0,
      };
    }

    const scores = questionsFor(plan, definition.id).map((q) =>
      scoreQuestion(q, state),
    );

    // JUDGED only. An answer the evaluator never assessed carries no verdict, so
    // averaging it in as a zero would manufacture a failure nobody established.
    const counted = scores.filter((s) => s.answered && s.judged);

    if (counted.length === 0) {
      const attempted = scores.filter((s) => s.answered).length;
      return {
        competencyId: definition.id,
        label: definition.label,
        weight: definition.weight,
        score: 0,
        tier: "NONE" as const,
        evidenceRefs: [],
        justification:
          attempted > 0
            ? `Not assessed — the evaluator was unavailable for ${attempted} answered question${attempted === 1 ? "" : "s"}.`
            : "No question for this competency was answered.",
        unassessed: true,
      };
    }

    const score = Math.round(
      counted.reduce((sum, s) => sum + s.score, 0) / counted.length,
    );
    const cleared = counted.filter((s) => s.cleared).length;

    return {
      competencyId: definition.id,
      label: definition.label,
      weight: definition.weight,
      score,
      tier: scoreToTier(score),
      evidenceRefs: counted.map((s) => s.questionId),
      justification:
        `Cleared the evidence bar on ${cleared} of ${counted.length} ` +
        `question${counted.length === 1 ? "" : "s"} for this competency.`,
      unassessed: false,
    };
  });
}

/**
 * The single overall number, weighted by the domain rubric.
 *
 * UNASSESSED COMPETENCIES ARE EXCLUDED FROM BOTH SIDES OF THE DIVISION, not
 * scored as zero. This differs deliberately from the cohort's
 * `overallFromCompetencies`, which always divides by the full rubric weight.
 *
 * The cohort can do that because its interview is gated: every candidate is
 * asked every question, so a competency with no judged answer means the
 * evaluator failed, and the report says so loudly via `assessmentStatus`. A
 * mock interview can end early at any point — the user closes the tab, the
 * timer runs out — and dividing by the full weight would report someone who
 * answered four of seven questions well as having scored badly overall, which
 * is not what happened. Re-weighting reports what was actually assessed.
 */
export function overallFromPlatformCompetencies(
  assessments: PlatformCompetencyAssessment[],
): number {
  const counted = assessments.filter((a) => !a.unassessed);
  const totalWeight = counted.reduce((sum, a) => sum + a.weight, 0);
  if (totalWeight === 0) return 0;

  const weighted = counted.reduce((sum, a) => sum + a.score * a.weight, 0);
  return Math.min(100, Math.max(0, Math.round(weighted / totalWeight)));
}

/** The `{competencyId: score}` map denormalised onto the attempt row. */
export function competencyScoreMap(
  assessments: PlatformCompetencyAssessment[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of assessments) out[a.competencyId] = a.score;
  return out;
}

/* ------------------------------------------------------------- sections */

export type SectionAssessment = {
  sectionId: string;
  label: string;
  /** Null means NOT ASSESSED — never rendered as a zero. */
  score: number | null;
  tier: ReturnType<typeof scoreToTier> | null;
  questionsAsked: number;
  questionsAnswered: number;
  /** Question ids behind this number. The section score's audit trail. */
  evidenceRefs: string[];
  note: string;
};

/**
 * Section scores — the platform's grouping unit, replacing cohort modules.
 *
 * `scoreModules` groups by `moduleForDay(sourceDays[0])`, which is meaningless
 * without a 31-day curriculum. Sections come from the pack itself, so a report
 * can say "Judgement and limits: 2 of 3" with no notion of a day.
 *
 * A section with no judged answer reports `null`, not 0 — the same rule the
 * cohort applies to a module it never covered, and for the same reason: a zero
 * reads as a failure the candidate never had the chance to avoid.
 */
export function assessSections(
  plan: InterviewPlan,
  state: InterviewState,
  sections: readonly { id: string; label: string }[],
): SectionAssessment[] {
  return sections.map((section) => {
    const inSection = plan.questions.filter((q) => q.sectionId === section.id);
    const scores: QuestionScore[] = inSection.map((q) => scoreQuestion(q, state));
    const counted = scores.filter((s) => s.answered && s.judged);

    if (counted.length === 0) {
      return {
        sectionId: section.id,
        label: section.label,
        score: null,
        tier: null,
        questionsAsked: inSection.length,
        questionsAnswered: 0,
        evidenceRefs: [],
        note:
          inSection.length === 0
            ? "Not assessed — this interview asks no question from this section."
            : scores.some((s) => s.answered)
              ? "Not assessed — the evaluator was unavailable for these answers."
              : "Not assessed — these questions were not reached.",
      };
    }

    const score = Math.round(
      counted.reduce((sum, s) => sum + s.score, 0) / counted.length,
    );

    return {
      sectionId: section.id,
      label: section.label,
      score,
      tier: scoreToTier(score),
      questionsAsked: inSection.length,
      questionsAnswered: counted.length,
      evidenceRefs: counted.map((s) => s.questionId),
      note: `${counted.length} of ${inSection.length} question${
        inSection.length === 1 ? "" : "s"
      } answered.`,
    };
  });
}

/* ------------------------------------------------------------- progress */

export type PlatformProgress = {
  answered: number;
  total: number;
  /** 0–1. */
  ratio: number;
};

/**
 * How far through the interview the candidate is.
 *
 * Counted in QUESTIONS, never in turns: follow-ups and deep probes add turns
 * without advancing the assessment, so a turn-based percentage would tell
 * someone on question three that they were nearly finished.
 */
export function platformProgress(
  plan: InterviewPlan,
  state: InterviewState,
): PlatformProgress {
  const total = plan.questions.length;
  const answered = plan.questions.filter(
    (q) => state.evidenceByQuestionId[q.id] !== undefined,
  ).length;
  return { answered, total, ratio: total === 0 ? 0 : answered / total };
}
