import "server-only";
import {
  assertCanStart,
  getBlueprintEligibility,
  type StartGateResult,
} from "@/features/interview/cohort-eligibility";
import type { InterviewBlueprintKey } from "@/features/interview/cohort/blueprint";
import { generateCohortPhrasing } from "@/features/interview/cohort/generate-phrasing";
import { resolveInterviewLLM } from "@/features/interview/agent/llm/registry";
import { planCohortInterview } from "@/features/interview/cohort/planner";
import { buildCohortCandidateContext } from "@/features/interview/cohort/candidate-context";
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
 *   - the candidate context comes from their own ProgramMember record, and is
 *     used to GROUND questions in real artifacts and to append beyond-milestone
 *     extension questions — never to change which core questions are asked
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
 * The CORE question set is still a pure function of the blueprint — the member
 * cannot influence which standardized questions they face, which is what keeps
 * two results comparable. What the member's own record does influence is
 * narrower and deliberate:
 *
 *   - grounding: a factual clause in front of a question, from their real
 *     submissions. Templated from database rows, never generated.
 *   - extensions: up to two questions about cohort days they have passed BEYOND
 *     this milestone, scored separately.
 *
 * Context is loaded from `memberId`, which the caller resolved from the session.
 * If it cannot be loaded the plan degrades to the ungrounded, extension-free
 * form rather than failing — a missing profile must not cost someone their
 * interview.
 */
export async function buildCohortPlan(
  memberId: string,
  blueprint: InterviewBlueprintKey,
): Promise<InterviewPlan> {
  const context = await buildCohortCandidateContext(memberId, blueprint);

  // Phrasing is generated ONCE, here, before the interview opens: there is no
  // per-question dependency (nothing has been answered yet) and doing it per
  // turn would add model latency to every exchange in a voice interview.
  // Failure is not a failure mode — an empty map means every question is asked
  // exactly as authored.
  const phrasing = await generateCohortPhrasing(
    resolveInterviewLLM(),
    blueprint,
    context,
  );

  return planCohortInterview(blueprint, context, phrasing);
}
