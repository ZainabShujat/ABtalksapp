import {
  BLUEPRINT_SCOPE,
  maxScopeDay,
  type InterviewBlueprintKey,
} from "@/features/interview/cohort/blueprint";
import {
  getQuestionBank,
  type CoreQuestion,
} from "@/features/interview/cohort/question-bank";
import {
  groundQuestion,
  type GroundingFacts,
} from "@/features/interview/cohort/grounding";
import { MAX_EXTENSION_QUESTIONS } from "@/features/interview/constants";
import { buildRubricSnapshot } from "@/features/interview/rubric";
import type {
  InterviewPlan,
  PlannedQuestion,
  QuestionTier,
} from "@/features/interview/types";
import type { CohortCandidateContext } from "@/features/interview/cohort/candidate-context";

/**
 * Turns a blueprint into a frozen interview plan.
 *
 * This replaces `question-rules.ts` for V1. That module stays on disk for the
 * future general interview — it picks competency slots and fills them from a
 * candidate's own 60-day challenge submissions, which is exactly what a
 * standardized cohort interview must NOT do.
 *
 * Everything here is deterministic and LLM-free:
 *   - WHICH questions are asked comes from the fixed bank, in bank order
 *   - the wording is used verbatim; nothing is rephrased
 *   - the same blueprint always produces the identical plan
 *
 * The only inputs are the blueprint and the bank. Notably NOT inputs: the
 * member, their scores, their submissions, anything the client sends. Two
 * candidates at the same milestone get byte-identical question sets, which is
 * the whole basis for comparing their results.
 */

/**
 * Scope guard, re-run at selection time.
 *
 * The bank already asserts this at module load. Repeating it here is deliberate
 * defence in depth for the one invariant whose failure would silently
 * invalidate every DAY_15 result: a checkpoint interview asking about
 * curriculum the candidate has not reached yet.
 */
function assertWithinScope(
  blueprint: InterviewBlueprintKey,
  question: CoreQuestion,
): void {
  const scope = new Set(BLUEPRINT_SCOPE[blueprint]);
  for (const day of question.sourceDays) {
    if (!scope.has(day)) {
      throw new Error(
        `[cohort planner] ${blueprint} cannot ask ${question.id}: it draws on ` +
          `cohort day ${day}, outside 1..${maxScopeDay(blueprint)}.`,
      );
    }
  }
}

function toPlannedQuestion(
  question: CoreQuestion,
  index: number,
  tier: QuestionTier,
  facts: GroundingFacts | null,
): PlannedQuestion {
  // Grounding is applied ONCE, at plan time, and frozen into the plan. Doing it
  // per turn would let the spoken question drift mid-interview if a submission
  // landed while the candidate was talking.
  const grounded = facts
    ? groundQuestion(question.text, question.groundsOn, facts)
    : { spoken: question.text, grounded: false, groundingNote: null };

  return {
    id: question.id,
    order: index + 1,
    competency: question.competency,
    sourceRef: {
      source: "COHORT_CURRICULUM",
      sourceDays: question.sourceDays,
      label: question.sourceLabel,
    },
    text: question.text,
    spokenText: grounded.spoken,
    grounded: grounded.grounded,
    groundingNote: grounded.groundingNote,
    tier,
    // Never true for a cohort question. Standardized wording is the point.
    llmPhrased: false,
    difficulty: question.difficulty,
    mode: question.mode,
    deepProbes: question.deepProbes,
    scaffoldProbes: question.scaffoldProbes,
    bankQuestionId: question.id,
    expectedEvidence: question.expectedEvidence,
    minEvidence: question.minEvidence,
    maxFollowUps: question.maxFollowUps,
    followUpPrompt: question.followUpPrompt,
  };
}

/**
 * Questions about cohort days the member has passed BEYOND this milestone.
 *
 * The case this exists for: a member reaches Day 15, the interview unlocks, and
 * they actually sit it on Day 18. The assessment must still be a DAY_15
 * assessment — that is what makes their score comparable with everyone else's —
 * but an interviewer that pretends not to know they have since finished Days 16
 * to 18 is obviously not paying attention.
 *
 * So the milestone stays bounded and these are appended as EXTENSION questions:
 * asked, judged, reported separately, and excluded from the overall score.
 *
 * Selection is deterministic — bank order, filtered to questions whose EVERY
 * source day the member has actually passed. A question is never asked about a
 * day they have not completed, which is the same rule the blueprint itself
 * obeys.
 */
function selectExtensionQuestions(
  blueprint: InterviewBlueprintKey,
  beyondScopePassedDays: number[],
): CoreQuestion[] {
  if (beyondScopePassedDays.length === 0) return [];

  const available = new Set(beyondScopePassedDays);
  // Extension material comes from the LATER bank, which is where the
  // beyond-scope days are covered. DAY_31 has no later bank, so it never
  // produces extensions — correct, since nothing lies beyond day 31.
  if (blueprint !== "DAY_15") return [];

  return getQuestionBank("DAY_31")
    .questions.filter((q) => q.sourceDays.every((day) => available.has(day)))
    .slice(0, MAX_EXTENSION_QUESTIONS);
}

/**
 * Builds the plan frozen into `GeneralInterview.plan` at open.
 *
 * The rubric snapshot travels with it so a historical score stays interpretable
 * if competency weights are ever changed.
 */
export function planCohortInterview(
  blueprint: InterviewBlueprintKey,
  context?: CohortCandidateContext | null,
): InterviewPlan {
  const bank = getQuestionBank(blueprint);
  const facts = context ?? null;

  const core = bank.questions.map((question, index) => {
    assertWithinScope(blueprint, question);
    return toPlannedQuestion(question, index, "CORE", facts);
  });

  // Extensions require a candidate context: without one we cannot know which
  // days they have passed, and guessing would ask about unfinished work.
  const extensions = context
    ? selectExtensionQuestions(blueprint, context.beyondScopePassedDays).map(
        (question, offset) =>
          toPlannedQuestion(
            question,
            core.length + offset,
            "EXTENSION",
            facts,
          ),
      )
    : [];

  const questions = [...core, ...extensions];

  return {
    questions,
    rubricSnapshot: buildRubricSnapshot(),
    contextSummary: {
      kind: "COHORT",
      blueprint,
      bankVersion: bank.version,
      scopeDays: [...BLUEPRINT_SCOPE[blueprint]],
      // The COMPARABLE question count — extensions are deliberately not
      // included, because this number is what two results are compared on.
      questionCount: core.length,
      extensionCount: extensions.length,
      progressDay: context?.progressDay ?? null,
      groundedCount: questions.filter((q) => q.grounded).length,
    },
  };
}

/**
 * The cohort days a completed plan covered. Written to
 * `GeneralInterview.scopeDays` for provenance — never read back to decide
 * eligibility, which is always recomputed from mission submissions.
 */
export function scopeDaysFor(blueprint: InterviewBlueprintKey): number[] {
  return [...BLUEPRINT_SCOPE[blueprint]];
}
