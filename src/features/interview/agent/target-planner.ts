import {
  conceptTokensForDays,
  topicalOverlap,
} from "@/features/interview/cohort/concepts";
import {
  competencyCoverage,
  coverageForQuestion,
  coverageNeed,
} from "@/features/interview/agent/coverage";
import {
  CONTINUITY_WEIGHT,
  COVERAGE_WEIGHT,
  REORDER_MARGIN,
} from "@/features/interview/constants";
import type {
  InterviewPlan,
  InterviewState,
  PlannedQuestion,
} from "@/features/interview/types";

/**
 * Chooses the next ASSESSMENT TARGET, replacing `currentQuestionIndex + 1`.
 *
 * THE CHANGE THIS MAKES. The interview used to walk the plan in array order, so
 * the question after "how would you design a retrieval pipeline" was whatever
 * the author happened to write next, no matter what the candidate had just
 * said. Nothing in the conversation could reach the choice. This function is
 * the seam where the candidate's answer finally does.
 *
 * It scores every target the interview has NOT yet asked, on two axes:
 *
 *   CONTINUITY  how close the target is to what the candidate just talked
 *               about, measured against the curriculum's own vocabulary
 *               (`concepts.ts`). A candidate who volunteers chunking should be
 *               asked about chunking, because that is what a person would do.
 *
 *   COVERAGE    how much the competency is still worth asking about
 *               (`coverage.ts`). Something never assessed outranks something
 *               already established, so the interview spends its remaining
 *               turns where the signal is missing.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It cannot invent a question, widen the
 * scope, or reach outside `plan.questions` — the plan is already scoped to the
 * blueprint's days, so every reachable target is inside the candidate's
 * curriculum by construction. The authored text, expected evidence and rubric
 * are untouched; only the ORDER of assessment changes. That keeps two
 * candidates comparable on what was asked while letting the route differ.
 *
 * AUTHORED ORDER IS THE DEFAULT, not a fallback. Reordering happens only when a
 * rival target beats the next authored one by `REORDER_MARGIN`. With no signal
 * — an empty answer, a degraded turn, a candidate who said nothing specific —
 * the interview proceeds exactly as authored. An interview that reshuffles
 * itself on noise feels more erratic than one that simply carries on.
 *
 * Pure and deterministic: same state and same answer always select the same
 * target, which is what makes the behaviour testable without a model and
 * reproducible when an attempt is replayed.
 */

export type TargetChoice = {
  /** The question to ask next, or null when nothing is left to assess. */
  questionId: string | null;
  /** Index of that question in the plan, kept so persisted state stays valid. */
  index: number;
  /** Why this target won. Recorded on the turn for the audit trail. */
  reason: string;
  /** Scores for every considered candidate, highest first. Diagnostics only. */
  considered: {
    questionId: string;
    score: number;
    continuity: number;
    need: number;
  }[];
};

/**
 * Questions already put to the candidate.
 *
 * Backfills for attempts persisted before the planner existed: those advanced
 * strictly forward, so everything up to and including the current index had
 * been asked. Without this an in-flight interview would forget its history on
 * deploy and start re-asking its opening questions.
 */
export function askedIds(
  plan: InterviewPlan,
  state: InterviewState,
): string[] {
  // EMPTY counts as absent, not as "nothing has been asked". A state carrying
  // an advanced index with an empty list is either a pre-planner attempt read
  // back from the database or a state built directly at an index; treating it
  // literally would put every earlier question back in the pool and the
  // interview would never terminate.
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
 * A question the candidate has already answered is never re-selected: the
 * conversation revisits a weak AREA by choosing a different target that shares
 * its competency, not by asking the same words twice. Repeating a question
 * verbatim reads as the interviewer having lost track.
 */
function remainingTargets(
  plan: InterviewPlan,
  state: InterviewState,
): PlannedQuestion[] {
  const asked = new Set(askedIds(plan, state));
  return plan.questions.filter((q) => !asked.has(q.id));
}

/**
 * Selects the next target.
 *
 * `lastAnswerText` is the candidate's most recent answer. Empty is a valid and
 * common input (a skipped question, a stuck candidate); it simply means the
 * continuity axis contributes nothing and authored order governs.
 */
export function selectNextTarget(
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
      considered: [],
    };
  }

  const coverage = competencyCoverage(plan, state);

  const scored = remaining.map((question) => {
    const tokens = conceptTokensForDays(question.sourceRef?.sourceDays ?? []);
    const continuity = topicalOverlap(lastAnswerText, tokens);

    // The competency's standing coverage, softened by whether this specific
    // question was already answered — which it has not been, since it is a
    // remaining target, but a rung of it may have been.
    const own = coverageForQuestion(question, state);
    const competencyLevel =
      coverage.get(question.competency)?.level ?? "NOT_ASSESSED";
    const need = Math.min(coverageNeed(competencyLevel), coverageNeed(own));

    return {
      question,
      continuity,
      need,
      score: CONTINUITY_WEIGHT * continuity + COVERAGE_WEIGHT * need,
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
        ? `Follows what the candidate raised (continuity ${winner.continuity.toFixed(2)}), and ${winner.question.competency} is still open.`
        : `${winner.question.competency} is the least-assessed competency left (need ${winner.need.toFixed(2)}).`;

  return {
    questionId: winner.question.id,
    index: plan.questions.findIndex((q) => q.id === winner.question.id),
    reason,
    considered: scored
      .map((s) => ({
        questionId: s.question.id,
        score: s.score,
        continuity: s.continuity,
        need: s.need,
      }))
      .sort((a, b) => b.score - a.score),
  };
}
