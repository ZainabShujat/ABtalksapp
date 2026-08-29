import { getPack } from "@/features/interview/platform/packs";
import type {
  InterviewDomain,
  PackQuestion,
  PlatformPlannedQuestion,
} from "@/features/interview/platform/types";

/**
 * How a domain turns into the questions it will ask.
 *
 * THE SEAM THIS EXISTS FOR. `cohort/planner.ts` hard-calls
 * `getQuestionBank(blueprint)`, which is why "a different kind of interview"
 * currently means "a different planner". A strategy makes the question SOURCE a
 * choice the domain declares:
 *
 *   AUTHORED_PACK  a fixed, versioned list — Phase 1, and what a comparable
 *                  assessment needs
 *   SCENARIO       a scenario brief with staged reveals rather than a flat list,
 *                  for the Forward Deployed AI Engineer domain
 *
 * Only `AUTHORED_PACK` is implemented. `SCENARIO` is declared on its domain and
 * deliberately unimplemented: `resolveStrategy` throws for it, so the failure is
 * a loud one at development time rather than a domain that silently starts as
 * something it is not.
 *
 * Nothing here talks to a model. A strategy chooses WHICH authored questions are
 * asked and in what order; it never writes one.
 *
 * Pure module.
 */

export type StrategyContext = {
  /** Used only for the spoken greeting. Never influences question selection. */
  candidateFirstName?: string | null;
};

export type QuestionStrategy = {
  id: InterviewDomain["strategy"];
  buildQuestions(
    domain: InterviewDomain,
    context: StrategyContext,
  ): PlatformPlannedQuestion[];
};

/**
 * Projects one authored pack question into the shape the engine grades.
 *
 * `text` is carried through verbatim and `spokenText` is deliberately NOT set:
 * on the cohort path that field holds a grounding clause built from the member's
 * own submissions, and a platform candidate has no such artifacts. Leaving it
 * absent means the room speaks `text`, which is exactly what was authored.
 *
 * `sourceRef.sourceDays` is `[]` on purpose. `scoreQuestion` reads it only to
 * derive cohort module numbers and returns `moduleNumbers: []` for an empty
 * array, so the cohort's curriculum mapping is inert here rather than wrong.
 */
function toPlannedQuestion(
  question: PackQuestion,
  index: number,
  packId: string,
  packVersion: number,
  sectionLabel: string,
): PlatformPlannedQuestion {
  return {
    id: question.id,
    order: index + 1,
    competency: question.competency,
    sourceRef: {
      source: "PLATFORM_PACK",
      sourceDays: [],
      label: `${sectionLabel} — ${packId} v${packVersion}`,
    },
    text: question.text,
    tier: "CORE",
    mode: question.mode,
    deepProbes: question.deepProbes,
    scaffoldProbes: question.scaffoldProbes,
    // Never true on this path. The pack wording is the comparability guarantee,
    // exactly as the cohort bank's is.
    llmPhrased: false,
    difficulty: question.difficulty,
    bankQuestionId: question.id,
    expectedEvidence: [...question.expectedEvidence],
    minEvidence: question.minEvidence,
    maxFollowUps: question.maxFollowUps,
    followUpPrompt: question.followUpPrompt,
    sectionId: question.sectionId,
    platformCompetencyId: question.platformCompetencyId,
  };
}

/**
 * The fixed-pack strategy.
 *
 * Questions are asked in authored order. That is not a limitation of this
 * strategy so much as a property of this branch: the adaptive conversation
 * planner (`agent/target-planner.ts`, plan 083) does not exist here, and
 * `state.ts` advances with `currentQuestionIndex + 1`. Adaptive DEPTH — deep
 * probes, scaffolds, redirects, repeats, clarifications — is fully active
 * regardless, because that is decided per question by `depth.ts` and
 * `policy.ts`.
 */
const authoredPackStrategy: QuestionStrategy = {
  id: "AUTHORED_PACK",

  buildQuestions(domain) {
    if (!domain.packRef) {
      throw new Error(
        `[platform-strategy] ${domain.slug} has no packRef; ` +
          `getStartableDomain should have rejected it before this point.`,
      );
    }

    const pack = getPack(domain.packRef);
    const sectionLabels = new Map(pack.sections.map((s) => [s.id, s.label]));

    // Grouped by declared section order, so a report's sections read in the
    // order the pack author intended rather than in question-array order.
    const ordered = pack.sections.flatMap((section) =>
      pack.questions.filter((q) => q.sectionId === section.id),
    );

    return ordered.map((question, index) =>
      toPlannedQuestion(
        question,
        index,
        pack.id,
        pack.version,
        sectionLabels.get(question.sectionId) ?? question.sectionId,
      ),
    );
  },
};

const STRATEGIES: Partial<Record<InterviewDomain["strategy"], QuestionStrategy>> =
  {
    AUTHORED_PACK: authoredPackStrategy,
  };

export function resolveStrategy(
  id: InterviewDomain["strategy"],
): QuestionStrategy {
  const strategy = STRATEGIES[id];
  if (!strategy) {
    throw new Error(
      `[platform-strategy] strategy "${id}" is declared but not implemented. ` +
        `Its domain must stay COMING_SOON until it is.`,
    );
  }
  return strategy;
}
