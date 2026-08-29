import type { RubricDefinition } from "@/features/interview/platform/types";

/**
 * Per-domain rubrics.
 *
 * The cohort has exactly one rubric, a module-level const in `rubric.ts`, and
 * five competencies baked into named database columns. That is correct for a
 * single standardized credential and wrong for a catalogue: an AI Fluency
 * interview and a Behavioral interview do not measure the same things, and
 * forcing both through "Conceptual / Practical / Problem solving / Technical
 * depth / Communication" would either mislabel what was assessed or quietly
 * score dimensions nobody asked about.
 *
 * So a rubric is data, selected by domain, and FROZEN into the plan at open —
 * `PlatformPlanContext.rubric`. A report stays interpretable against the rubric
 * it was actually scored under even if the rubric is later revised.
 *
 * Two invariants, both asserted at module load:
 *   1. weights within a rubric total exactly 100
 *   2. competency ids are unique within a rubric
 *
 * Pure module. No `server-only`, no database.
 */

/* ------------------------------------------------------------ ai-fluency */

const AI_FLUENCY_V1: RubricDefinition = {
  id: "ai-fluency-v1",
  label: "AI Fluency",
  competencies: [
    {
      id: "mental-model",
      label: "Mental model of how LLMs work",
      weight: 30,
      expectations:
        "Explains what a language model is actually doing — prediction over tokens, not retrieval or reasoning — and why that shape produces both its strengths and its failure modes.",
      observedAcrossAnswers: false,
    },
    {
      id: "practical-use",
      label: "Practical use and prompting",
      weight: 25,
      expectations:
        "Describes concrete things they have actually done with these tools, with specifics a bystander could not invent: what they asked for, what came back, what they changed.",
      observedAcrossAnswers: false,
    },
    {
      id: "limits-and-risk",
      label: "Limits, risk and verification",
      weight: 25,
      expectations:
        "Knows where the tool is unreliable, and has a habit for checking output rather than a stated belief that checking matters.",
      observedAcrossAnswers: false,
    },
    {
      id: "communication",
      label: "Clarity of explanation",
      weight: 20,
      expectations:
        "Answers the question that was asked, in plain language, and says so plainly when they do not know.",
      observedAcrossAnswers: true,
    },
  ],
};

/* ------------------------------------------------------------- behavioral */

/**
 * Deliberately shares no competency id with the AI Fluency rubric.
 *
 * That is the point of shipping these two domains first: if scoring, reporting
 * or the catalogue accidentally assumes a fixed competency set, these two
 * rubrics surface it immediately rather than at the eighth domain.
 */
const BEHAVIORAL_V1: RubricDefinition = {
  id: "behavioral-v1",
  label: "Workplace Situations",
  competencies: [
    {
      id: "specificity",
      label: "Specificity of example",
      weight: 30,
      expectations:
        "Describes one real situation with enough concrete detail — who, when, what was actually at stake — that it could not be a hypothetical.",
      observedAcrossAnswers: false,
    },
    {
      id: "ownership",
      label: "Ownership and contribution",
      weight: 25,
      expectations:
        "Distinguishes what they personally did from what the team did, without either inflating their role or hiding inside 'we'.",
      observedAcrossAnswers: false,
    },
    {
      id: "reflection",
      label: "Reflection and learning",
      weight: 25,
      expectations:
        "Names what they would do differently and why, based on what actually happened rather than on a general principle.",
      observedAcrossAnswers: false,
    },
    {
      id: "structure",
      label: "Structure of the answer",
      weight: 20,
      expectations:
        "Gives enough situation to make the action make sense, and reaches an outcome without being asked to.",
      observedAcrossAnswers: true,
    },
  ],
};

/* -------------------------------------------------------------- registry */

const RUBRICS: Record<string, RubricDefinition> = {
  [AI_FLUENCY_V1.id]: AI_FLUENCY_V1,
  [BEHAVIORAL_V1.id]: BEHAVIORAL_V1,
};

/**
 * Load-time integrity.
 *
 * Same reasoning as `question-bank.ts:assertBankIntegrity`: a rubric whose
 * weights do not total 100 produces a silently wrong overall score, which is
 * far worse than a module that refuses to import.
 */
function assertRubricIntegrity(rubric: RubricDefinition): void {
  if (rubric.competencies.length === 0) {
    throw new Error(`[platform-rubrics] ${rubric.id} has no competencies.`);
  }

  const seen = new Set<string>();
  for (const competency of rubric.competencies) {
    if (seen.has(competency.id)) {
      throw new Error(
        `[platform-rubrics] ${rubric.id} declares duplicate competency id ` +
          `"${competency.id}".`,
      );
    }
    seen.add(competency.id);

    if (competency.weight <= 0) {
      throw new Error(
        `[platform-rubrics] ${rubric.id}.${competency.id} has weight ` +
          `${competency.weight}; a scored dimension must carry weight.`,
      );
    }
  }

  const total = rubric.competencies.reduce((sum, c) => sum + c.weight, 0);
  if (total !== 100) {
    throw new Error(
      `[platform-rubrics] ${rubric.id} weights total ${total}, not 100. ` +
        `The overall score divides by 100, so this would silently misscore.`,
    );
  }
}

for (const rubric of Object.values(RUBRICS)) assertRubricIntegrity(rubric);

export function getRubric(rubricId: string): RubricDefinition {
  const rubric = RUBRICS[rubricId];
  if (!rubric) {
    throw new Error(`[platform-rubrics] unknown rubric "${rubricId}".`);
  }
  return rubric;
}

export function hasRubric(rubricId: string): boolean {
  return rubricId in RUBRICS;
}

/** The frozen projection written into `PlatformPlanContext.rubric`. */
export function rubricSnapshotFor(rubricId: string): {
  id: string;
  competencies: { id: string; label: string; weight: number }[];
} {
  const rubric = getRubric(rubricId);
  return {
    id: rubric.id,
    competencies: rubric.competencies.map((c) => ({
      id: c.id,
      label: c.label,
      weight: c.weight,
    })),
  };
}

export { AI_FLUENCY_V1, BEHAVIORAL_V1 };
