import {
  MODULES,
  moduleForDay,
  type CurriculumModuleInfo,
} from "@/features/interview/cohort/curriculum";
import { DEEP_PROBE_MIN_EVIDENCE } from "@/features/interview/constants";
import type {
  AnswerEvidence,
  InterviewPlan,
  InterviewState,
  PlannedQuestion,
} from "@/features/interview/types";

/**
 * Evidence → numbers. The whole scoring path, as pure arithmetic.
 *
 * No model is consulted anywhere in this file. A score is a function of which
 * expected-evidence items a candidate actually covered, and nothing else — so
 * two candidates whose answers contain the same evidence always receive the
 * same score, and any score can be explained by pointing at a checklist.
 *
 * SCOPE IS ENFORCED HERE, not assumed: only CORE questions contribute, and a
 * CORE question can only reference days inside its blueprint (guaranteed by the
 * bank's load-time assertion and re-checked by the planner). A DAY_15 report
 * therefore cannot contain a Day 16+ judgment even if an extension question was
 * asked in the same session.
 */

/* -------------------------------------------------------- per-question */

/** Score bands. Used for the tier label shown beside a number. */
export function scoreToTier(
  score: number,
): "NONE" | "CLAIMED" | "EXPLAINED" | "DEMONSTRATED" {
  if (score >= 85) return "DEMONSTRATED";
  if (score >= 60) return "EXPLAINED";
  if (score >= 30) return "CLAIMED";
  return "NONE";
}

export type QuestionScore = {
  questionId: string;
  competency: PlannedQuestion["competency"];
  /** Modules this question draws on. Usually one. */
  moduleNumbers: number[];
  sourceDays: number[];
  score: number;
  matched: number;
  expected: number;
  minEvidence: number;
  cleared: boolean;
  /** Deepest rung the candidate was taken to on this question. */
  depthReached: number;
  /** Escalation rungs they also cleared. */
  rungsCleared: number;
  /** Answered at all — an unreached question is not a zero. */
  answered: boolean;
};

/**
 * Credit for clearing the bar, then credit for going beyond it.
 *
 * Clearing `minEvidence` is worth 70 — the bank defines that as a sufficient
 * answer, so it must score as one. The remaining 30 is earned by covering the
 * rest of the checklist. Below the bar, the score is proportional to how close
 * they got, so a near-miss and a blank are not the same result.
 *
 * Escalation rungs add a small, capped bonus. They are deliberately worth
 * little: a candidate who answers the standard question completely has met the
 * standard, and depth is a distinguisher between strong candidates rather than
 * a tax on everyone else.
 */
const CLEARED_BASE = 70;
const DEPTH_BONUS_PER_RUNG = 5;

export function scoreQuestion(
  question: PlannedQuestion,
  state: InterviewState,
): QuestionScore {
  const expected = question.expectedEvidence?.length ?? 0;
  const minEvidence = Math.max(1, question.minEvidence ?? 1);

  const core = state.evidenceByQuestionId[question.id];
  const matched = core?.matchedEvidence?.length ?? 0;

  // Rung answers are filed under `${id}@L{n}` so the two checklists never mix.
  const rungs = (question.deepProbes ?? []).map((probe) => {
    const rungEvidence = state.evidenceByQuestionId[`${question.id}@L${probe.level}`];
    const rungMatched = rungEvidence?.matchedEvidence?.length ?? 0;
    const bar = Math.min(DEEP_PROBE_MIN_EVIDENCE, probe.expectedEvidence.length);
    return {
      level: probe.level,
      answered: rungEvidence !== undefined,
      cleared: rungEvidence !== undefined && rungMatched >= bar,
    };
  });

  const answeredRungs = rungs.filter((r) => r.answered);
  const rungsCleared = rungs.filter((r) => r.cleared).length;
  const depthReached =
    answeredRungs.length > 0
      ? Math.max(...answeredRungs.map((r) => r.level))
      : 1;

  const answered = core !== undefined;
  if (!answered || expected === 0) {
    return {
      questionId: question.id,
      competency: question.competency,
      moduleNumbers: modulesFor(question).map((m) => m.number),
      sourceDays: question.sourceRef.sourceDays ?? [],
      score: 0,
      matched: 0,
      expected,
      minEvidence,
      cleared: false,
      depthReached,
      rungsCleared,
      answered,
    };
  }

  const cleared = matched >= minEvidence;

  let score: number;
  if (cleared) {
    const beyond = expected > minEvidence
      ? (matched - minEvidence) / (expected - minEvidence)
      : 1;
    score = CLEARED_BASE + (100 - CLEARED_BASE) * beyond;
  } else {
    score = CLEARED_BASE * (matched / minEvidence);
  }

  score = Math.min(100, score + rungsCleared * DEPTH_BONUS_PER_RUNG);

  return {
    questionId: question.id,
    competency: question.competency,
    moduleNumbers: modulesFor(question).map((m) => m.number),
    sourceDays: question.sourceRef.sourceDays ?? [],
    score: Math.round(score),
    matched,
    expected,
    minEvidence,
    cleared,
    depthReached,
    rungsCleared,
    answered,
  };
}

function modulesFor(question: PlannedQuestion): CurriculumModuleInfo[] {
  const numbers = new Set<number>();
  const out: CurriculumModuleInfo[] = [];
  for (const day of question.sourceRef.sourceDays ?? []) {
    const mod = moduleForDay(day);
    if (mod && !numbers.has(mod.number)) {
      numbers.add(mod.number);
      out.push(mod);
    }
  }
  return out;
}

/* ------------------------------------------------------------- modules */

export type ModuleAssessment = {
  moduleNumber: number;
  title: string;
  subtitle: string;
  dayRange: { from: number; to: number };
  /** Null means NOT ASSESSED — never rendered as a zero. */
  score: number | null;
  tier: ReturnType<typeof scoreToTier> | null;
  questionsAsked: number;
  questionsAnswered: number;
  /** Question ids behind this number. The module score's audit trail. */
  evidenceRefs: string[];
  note: string;
};

/**
 * Module scores for the blueprint's scope.
 *
 * A module the instrument never covered reports `null`, not 0. This matters
 * more than it looks: a DAY_15 interview asks nothing about Kubernetes, and a
 * report showing "Module 8: 0" would read as a failure the candidate never had
 * the chance to avoid.
 */
export function scoreModules(
  plan: InterviewPlan,
  state: InterviewState,
  scopeDays: number[],
): ModuleAssessment[] {
  const inScope = new Set(scopeDays);

  // CORE only. Extension questions are about days beyond the milestone and must
  // never move a milestone module score.
  const coreScores = plan.questions
    .filter((q) => (q.tier ?? "CORE") === "CORE")
    .map((q) => scoreQuestion(q, state));

  const modulesTouchedByScope = MODULES.filter((m) => {
    for (let day = m.startDay; day <= m.endDay; day += 1) {
      if (inScope.has(day)) return true;
    }
    return false;
  });

  return modulesTouchedByScope.map((mod) => {
    const forModule = coreScores.filter((s) => s.moduleNumbers.includes(mod.number));
    const answered = forModule.filter((s) => s.answered);

    if (forModule.length === 0 || answered.length === 0) {
      return {
        moduleNumber: mod.number,
        title: mod.title,
        subtitle: mod.subtitle,
        dayRange: { from: mod.startDay, to: mod.endDay },
        score: null,
        tier: null,
        questionsAsked: forModule.length,
        questionsAnswered: 0,
        evidenceRefs: [],
        note:
          forModule.length === 0
            ? "Not assessed — this milestone asks no question drawn from this module."
            : "Not assessed — the questions from this module were not reached.",
      };
    }

    const mean =
      answered.reduce((sum, s) => sum + s.score, 0) / answered.length;
    const score = Math.round(mean);

    return {
      moduleNumber: mod.number,
      title: mod.title,
      subtitle: mod.subtitle,
      dayRange: { from: mod.startDay, to: mod.endDay },
      score,
      tier: scoreToTier(score),
      questionsAsked: forModule.length,
      questionsAnswered: answered.length,
      evidenceRefs: answered.map((s) => s.questionId),
      note: `${answered.length} of ${forModule.length} question${
        forModule.length === 1 ? "" : "s"
      } answered.`,
    };
  });
}

/**
 * Guard: no CORE question may reference a day outside the blueprint's scope.
 *
 * The bank asserts this at load and the planner re-checks at selection. This is
 * the third check, at the moment a NUMBER is produced from it, because a scope
 * leak that reached a report would be an incorrect result shown to a candidate
 * rather than a crash a developer sees.
 */
export function assertScopeIntegrity(
  plan: InterviewPlan,
  scopeDays: number[],
): void {
  const inScope = new Set(scopeDays);
  for (const question of plan.questions) {
    if ((question.tier ?? "CORE") !== "CORE") continue;
    for (const day of question.sourceRef.sourceDays ?? []) {
      if (!inScope.has(day)) {
        throw new Error(
          `[module-scoring] CORE question ${question.id} references day ${day}, ` +
            `outside the assessed scope (${Math.min(...scopeDays)}..${Math.max(
              ...scopeDays,
            )}).`,
        );
      }
    }
  }
}

/** Evidence recorded for a question, if any. Convenience for the report. */
export function evidenceFor(
  question: PlannedQuestion,
  state: InterviewState,
): AnswerEvidence | undefined {
  return state.evidenceByQuestionId[question.id];
}
