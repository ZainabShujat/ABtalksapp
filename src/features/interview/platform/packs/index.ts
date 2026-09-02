import { getRubric, hasRubric } from "@/features/interview/platform/rubrics";
import type {
  InterviewPack,
  PackRef,
} from "@/features/interview/platform/types";
import { AI_FLUENCY_V1 } from "@/features/interview/platform/packs/ai-fluency/v1";
import { BEHAVIORAL_V1 } from "@/features/interview/platform/packs/behavioral/v1";
import { AGENTIC_CODING_V1 } from "@/features/interview/platform/packs/agentic-coding/v1";

/**
 * The published interview packs, keyed by `${packId}@${version}`.
 *
 * Packs are CODE, not rows — the same decision `question-bank.ts` makes, for the
 * same reason: a malformed pack becomes a compile error and a failed import
 * rather than a production incident discovered by a candidate. It also makes
 * "human-reviewed" mean pull-request review, and makes a published version
 * immutable by construction, which matters because stored reports cite question
 * ids permanently.
 *
 * Pure module: no `server-only`, no Prisma, no fs. Importable from a plain
 * script, which is what `scripts/verify-interview-packs.ts` relies on.
 */

const PACKS: Record<string, InterviewPack> = {};

function register(pack: InterviewPack): void {
  const key = packKey({ packId: pack.id, version: pack.version });
  if (PACKS[key]) {
    throw new Error(`[platform-packs] duplicate pack registration "${key}".`);
  }
  PACKS[key] = pack;
}

export function packKey(ref: PackRef): string {
  return `${ref.packId}@${ref.version}`;
}

/**
 * Load-time integrity.
 *
 * Every rule here is transcribed from `question-bank.ts:assertBankIntegrity`,
 * because the platform's questions are graded by exactly the same machinery and
 * so must satisfy exactly the same contract. Two rules are additional, and both
 * exist because the platform separates the engine competency from the rubric
 * competency — a split that is easy to get wrong silently:
 *
 *   - every question's `platformCompetencyId` must exist in the pack's rubric
 *   - every scored rubric competency must have at least one question, unless it
 *     is `observedAcrossAnswers`
 *
 * Without the second, a rubric could carry a 30%-weighted dimension that no
 * question ever assesses, and every candidate would lose 30% of the available
 * score for a reason nothing in the report could explain.
 */
export function assertPackIntegrity(pack: InterviewPack): void {
  const where = `${pack.id}@${pack.version}`;

  if (pack.questions.length === 0) {
    throw new Error(`[platform-packs] ${where} has no questions.`);
  }
  if (pack.sections.length === 0) {
    throw new Error(`[platform-packs] ${where} declares no sections.`);
  }
  if (!Number.isInteger(pack.version) || pack.version < 1) {
    throw new Error(
      `[platform-packs] ${where} version must be a positive integer.`,
    );
  }
  if (!hasRubric(pack.rubricId)) {
    throw new Error(
      `[platform-packs] ${where} references unknown rubric "${pack.rubricId}".`,
    );
  }

  const rubric = getRubric(pack.rubricId);
  const rubricIds = new Set(rubric.competencies.map((c) => c.id));

  const sectionIds = new Set<string>();
  for (const section of pack.sections) {
    if (sectionIds.has(section.id)) {
      throw new Error(
        `[platform-packs] ${where} declares duplicate section "${section.id}".`,
      );
    }
    sectionIds.add(section.id);
  }

  const seenQuestions = new Set<string>();
  const assessed = new Set<string>();

  for (const q of pack.questions) {
    if (seenQuestions.has(q.id)) {
      throw new Error(`[platform-packs] ${where} duplicate question id ${q.id}.`);
    }
    seenQuestions.add(q.id);

    if (!sectionIds.has(q.sectionId)) {
      throw new Error(
        `[platform-packs] ${where} question ${q.id} references unknown ` +
          `section "${q.sectionId}".`,
      );
    }

    if (!rubricIds.has(q.platformCompetencyId)) {
      throw new Error(
        `[platform-packs] ${where} question ${q.id} scores against ` +
          `"${q.platformCompetencyId}", which is not a competency of rubric ` +
          `${pack.rubricId}.`,
      );
    }
    assessed.add(q.platformCompetencyId);

    if (q.expectedEvidence.length === 0) {
      throw new Error(
        `[platform-packs] ${where} question ${q.id} has no expected evidence, ` +
          `so its answer could never be judged.`,
      );
    }
    if (q.minEvidence < 1 || q.minEvidence > q.expectedEvidence.length) {
      throw new Error(
        `[platform-packs] ${where} question ${q.id} minEvidence ` +
          `${q.minEvidence} is not satisfiable against ` +
          `${q.expectedEvidence.length} evidence items.`,
      );
    }
    if (new Set(q.expectedEvidence).size !== q.expectedEvidence.length) {
      throw new Error(
        `[platform-packs] ${where} question ${q.id} repeats an expected ` +
          `evidence item; matched indices would be ambiguous.`,
      );
    }
    if (q.maxFollowUps > 0 && !q.followUpPrompt) {
      throw new Error(
        `[platform-packs] ${where} question ${q.id} allows follow-ups but has ` +
          `no followUpPrompt.`,
      );
    }

    // Escalation rungs must climb: the ladder picks "one level deeper" by
    // declared level, so an out-of-order or duplicated level is ambiguous.
    let previousLevel = 1;
    for (const probe of q.deepProbes ?? []) {
      if (probe.level <= previousLevel) {
        throw new Error(
          `[platform-packs] ${where} question ${q.id} deepProbes must ascend ` +
            `by level; saw ${probe.level} after ${previousLevel}.`,
        );
      }
      if (probe.expectedEvidence.length === 0) {
        throw new Error(
          `[platform-packs] ${where} question ${q.id} deep probe at level ` +
            `${probe.level} has no expected evidence, so its answer could ` +
            `never be judged.`,
        );
      }
      previousLevel = probe.level;
    }

    // A scaffold exists to unlock ONE listed evidence item. Pointing it at text
    // outside the checklist is a silent authoring error.
    for (const scaffold of q.scaffoldProbes ?? []) {
      if (!q.expectedEvidence.includes(scaffold.targets)) {
        throw new Error(
          `[platform-packs] ${where} question ${q.id} scaffold targets ` +
            `"${scaffold.targets}", which is not one of its expected ` +
            `evidence items.`,
        );
      }
    }
    if ((q.scaffoldProbes?.length ?? 0) > 0 && q.maxFollowUps === 0) {
      throw new Error(
        `[platform-packs] ${where} question ${q.id} has scaffolds but a zero ` +
          `follow-up budget, so they could never be asked.`,
      );
    }
  }

  for (const competency of rubric.competencies) {
    if (competency.observedAcrossAnswers) continue;
    if (!assessed.has(competency.id)) {
      throw new Error(
        `[platform-packs] ${where} never assesses rubric competency ` +
          `"${competency.id}" (weight ${competency.weight}), and it is not ` +
          `marked observedAcrossAnswers. Every candidate would lose that ` +
          `weight for a reason no report could explain.`,
      );
    }
  }
}

register(AI_FLUENCY_V1);
register(BEHAVIORAL_V1);
register(AGENTIC_CODING_V1);

for (const pack of Object.values(PACKS)) assertPackIntegrity(pack);

export function getPack(ref: PackRef): InterviewPack {
  const pack = PACKS[packKey(ref)];
  if (!pack) {
    throw new Error(`[platform-packs] unknown pack "${packKey(ref)}".`);
  }
  return pack;
}

export function hasPack(ref: PackRef): boolean {
  return packKey(ref) in PACKS;
}

/** Every registered pack. Used by the verifier script and by nothing else. */
export function allPacks(): InterviewPack[] {
  return Object.values(PACKS);
}
