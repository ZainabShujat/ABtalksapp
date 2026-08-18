import {
  BLUEPRINT_SCOPE,
  maxScopeDay,
  type InterviewBlueprintKey,
} from "@/features/interview/cohort/blueprint";
import {
  getQuestionBank,
  type CoreQuestion,
} from "@/features/interview/cohort/question-bank";
import { buildRubricSnapshot } from "@/features/interview/rubric";
import type { InterviewPlan, PlannedQuestion } from "@/features/interview/types";

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
): PlannedQuestion {
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
    // Never true for a cohort question. Standardized wording is the point.
    llmPhrased: false,
    difficulty: question.difficulty,
    bankQuestionId: question.id,
    expectedEvidence: question.expectedEvidence,
    minEvidence: question.minEvidence,
    maxFollowUps: question.maxFollowUps,
    followUpPrompt: question.followUpPrompt,
  };
}

/**
 * Builds the plan frozen into `GeneralInterview.plan` at open.
 *
 * The rubric snapshot travels with it so a historical score stays interpretable
 * if competency weights are ever changed.
 */
export function planCohortInterview(
  blueprint: InterviewBlueprintKey,
): InterviewPlan {
  const bank = getQuestionBank(blueprint);

  const questions = bank.questions.map((question, index) => {
    assertWithinScope(blueprint, question);
    return toPlannedQuestion(question, index);
  });

  return {
    questions,
    rubricSnapshot: buildRubricSnapshot(),
    contextSummary: {
      kind: "COHORT",
      blueprint,
      bankVersion: bank.version,
      scopeDays: [...BLUEPRINT_SCOPE[blueprint]],
      questionCount: questions.length,
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
