import {
  conceptsRaised,
  conceptTokensForQuestion,
  topicalOverlap,
} from "@/features/interview/platform/concepts";
import {
  competencyCoverage,
  coverageForQuestion,
  coverageNeed,
} from "@/features/interview/platform/coverage";
import type {
  InterviewPlan,
  InterviewState,
  PlannedQuestion,
} from "@/features/interview/types";

/**
 * Chooses the next ASSESSMENT TARGET for a platform interview, replacing
 * `currentQuestionIndex + 1`.
 *
 * THE CHANGE THIS MAKES. The interview used to walk the pack in array order, so
 * the question after "tell me what you built with these tools" was whatever the
 * author happened to write next, however the candidate had answered. Nothing in
 * the conversation could reach the choice. This is the seam where it finally
 * does.
 *
 * Every target is scored on three axes:
 *
 *   CONTINUITY  how close the target sits to what the candidate just said,
 *               measured against the pack's own vocabulary (`concepts.ts`).
 *               Someone who volunteers chunking should be asked about chunking,
 *               because that is what a person would do.
 *
 *   COVERAGE    how much the rubric competency is still worth asking about
 *               (`coverage.ts`). Something never assessed outranks something
 *               already established, so the remaining turns are spent where the
 *               signal is missing rather than where it is already in hand.
 *
 *   DIFFICULTY  whether the target is pitched where this candidate currently
 *               is. Someone answering strongly is steered toward harder
 *               questions; someone struggling is steered toward easier ones.
 *
 * WHAT IT DELIBERATELY CANNOT DO. It cannot invent a question, widen the scope
 * or reach outside `plan.questions` — and `plan.questions` came from a pinned,
 * authored pack. Every reachable target is inside the curriculum by
 * construction. The authored text, expected evidence and rubric are untouched;
 * only the ORDER of assessment changes, which keeps two candidates comparable
 * on WHAT was asked while letting the route differ.
 *
 * AUTHORED ORDER IS THE DEFAULT, not a fallback. A rival target has to beat the
 * next authored one by `REORDER_MARGIN` to displace it. With no signal — an
 * empty answer, a degraded turn, someone who said nothing specific — the
 * interview proceeds exactly as authored. An interview that reshuffles itself
 * on noise feels more erratic than one that simply carries on.
 *
 * Pure and deterministic: the same state and the same answer always select the
 * same target, so behaviour is testable without a model and reproducible when
 * an attempt is replayed.
 */

/** How much a topical match is worth relative to an unmet coverage need. */
const CONTINUITY_WEIGHT = 1;
const COVERAGE_WEIGHT = 0.6;
/** How much pitching at the right difficulty is worth. Deliberately small. */
const DIFFICULTY_WEIGHT = 0.25;
/**
 * How much better a challenger must be before it displaces authored order.
 *
 * The single most important number here. Too low and the interview hops on
 * scoring noise; too high and it never adapts at all.
 */
const REORDER_MARGIN = 0.15;

export type TargetChoice = {
  /** The question to ask next, or null when nothing is left to assess. */
  questionId: string | null;
  /** Index of that question in the plan, so persisted state stays valid. */
  index: number;
  /** Why this target won. Recorded for the audit trail. */
  reason: string;
  /** Curriculum concepts the answer raised. Diagnostics. */
  raised: string[];
  /** Scores for every candidate considered, highest first. Diagnostics. */
  considered: {
    questionId: string;
    score: number;
    continuity: number;
    need: number;
    fit: number;
  }[];
};

/**
 * Questions already put to the candidate.
 *
 * Backfills for states persisted before the planner existed: those advanced
 * strictly forward, so everything up to and including the current index had
 * been asked. Without this an in-flight interview would forget its history on
 * deploy and start re-asking its opening questions.
 *
 * EMPTY counts as absent, not as "nothing has been asked" — a state carrying an
 * advanced index with an empty list is a pre-planner attempt read back from the
 * database, and taking it literally would put every earlier question back in
 * the pool and the interview would never terminate.
 */
export function askedIds(plan: InterviewPlan, state: InterviewState): string[] {
  if (state.askedQuestionIds && state.askedQuestionIds.length > 0) {
    return state.askedQuestionIds;
  }
  return plan.questions
    .slice(0, state.currentQuestionIndex + 1)
    .map((q) => q.id);
}

/**
 * Everything not yet asked.
 *
 * A question already put is never re-selected. The conversation revisits a weak
 * AREA by choosing a different target that shares its competency, not by asking
 * the same words twice — repeating a question verbatim reads as the interviewer
 * having lost track.
 */
function remainingTargets(
  plan: InterviewPlan,
  state: InterviewState,
): PlannedQuestion[] {
  const asked = new Set(askedIds(plan, state));
  return plan.questions.filter((q) => !asked.has(q.id));
}

/**
 * How well a target's difficulty matches how the candidate is doing.
 *
 * Reads the calibration set by `depth.ts` from the opening answers. Returns
 * 0..1, and deliberately never returns 0 for a mismatch: difficulty is a
 * preference, not a gate, and a candidate should still meet the whole
 * curriculum rather than being locked into one band.
 */
function difficultyFit(
  question: PlannedQuestion,
  level: "FOUNDATIONS" | "WORKING" | "ADVANCED" | null | undefined,
): number {
  const d = question.difficulty;
  if (!level) return d === "medium" ? 1 : 0.6;
  if (level === "ADVANCED") return d === "hard" ? 1 : d === "medium" ? 0.7 : 0.3;
  if (level === "FOUNDATIONS") return d === "easy" ? 1 : d === "medium" ? 0.7 : 0.3;
  return d === "medium" ? 1 : 0.7;
}

/**
 * Selects the next target.
 *
 * `lastAnswerText` is the candidate's most recent answer. Empty is valid and
 * common (a skipped question, a stuck candidate); it simply means the
 * continuity axis contributes nothing and authored order governs.
 */
export function selectNextPlatformTarget(
  plan: InterviewPlan,
  state: InterviewState,
  lastAnswerText: string = "",
): TargetChoice {
  const remaining = remainingTargets(plan, state);

  if (remaining.length === 0) {
    return {
      questionId: null,
      index: plan.questions.length,
      reason: "Every target has been assessed.",
      raised: [],
      considered: [],
    };
  }

  const coverage = competencyCoverage(plan, state);
  const level = state.calibration?.level ?? null;

  const scored = remaining.map((question) => {
    const continuity = topicalOverlap(
      lastAnswerText,
      conceptTokensForQuestion(question),
    );

    // The competency's standing coverage, softened by this specific question's
    // own coverage — it has not been answered, since it is a remaining target,
    // but a rung of it may have been.
    const own = coverageForQuestion(question, state);
    const competencyLevel =
      (question.platformCompetencyId
        ? coverage.get(question.platformCompetencyId)?.level
        : undefined) ?? "NOT_ASSESSED";
    const need = Math.min(coverageNeed(competencyLevel), coverageNeed(own));

    const fit = difficultyFit(question, level);

    return {
      question,
      continuity,
      need,
      fit,
      score:
        CONTINUITY_WEIGHT * continuity +
        COVERAGE_WEIGHT * need +
        DIFFICULTY_WEIGHT * fit,
    };
  });

  // Authored order is the incumbent: the earliest remaining target.
  const incumbent = scored.reduce((best, candidate) =>
    candidate.question.order < best.question.order ? candidate : best,
  );

  // The challenger has to be clearly better, not merely better.
  const challenger = scored.reduce((best, candidate) => {
    if (candidate.score !== best.score) {
      return candidate.score > best.score ? candidate : best;
    }
    // Ties go to authored order, so scoring noise cannot shuffle the interview.
    return candidate.question.order < best.question.order ? candidate : best;
  });

  const winner =
    challenger.question.id !== incumbent.question.id &&
    challenger.score - incumbent.score >= REORDER_MARGIN
      ? challenger
      : incumbent;

  const reason =
    winner.question.id === incumbent.question.id
      ? `Authored order; nothing outscored it by ${REORDER_MARGIN}.`
      : winner.continuity > 0
        ? `Follows what the candidate raised (continuity ${winner.continuity.toFixed(2)}).`
        : `Least-covered area left (need ${winner.need.toFixed(2)}).`;

  return {
    questionId: winner.question.id,
    index: plan.questions.findIndex((q) => q.id === winner.question.id),
    reason,
    raised: conceptsRaised(lastAnswerText, plan),
    considered: scored
      .map((s) => ({
        questionId: s.question.id,
        score: s.score,
        continuity: s.continuity,
        need: s.need,
        fit: s.fit,
      }))
      .sort((a, b) => b.score - a.score),
  };
}
