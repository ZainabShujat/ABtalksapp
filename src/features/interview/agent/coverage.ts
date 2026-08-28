import type {
  AnswerEvidence,
  Competency,
  InterviewPlan,
  InterviewState,
  PlannedQuestion,
} from "@/features/interview/types";

/**
 * What the interview already knows, and what it still does not.
 *
 * The depth ladder in `depth.ts` answers "how did THIS answer go". This answers
 * the different question the conversation planner needs: across everything said
 * so far, which competencies are covered well enough to leave alone, and which
 * are still dark. Without it the interview has no way to prefer an unexplored
 * area over one it has already established.
 *
 * Entirely derived. Nothing here is stored: coverage is recomputed from the
 * evidence already persisted on the state, so an attempt resumed from the
 * database yields exactly the same coverage it had before, and there is no new
 * field that can drift out of sync with the evidence it summarises.
 *
 * Pure and deterministic — no model, no database.
 */

export type CoverageLevel =
  | "NOT_ASSESSED"
  | "PARTIAL"
  | "SUFFICIENT"
  | "STRONG";

export type CompetencyCoverage = {
  competency: Competency;
  level: CoverageLevel;
  /** Core questions answered for this competency. */
  answered: number;
  /** Answers that cleared their own question's bar. */
  cleared: number;
};

/** Coverage for one answered question, judged against its own checklist. */
function levelForAnswer(
  question: PlannedQuestion,
  evidence: AnswerEvidence | undefined,
): CoverageLevel {
  if (!evidence) return "NOT_ASSESSED";

  const bar = question.minEvidence ?? 1;
  const expected = question.expectedEvidence?.length ?? 0;
  const matched = evidence.matchedEvidence?.length;

  // `undefined` means nothing judged this answer (a degraded turn), which is
  // not the same claim as "found nothing". Fall back to the evidence axes
  // rather than recording a gap the candidate did not actually leave.
  if (matched === undefined || expected === 0) {
    const axes =
      Number(evidence.conceptualFound) +
      Number(evidence.practicalFound) +
      Number(evidence.tradeoffsFound);
    if (axes >= 3) return "STRONG";
    if (axes === 2) return "SUFFICIENT";
    return axes === 1 ? "PARTIAL" : "NOT_ASSESSED";
  }

  if (matched >= expected && expected > 0) return "STRONG";
  if (matched >= bar) return "SUFFICIENT";
  return matched > 0 ? "PARTIAL" : "NOT_ASSESSED";
}

/**
 * Coverage for one question id, reading rung evidence as well as core evidence.
 *
 * An escalated turn files its evidence under `${id}@L2`. A candidate who
 * cleared the core question and then a level-2 rung is better covered than one
 * who only cleared the core, so the rungs count.
 */
export function coverageForQuestion(
  question: PlannedQuestion,
  state: InterviewState,
): CoverageLevel {
  const core = levelForAnswer(question, state.evidenceByQuestionId[question.id]);

  const rungKeys = Object.keys(state.evidenceByQuestionId).filter((key) =>
    key.startsWith(`${question.id}@L`),
  );
  if (rungKeys.length === 0) return core;

  // Clearing a deeper rung is strictly more evidence than clearing the core.
  const clearedRung = rungKeys.some((key) => {
    const ev = state.evidenceByQuestionId[key];
    return (ev?.matchedEvidence?.length ?? 0) > 0;
  });

  if (core === "NOT_ASSESSED") return clearedRung ? "PARTIAL" : core;
  if (clearedRung && core === "SUFFICIENT") return "STRONG";
  return core;
}

const RANK: Record<CoverageLevel, number> = {
  NOT_ASSESSED: 0,
  PARTIAL: 1,
  SUFFICIENT: 2,
  STRONG: 3,
};

/**
 * Coverage per competency across the whole interview so far.
 *
 * A competency is as covered as its BEST answer, not its average: one strong
 * demonstration of problem-solving establishes problem-solving, and a later
 * weak answer elsewhere does not un-demonstrate it. This is what lets a single
 * good conversational thread satisfy several targets at once, which the
 * alternative — one question per category, ticked off — cannot do.
 */
export function competencyCoverage(
  plan: InterviewPlan,
  state: InterviewState,
): Map<Competency, CompetencyCoverage> {
  const out = new Map<Competency, CompetencyCoverage>();

  for (const question of plan.questions) {
    const level = coverageForQuestion(question, state);
    const prior = out.get(question.competency) ?? {
      competency: question.competency,
      level: "NOT_ASSESSED" as CoverageLevel,
      answered: 0,
      cleared: 0,
    };

    const answered = prior.answered + (level === "NOT_ASSESSED" ? 0 : 1);
    const cleared = prior.cleared + (RANK[level] >= RANK.SUFFICIENT ? 1 : 0);

    out.set(question.competency, {
      competency: question.competency,
      level: RANK[level] > RANK[prior.level] ? level : prior.level,
      answered,
      cleared,
    });
  }

  return out;
}

/**
 * How much asking about this competency is still worth, 0..1.
 *
 * Highest for something never assessed, lowest for something already strong.
 * PARTIAL sits deliberately close to NOT_ASSESSED: a half-answered competency
 * is the most informative thing left to ask about, because one more question
 * resolves it either way. That is what makes revisiting a weak area attractive
 * to the planner rather than merely permitted.
 */
export function coverageNeed(level: CoverageLevel): number {
  switch (level) {
    case "NOT_ASSESSED":
      return 1;
    case "PARTIAL":
      return 0.85;
    case "SUFFICIENT":
      return 0.25;
    case "STRONG":
      return 0;
  }
}
