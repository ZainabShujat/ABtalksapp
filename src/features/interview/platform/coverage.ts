import type {
  AnswerEvidence,
  InterviewPlan,
  InterviewState,
  PlannedQuestion,
} from "@/features/interview/types";

/**
 * What the interview already knows, and what it still does not.
 *
 * `depth.ts` answers "how did THIS answer go". This answers the different
 * question the planner needs: across everything said so far, which parts of the
 * rubric are established well enough to leave alone, and which are still dark.
 * Without it the interview has no way to prefer an unexplored area over one it
 * has already covered.
 *
 * ENTIRELY DERIVED. Nothing here is stored: coverage is recomputed from the
 * evidence already on the state, so an attempt read back from the database
 * yields exactly the coverage it had, and there is no new field that can drift
 * out of sync with the evidence it summarises.
 *
 * Keyed by `platformCompetencyId` — the DOMAIN RUBRIC — not by the engine's
 * five-value `competency`. Grouping by the engine field would make the planner
 * chase the cohort's competency names in an interview that does not use them.
 *
 * Pure and deterministic — no model, no database.
 */

export type CoverageLevel =
  | "NOT_ASSESSED"
  | "PARTIAL"
  | "SUFFICIENT"
  | "STRONG";

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
 * Coverage for one question, reading rung evidence as well as core evidence.
 *
 * An escalated turn files under `${id}@L2`. Someone who cleared the core
 * question and then a deeper rung is better covered than someone who only
 * cleared the core, so the rungs count.
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

  const clearedRung = rungKeys.some(
    (key) => (state.evidenceByQuestionId[key]?.matchedEvidence?.length ?? 0) > 0,
  );

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

export type CompetencyCoverage = {
  competencyId: string;
  level: CoverageLevel;
  answered: number;
  cleared: number;
};

/**
 * Coverage per RUBRIC COMPETENCY across the interview so far.
 *
 * A competency is as covered as its BEST answer, not its average: one strong
 * demonstration establishes it, and a weaker answer elsewhere does not
 * un-demonstrate it. That is what lets a single good conversational thread
 * satisfy several targets at once, which "one question per box, ticked off"
 * cannot do.
 */
export function competencyCoverage(
  plan: InterviewPlan,
  state: InterviewState,
): Map<string, CompetencyCoverage> {
  const out = new Map<string, CompetencyCoverage>();

  for (const question of plan.questions) {
    const id = question.platformCompetencyId;
    if (!id) continue;

    const level = coverageForQuestion(question, state);
    const prior = out.get(id) ?? {
      competencyId: id,
      level: "NOT_ASSESSED" as CoverageLevel,
      answered: 0,
      cleared: 0,
    };

    out.set(id, {
      competencyId: id,
      level: RANK[level] > RANK[prior.level] ? level : prior.level,
      answered: prior.answered + (level === "NOT_ASSESSED" ? 0 : 1),
      cleared: prior.cleared + (RANK[level] >= RANK.SUFFICIENT ? 1 : 0),
    });
  }

  return out;
}

/**
 * How much asking about this is still worth, 0..1.
 *
 * Highest for something never assessed, lowest for something already strong.
 * PARTIAL sits deliberately close to NOT_ASSESSED: a half-answered area is the
 * most informative thing left to ask about, because one more question resolves
 * it either way. That is what makes revisiting a shaky area attractive to the
 * planner rather than merely permitted — and it is the mechanism behind
 * requirement 12, "do not re-ask what they have already shown you".
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
