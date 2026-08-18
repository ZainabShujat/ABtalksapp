import "server-only";
import {
  assertCanStart,
  getBlueprintEligibility,
  type StartGateResult,
} from "@/features/interview/cohort-eligibility";
import type { InterviewBlueprintKey } from "@/features/interview/cohort/blueprint";
import { planCohortInterview } from "@/features/interview/cohort/planner";
import type {
  CohortEligibility,
  InterviewPlan,
} from "@/features/interview/types";

/**
 * Builds an AI Cohort interview session.
 *
 * Retargeted from the general interviewer: it used to assemble a candidate
 * context from 60-day `Enrollment` / `Submission` / `DailyTask` rows plus resume
 * fields, then pay an LLM call to phrase questions per candidate. None of that
 * applies to a standardized cohort interview, and all of it would break
 * comparability. Those modules (`candidate-context`, `challenge-context`,
 * `resume-context`, `question-rules`, `question-generation`) are untouched on
 * disk for the future general interview — they are simply not on this path.
 *
 * What remains is deliberately thin, and entirely LLM-free:
 *   - eligibility comes from actual PASSED mission days
 *   - the plan comes from the fixed bank for the blueprint
 *
 * Nothing here reads a request body. The only inputs are a server-resolved
 * `memberId` and a server-validated blueprint.
 */

export type CohortSession = {
  blueprint: InterviewBlueprintKey;
  eligibility: CohortEligibility;
  plan: InterviewPlan;
};

/**
 * Cheap read for pre-interview screens. Runs on every page load, so it never
 * builds a plan and never calls a model.
 */
export async function resolveCohortEligibility(
  memberId: string,
  blueprint: InterviewBlueprintKey,
): Promise<CohortEligibility> {
  return getBlueprintEligibility(memberId, blueprint);
}

/**
 * The authoritative pre-create check.
 *
 * Re-exported from here so that every caller reaches the gate through the
 * session layer rather than importing eligibility directly — there is exactly
 * one door into "may this member open an attempt".
 */
export async function gateStart(
  memberId: string,
  blueprint: InterviewBlueprintKey,
): Promise<StartGateResult> {
  return assertCanStart(memberId, blueprint);
}

/**
 * The plan frozen into a new attempt.
 *
 * A pure function of the blueprint — the member does not influence it. Kept as a
 * named session step rather than inlined at the call site so the "plan is
 * server-derived, never client-supplied" boundary stays visible.
 */
export function buildCohortPlan(
  blueprint: InterviewBlueprintKey,
): InterviewPlan {
  return planCohortInterview(blueprint);
}
