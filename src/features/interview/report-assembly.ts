import { interviewReportSchema } from "@/lib/validations/interview";
import { BLUEPRINT_LABEL, type InterviewBlueprintKey } from "@/features/interview/cohort/blueprint";
import { moduleForDay } from "@/features/interview/cohort/curriculum";
import {
  assertScopeIntegrity,
  scoreModules,
  scoreQuestion,
  scoreToTier,
  type ModuleAssessment,
  type QuestionScore,
} from "@/features/interview/module-scoring";
import {
  assessCompetencies,
  overallFromCompetencies,
  type CompetencyAssessment,
} from "@/features/interview/scoring";
import type {
  InterviewPlan,
  InterviewState,
  PlannedQuestion,
} from "@/features/interview/types";

/**
 * The report, assembled deterministically.
 *
 * Division of labour, and the reason the report can be trusted:
 *
 *   THIS FILE   every number, every module, every competency, every piece of
 *               evidence, every skill claim. All computed from the persisted
 *               evidence. No model input reaches any of it.
 *   report.ts   prose only — strengths, improvements, summary, recommendation.
 *               Each item must cite question ids, and any item citing a
 *               question that was not actually answered is DROPPED here before
 *               it can reach a reader.
 *
 * That boundary is the whole anti-fluff mechanism. A model cannot praise a
 * candidate for work they did not do, because the sentence is discarded unless
 * it points at a real answered question.
 *
 * Pure module: no `server-only`, no Prisma, no network.
 */

export const INTERVIEW_REPORT_VERSION = 1 as const;

/* ------------------------------------------------------------------ types */

export type ReportCandidate = {
  name: string;
  cohort: string;
  jobRole: string;
  company: string;
};

export type ReportMilestone = {
  blueprint: InterviewBlueprintKey;
  label: string;
  scopeFrom: number;
  scopeTo: number;
  /** The member's live progress when they sat it. Context, never scored. */
  progressDay: number | null;
  bankVersion: string;
};

export type ReportOverall = {
  score: number;
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
  /** Cohort days to revisit, taken from the cited questions' own provenance. */
  suggestedDays: number[];
};

export type EvidenceRow = {
  questionId: string;
  tier: "CORE" | "EXTENSION";
  question: string;
  mode: string;
  competency: string;
  moduleNumber: number | null;
  sourceDays: number[];
  /** The candidate's own words, verbatim and truncated. Never paraphrased. */
  answerExcerpt: string;
  matched: string[];
  missing: string[];
  score: number;
  depthReached: number;
  answered: boolean;
};

export type BeyondMilestoneRow = {
  questionId: string;
  sourceDays: number[];
  question: string;
  answerExcerpt: string;
  matched: string[];
  note: string;
};

export type InterviewReportDocument = {
  version: typeof INTERVIEW_REPORT_VERSION;
  generatedAt: string;
  candidate: ReportCandidate;
  milestone: ReportMilestone;
  overall: ReportOverall;
  modules: ModuleAssessment[];
  competencies: CompetencyAssessment[];
  strengths: NarrativeItem[];
  improvements: ImprovementItem[];
  skills: { demonstrated: string[]; partial: string[]; notShown: string[] };
  beyondMilestone: BeyondMilestoneRow[];
  evidence: EvidenceRow[];
  summary: string;
  recommendation: string;
  /** True when the prose came from the deterministic fallback, not a model. */
  narrativeDegraded: boolean;
};

/* -------------------------------------------------------------- helpers */

const EXCERPT_CHARS = 400;

/** The candidate's answer to a question, verbatim from the transcript. */
export function answerExcerptFor(
  state: InterviewState,
  questionId: string,
): string {
  const line = state.transcript.find(
    (l) => l.role === "candidate" && l.questionId === questionId,
  );
  if (!line) return "";
  const text = line.text.trim();
  return text.length > EXCERPT_CHARS
    ? `${text.slice(0, EXCERPT_CHARS)}…`
    : text;
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
 * This runs on model output before it is stored, and it is the reason a
 * strength in this report means something. An item keeps only the refs that
 * resolve; an item left with no refs at all is removed entirely, because an
 * uncited claim about a candidate's ability is exactly the "generic AI fluff"
 * this report exists to avoid.
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
 * Used when no model is available, and used to top up a thin model response.
 * Deliberately plain: it states what the evidence shows and cites the question,
 * which is less readable than good prose but never wrong.
 */
export function deterministicNarrative(
  plan: InterviewPlan,
  scores: QuestionScore[],
): { strengths: NarrativeItem[]; improvements: ImprovementItem[] } {
  const byId = new Map(plan.questions.map((q) => [q.id, q]));
  const answered = scores.filter((s) => s.answered);

  const best = [...answered].sort((a, b) => b.score - a.score).slice(0, 3);
  const worst = [...answered].sort((a, b) => a.score - b.score).slice(0, 3);

  const strengths: NarrativeItem[] = best
    .filter((s) => s.cleared)
    .map((s) => {
      const q = byId.get(s.questionId);
      return {
        text:
          `Covered ${s.matched} of ${s.expected} expected points on ` +
          `${q?.sourceRef.label ?? s.questionId}` +
          (s.rungsCleared > 0
            ? `, and held up under ${s.rungsCleared} deeper follow-up${
                s.rungsCleared === 1 ? "" : "s"
              }.`
            : "."),
        evidenceRefs: [s.questionId],
      };
    });

  const improvements: ImprovementItem[] = worst
    .filter((s) => !s.cleared)
    .map((s) => {
      const q = byId.get(s.questionId);
      return {
        text:
          `Did not reach the evidence bar on ${q?.sourceRef.label ?? s.questionId} ` +
          `(${s.matched} of ${s.minEvidence} needed).`,
        evidenceRefs: [s.questionId],
        suggestedDays: s.sourceDays,
      };
    });

  return { strengths, improvements };
}

/* ---------------------------------------------------------------- assembly */

export type AssembleInput = {
  plan: InterviewPlan;
  state: InterviewState;
  blueprint: InterviewBlueprintKey;
  scopeDays: number[];
  candidate: ReportCandidate;
  progressDay: number | null;
  bankVersion: string;
  durationSec: number;
  narrative: {
    strengths: NarrativeItem[];
    improvements: ImprovementItem[];
    summary: string;
    recommendation: string;
    degraded: boolean;
  };
  now?: Date;
};

export function assembleReport(input: AssembleInput): InterviewReportDocument {
  const { plan, state, blueprint, scopeDays } = input;

  // Third and final scope check, at the point a number is produced.
  assertScopeIntegrity(plan, scopeDays);

  const coreQuestions = plan.questions.filter(
    (q) => (q.tier ?? "CORE") === "CORE",
  );
  const extensionQuestions = plan.questions.filter(
    (q) => (q.tier ?? "CORE") === "EXTENSION",
  );

  const coreScores = coreQuestions.map((q) => scoreQuestion(q, state));
  const answered = coreScores.filter((s) => s.answered);
  const answeredIds = new Set(answered.map((s) => s.questionId));

  const competencies = assessCompetencies(coreScores, state, plan);
  const overallScore = overallFromCompetencies(competencies);
  const modules = scoreModules(plan, state, scopeDays);

  const escalationsEarned = coreScores.reduce(
    (sum, s) => sum + Math.max(0, s.depthReached - 1),
    0,
  );

  // Skills are the checklist items themselves, split by whether the candidate
  // actually produced them. No taxonomy is invented: every string here is a
  // line an assessment author wrote and a judge matched against.
  const demonstrated: string[] = [];
  const notShown: string[] = [];
  for (const question of coreQuestions) {
    const { matched, missing } = matchedItems(question, state);
    demonstrated.push(...matched);
    if (answeredIds.has(question.id)) notShown.push(...missing);
  }

  // "Partial" = shown on one question but missed on another with the same text.
  const demonstratedSet = new Set(demonstrated);
  const partial = [...new Set(notShown.filter((s) => demonstratedSet.has(s)))];
  const notShownOnly = [...new Set(notShown.filter((s) => !demonstratedSet.has(s)))];

  const evidence: EvidenceRow[] = plan.questions.map((question) => {
    const score = scoreQuestion(question, state);
    const { matched, missing } = matchedItems(question, state);
    return {
      questionId: question.id,
      tier: (question.tier ?? "CORE") as "CORE" | "EXTENSION",
      question: question.text,
      mode: question.mode ?? "CONCEPTUAL",
      competency: question.competency,
      moduleNumber: moduleForDay(question.sourceRef.sourceDays?.[0] ?? 0)?.number ?? null,
      sourceDays: question.sourceRef.sourceDays ?? [],
      answerExcerpt: answerExcerptFor(state, question.id),
      matched,
      missing,
      score: score.score,
      depthReached: score.depthReached,
      answered: score.answered,
    };
  });

  const beyondMilestone: BeyondMilestoneRow[] = extensionQuestions
    .filter((q) => state.evidenceByQuestionId[q.id] !== undefined)
    .map((q) => {
      const { matched } = matchedItems(q, state);
      // Deliberately NOT scored. An extension question is asked because the
      // member has already passed the day it covers, and scoring it would make
      // two DAY_15 results depend on how far past the milestone each candidate
      // happened to be.
      return {
        questionId: q.id,
        sourceDays: q.sourceRef.sourceDays ?? [],
        question: q.text,
        answerExcerpt: answerExcerptFor(state, q.id),
        matched,
        note:
          `Beyond the ${BLUEPRINT_LABEL[blueprint]} scope — asked because these ` +
          `days are already passed. Not included in the score.`,
      };
    });

  const fallback = deterministicNarrative(plan, coreScores);
  const strengths = filterNarrative(input.narrative.strengths, answeredIds);
  const improvements = filterNarrative(input.narrative.improvements, answeredIds);

  return {
    version: INTERVIEW_REPORT_VERSION,
    generatedAt: (input.now ?? new Date()).toISOString(),
    candidate: input.candidate,
    milestone: {
      blueprint,
      label: BLUEPRINT_LABEL[blueprint],
      scopeFrom: Math.min(...scopeDays),
      scopeTo: Math.max(...scopeDays),
      progressDay: input.progressDay,
      bankVersion: input.bankVersion,
    },
    overall: {
      score: overallScore,
      tier: scoreToTier(overallScore),
      durationSec: input.durationSec,
      questionsAsked: coreQuestions.length,
      questionsAnswered: answered.length,
      followUpsAsked: state.followUpsAsked,
      escalationsEarned,
      redirectsIssued: state.redirectsAsked ?? 0,
    },
    modules,
    competencies,
    // A model that produced nothing usable must not leave the report empty.
    strengths: strengths.length > 0 ? strengths : fallback.strengths,
    improvements: improvements.length > 0 ? improvements : fallback.improvements,
    skills: {
      demonstrated: [...new Set(demonstrated)],
      partial,
      notShown: notShownOnly,
    },
    beyondMilestone,
    evidence,
    summary: input.narrative.summary,
    recommendation: input.narrative.recommendation,
    narrativeDegraded:
      input.narrative.degraded ||
      strengths.length === 0 ||
      improvements.length === 0,
  };
}

/**
 * Validates a report document before it is written or after it is read.
 *
 * Both directions on purpose: the write side stops a malformed document ever
 * reaching the column, and the read side stops an old row rendering half a page
 * after the shape changes.
 */
export function parseReport(
  value: unknown,
): { ok: true; data: InterviewReportDocument } | { ok: false; message: string } {
  const parsed = interviewReportSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }
  return { ok: true, data: parsed.data as InterviewReportDocument };
}
