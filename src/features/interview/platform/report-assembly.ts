import { scoreQuestion, scoreToTier } from "@/features/interview/module-scoring";
import {
  assessIntegrity,
  buildAgentInsights,
  buildQuestionAssessments,
  classifySkills,
  readinessFor,
  selectTranscriptExcerpts,
  toTen,
  type AgentInsight,
  type AssessmentIntegrity,
  type QuestionAssessment,
  type Readiness,
  type SkillAssessment,
  type TranscriptExcerpt,
  type TurnRow,
} from "@/features/interview/report-analysis";
import {
  assessPlatformCompetencies,
  assessSections,
  competencyScoreMap,
  overallFromPlatformCompetencies,
  type PlatformCompetencyAssessment,
  type SectionAssessment,
} from "@/features/interview/platform/scoring";
import type {
  InterviewPlan,
  InterviewState,
  PlannedQuestion,
  PlatformPlanContext,
} from "@/features/interview/types";

/**
 * The platform assessment report, assembled deterministically.
 *
 * Division of labour, and the reason the report can be trusted:
 *
 *   THIS FILE   every number, every section, every competency, every piece of
 *               evidence, every skill claim. All computed from the persisted
 *               evidence. No model input reaches any of it.
 *   report.ts   prose only — strengths, improvements, summary, recommendation.
 *               Each item must cite question ids, and any item citing a question
 *               that was not actually answered is DROPPED here before it can
 *               reach a reader.
 *
 * That boundary is the whole anti-fluff mechanism, and it is copied from
 * `report-assembly.ts` by contract rather than shared, for the reason recorded
 * in `platform/scoring.ts`.
 *
 * WHAT DIFFERS FROM THE COHORT DOCUMENT, and why:
 *
 *   milestone → coverage   The cohort's `{scopeFrom, scopeTo}` is a cohort DAY
 *                          RANGE, validated `min(1).max(31)`. A mock interview
 *                          has no days at all, and `Math.min(...[])` is
 *                          `Infinity`, so the cohort shape cannot represent this
 *                          report — it would fail validation on write. Coverage
 *                          names the domain and its pack sections instead.
 *   modules → sections     Grouping comes from the pack, not from `moduleForDay`.
 *   competencies           Keyed by the domain rubric's string ids.
 *
 * Reused unchanged from `report-analysis.ts`, which is entirely domain-blind:
 * `buildQuestionAssessments`, `classifySkills`, `buildAgentInsights`,
 * `selectTranscriptExcerpts`, `assessIntegrity`, `readinessFor`, `toTen`.
 *
 * Pure module: no `server-only`, no Prisma, no network.
 */

/** Bumped when the document shape changes. Old rows surface as unavailable. */
export const ASSESSMENT_REPORT_VERSION = 1 as const;

/* ------------------------------------------------------------------ types */

export type ReportCandidate = {
  name: string;
};

/**
 * What this interview covered.
 *
 * The replacement for `ReportMilestone`. Deliberately carries no day numbers and
 * no notion of scope-as-a-range: an interview covers a set of named sections
 * from a pinned pack version, which is both true and traceable.
 */
export type ReportCoverage = {
  domainSlug: string;
  domainLabel: string;
  packId: string;
  packVersion: number;
  rubricId: string;
  sections: { id: string; label: string }[];
  /** 1-based. Retakes make this meaningful where the cohort had no equivalent. */
  attemptNumber: number;
};

export type ReportOverall = {
  score: number;
  scoreOutOfTen: number;
  readiness: Readiness;
  tier: ReturnType<typeof scoreToTier>;
  durationSec: number;
  questionsAsked: number;
  questionsAnswered: number;
  followUpsAsked: number;
  escalationsEarned: number;
  redirectsIssued: number;
};

export type NarrativeItem = {
  text: string;
  evidenceRefs: string[];
};

export type ImprovementItem = NarrativeItem & {
  /** Sections to revisit, read off the cited questions' own provenance. */
  suggestedSections: string[];
};

export type EvidenceRow = {
  questionId: string;
  sectionId: string;
  question: string;
  mode: string;
  competencyId: string;
  /** The candidate's own words, verbatim and truncated. Never paraphrased. */
  answerExcerpt: string;
  matched: string[];
  missing: string[];
  score: number;
  depthReached: number;
  answered: boolean;
};

export type CompetencyReportRow = PlatformCompetencyAssessment & {
  scoreOutOfTen: number;
  strengths: string[];
  missingEvidence: string[];
};

export type AssessmentReportDocument = {
  version: typeof ASSESSMENT_REPORT_VERSION;
  generatedAt: string;
  candidate: ReportCandidate;
  coverage: ReportCoverage;
  overall: ReportOverall;
  sections: SectionAssessment[];
  competencies: CompetencyReportRow[];
  questionAssessments: QuestionAssessment[];
  skills: SkillAssessment[];
  strengths: NarrativeItem[];
  improvements: ImprovementItem[];
  /** Skills a question explicitly tested that never appeared in an answer. */
  expectedButNotDemonstrated: SkillAssessment[];
  agentInsights: AgentInsight[];
  transcriptExcerpts: TranscriptExcerpt[];
  evidence: EvidenceRow[];
  summary: string;
  recommendation: string;
  /** Whether provider failures thinned the evidence behind these numbers. */
  assessmentStatus: AssessmentIntegrity;
  /** True when the prose came from the deterministic fallback, not a model. */
  narrativeDegraded: boolean;
};

/* -------------------------------------------------------------- helpers */

const EXCERPT_CHARS = 400;

export function answerExcerptFor(
  state: InterviewState,
  questionId: string,
): string {
  const line = state.transcript.find(
    (l) => l.role === "candidate" && l.questionId === questionId,
  );
  if (!line) return "";
  const text = line.text.trim();
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}…` : text;
}

function matchedItems(
  question: PlannedQuestion,
  state: InterviewState,
): { matched: string[]; missing: string[] } {
  const expected = question.expectedEvidence ?? [];
  const indices = new Set(
    state.evidenceByQuestionId[question.id]?.matchedEvidence ?? [],
  );
  return {
    matched: expected.filter((_, i) => indices.has(i)),
    missing: expected.filter((_, i) => !indices.has(i)),
  };
}

/* ----------------------------------------------------- narrative filtering */

/**
 * Drops any narrative item that cannot be traced to a real answered question.
 *
 * This runs on model output before it is stored, and it is the reason a strength
 * in this report means something. An item keeps only the refs that resolve; an
 * item left with no refs at all is removed entirely, because an uncited claim
 * about someone's ability is exactly the generic AI fluff this report exists to
 * avoid.
 *
 * Same contract as `report-assembly.ts:filterNarrative`, copied rather than
 * shared per plan 103.
 */
export function filterNarrative<T extends NarrativeItem>(
  items: T[],
  answeredIds: Set<string>,
): T[] {
  const out: T[] = [];
  for (const item of items) {
    const text = (item.text ?? "").trim();
    if (text.length === 0) continue;

    const refs = [...new Set(item.evidenceRefs ?? [])].filter((ref) =>
      answeredIds.has(ref),
    );
    if (refs.length === 0) continue;

    out.push({ ...item, text, evidenceRefs: refs });
  }
  return out;
}

/* ------------------------------------------------- deterministic narrative */

/**
 * Strengths and gaps derived from the scores alone.
 *
 * Used when no model is available, and to top up a thin model response.
 * Deliberately plain: it states what the evidence shows and cites the question,
 * which is less readable than good prose but never wrong.
 */
export function deterministicNarrative(
  plan: InterviewPlan,
  scores: ReturnType<typeof scoreQuestion>[],
): { strengths: NarrativeItem[]; improvements: ImprovementItem[] } {
  const byId = new Map(plan.questions.map((q) => [q.id, q]));
  const answered = scores.filter((s) => s.answered && s.judged);

  const best = [...answered].sort((a, b) => b.score - a.score).slice(0, 3);
  const worst = [...answered].sort((a, b) => a.score - b.score).slice(0, 3);

  const strengths: NarrativeItem[] = best
    .filter((s) => s.cleared)
    .map((s) => ({
      text:
        `Covered ${s.matched} of ${s.expected} expected points on ` +
        `"${byId.get(s.questionId)?.text ?? s.questionId}"` +
        (s.rungsCleared > 0
          ? `, and held up under ${s.rungsCleared} deeper follow-up${
              s.rungsCleared === 1 ? "" : "s"
            }.`
          : "."),
      evidenceRefs: [s.questionId],
    }));

  const improvements: ImprovementItem[] = worst
    .filter((s) => !s.cleared)
    .map((s) => {
      const q = byId.get(s.questionId);
      return {
        text:
          `Did not reach the evidence bar on "${q?.text ?? s.questionId}" ` +
          `(${s.matched} of ${s.minEvidence} needed).`,
        evidenceRefs: [s.questionId],
        suggestedSections: q?.sectionId ? [q.sectionId] : [],
      };
    });

  return { strengths, improvements };
}

/* ---------------------------------------------------------------- assembly */

export type AssembleInput = {
  plan: InterviewPlan;
  context: PlatformPlanContext;
  state: InterviewState;
  candidate: ReportCandidate;
  attemptNumber: number;
  durationSec: number;
  /** Durable turn rows. Deep-probe answers and degraded flags live only here. */
  turns: TurnRow[];
  narrative: {
    strengths: NarrativeItem[];
    improvements: ImprovementItem[];
    summary: string;
    recommendation: string;
    degraded: boolean;
  };
  now?: Date;
};

export function assembleAssessmentReport(
  input: AssembleInput,
): AssessmentReportDocument {
  const { plan, context, state } = input;

  const scores = plan.questions.map((q) => scoreQuestion(q, state));
  const answered = scores.filter((s) => s.answered);
  const answeredIds = new Set(answered.map((s) => s.questionId));

  const competencyAssessments = assessPlatformCompetencies(
    plan,
    state,
    context.rubric.id,
  );
  const overallScore = overallFromPlatformCompetencies(competencyAssessments);
  const sections = assessSections(plan, state, context.sections);

  const escalationsEarned = scores.reduce(
    (sum, s) => sum + Math.max(0, s.depthReached - 1),
    0,
  );

  // The analytical layer — all computed from the plan, the recorded state and
  // the durable turn rows. Never from the model.
  const questionAssessments = buildQuestionAssessments(plan, state, input.turns);
  const skills = classifySkills(questionAssessments);
  const agentInsights = buildAgentInsights(questionAssessments, skills);
  const transcriptExcerpts = selectTranscriptExcerpts(questionAssessments);
  const assessmentStatus = assessIntegrity(
    input.turns,
    input.narrative.degraded,
    questionAssessments,
  );

  const byQuestionId = new Map(questionAssessments.map((a) => [a.questionId, a]));

  const competencies: CompetencyReportRow[] = competencyAssessments.map((c) => {
    const forCompetency = c.evidenceRefs
      .map((ref) => byQuestionId.get(ref))
      .filter((a): a is QuestionAssessment => a !== undefined);
    return {
      ...c,
      scoreOutOfTen: toTen(c.score),
      strengths: [...new Set(forCompetency.flatMap((a) => a.demonstrated))],
      missingEvidence: [...new Set(forCompetency.flatMap((a) => a.missing))],
    };
  });

  const evidence: EvidenceRow[] = plan.questions.map((question) => {
    const score = scoreQuestion(question, state);
    const { matched, missing } = matchedItems(question, state);
    return {
      questionId: question.id,
      sectionId: question.sectionId ?? "",
      question: question.text,
      mode: question.mode ?? "CONCEPTUAL",
      competencyId: question.platformCompetencyId ?? "",
      answerExcerpt: answerExcerptFor(state, question.id),
      matched,
      missing,
      score: score.score,
      depthReached: score.depthReached,
      answered: score.answered,
    };
  });

  const fallback = deterministicNarrative(plan, scores);
  const strengths = filterNarrative(input.narrative.strengths, answeredIds);
  const improvements = filterNarrative(input.narrative.improvements, answeredIds);

  return {
    version: ASSESSMENT_REPORT_VERSION,
    generatedAt: (input.now ?? new Date()).toISOString(),
    candidate: input.candidate,
    coverage: {
      domainSlug: context.domainSlug,
      domainLabel: context.domainLabel,
      packId: context.packId,
      packVersion: context.packVersion,
      rubricId: context.rubric.id,
      sections: context.sections.map((s) => ({ id: s.id, label: s.label })),
      attemptNumber: input.attemptNumber,
    },
    overall: {
      score: overallScore,
      scoreOutOfTen: toTen(overallScore),
      readiness: readinessFor(overallScore),
      tier: scoreToTier(overallScore),
      durationSec: input.durationSec,
      questionsAsked: plan.questions.length,
      questionsAnswered: answered.length,
      followUpsAsked: state.followUpsAsked,
      escalationsEarned,
      redirectsIssued: state.redirectsAsked ?? 0,
    },
    sections,
    competencies,
    questionAssessments,
    skills,
    // A model that produced nothing usable must not leave the report empty.
    strengths: strengths.length > 0 ? strengths : fallback.strengths,
    improvements: improvements.length > 0 ? improvements : fallback.improvements,
    // Only skills a question actually tested and the candidate never produced.
    // NOT_ASSESSED is deliberately excluded: never asked is not a shortcoming.
    expectedButNotDemonstrated: skills.filter(
      (s) => s.level === "NOT_DEMONSTRATED" || s.level === "WEAK",
    ),
    agentInsights,
    transcriptExcerpts,
    evidence,
    summary: input.narrative.summary,
    recommendation: input.narrative.recommendation,
    assessmentStatus,
    narrativeDegraded:
      input.narrative.degraded ||
      strengths.length === 0 ||
      improvements.length === 0,
  };
}

/** The denormalised competency map for the attempt row. */
export function competencyScoresFor(
  report: AssessmentReportDocument,
): Record<string, number> {
  return competencyScoreMap(
    report.competencies.map((c) => ({
      competencyId: c.competencyId,
      label: c.label,
      weight: c.weight,
      score: c.score,
      tier: c.tier,
      evidenceRefs: c.evidenceRefs,
      justification: c.justification,
      unassessed: c.unassessed,
    })),
  );
}
