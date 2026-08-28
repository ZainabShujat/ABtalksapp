import "server-only";
import { logger } from "@/lib/logger";
import { getQuestionBank } from "@/features/interview/cohort/question-bank";
import { describeCurriculum } from "@/features/interview/cohort/curriculum-context";
import {
  FRAMING,
  choosePhrasing,
  type DifficultyBand,
} from "@/features/interview/cohort/question-phrasing";
import type { CohortCandidateContext } from "@/features/interview/cohort/candidate-context";
import type { InterviewBlueprintKey } from "@/features/interview/cohort/blueprint";
import type { InterviewLLM } from "@/features/interview/agent/llm/provider";

/**
 * Phrases the CORE questions for one interview, once, before it opens.
 *
 * The split this preserves: the bank decides WHAT is assessed and what counts
 * as evidence; the model decides only how each target is said out loud. Every
 * generated string is validated by `choosePhrasing` before it is accepted, and
 * anything that fails falls back to the authored question — so a bad
 * generation, a provider outage and a missing key all produce the interview
 * that existed before this file.
 *
 * ONE call for the whole plan. Ten calls would multiply latency at exactly the
 * moment the candidate is waiting for the interview to start, and this work has
 * no per-question dependency: nothing has been answered yet.
 */

/**
 * Candidate work carried into a question's prompt.
 *
 * Bounded deliberately. What we actually hold is thin — a mission submission
 * stores `payload.repoRef`, which is a FILENAME, not the file. There is no
 * repository read anywhere in this codebase and none is added here. Describing
 * more than we have is how an interviewer ends up asking about a function the
 * candidate never wrote.
 */
function describeCandidateWork(
  context: CohortCandidateContext | null,
  sourceDays: readonly number[],
): string {
  if (!context) return "";

  const days = new Set(sourceDays);
  const parts: string[] = [];

  for (const submission of context.submissions) {
    if (!days.has(submission.dayNumber) || !submission.passed) continue;
    // The filename is the only artifact detail we hold. It is still worth
    // carrying: "day11_solution.py" tells the interviewer they shipped
    // something for that day, which is what makes the question specific.
    if (submission.repoRef) {
      parts.push(`day ${submission.dayNumber}: submitted ${submission.repoRef}`);
    } else {
      parts.push(`day ${submission.dayNumber}: submitted`);
    }
  }

  // `title` is the first line of the member's own project write-up — their own
  // name for what they built, and the richest candidate-authored text the
  // interview holds. Everything else we have about a submission is metadata.
  for (const project of context.projects) {
    const title = project.title.replace(/\s+/g, " ").trim();
    if (title.length === 0) continue;
    parts.push(`module ${project.moduleNumber} project: ${title.slice(0, 160)}`);
  }

  return parts.slice(0, 6).join("; ");
}

export function bandFor(
  level: "FOUNDATIONS" | "WORKING" | "ADVANCED" | null | undefined,
): DifficultyBand {
  return level ?? "WORKING";
}

/**
 * Returns generated wording per question id. Never throws.
 *
 * An empty map is a valid, working result: `planCohortInterview` treats a
 * missing entry as "ask this one exactly as authored".
 */
export async function generateCohortPhrasing(
  llm: InterviewLLM,
  blueprint: InterviewBlueprintKey,
  context: CohortCandidateContext | null,
  level?: "FOUNDATIONS" | "WORKING" | "ADVANCED" | null,
): Promise<Record<string, string>> {
  if (!llm.phraseQuestions) return {};

  const bank = getQuestionBank(blueprint);
  const targets = bank.questions.map((q) => ({
    id: q.id,
    authored: q.text,
    competency: q.competency,
    curriculum: describeCurriculum(q.sourceDays),
    candidateWork: describeCandidateWork(context, q.sourceDays),
  }));

  const raw = await llm.phraseQuestions({
    targets,
    framing: FRAMING[bandFor(level)],
    candidateFirstName: context?.fullName?.trim().split(/\s+/)[0] ?? null,
  });

  // Validate every one. The model is not trusted to have obeyed the rules just
  // because it was told them.
  const accepted: Record<string, string> = {};
  let rejected = 0;
  for (const question of bank.questions) {
    const choice = choosePhrasing(
      raw[question.id],
      question.text,
      question.expectedEvidence,
    );
    if (choice.generated) {
      accepted[question.id] = choice.text;
    } else if (raw[question.id]) {
      rejected += 1;
      logger.info("[interview] generated question rejected", {
        questionId: question.id,
        reason: choice.rejection,
      });
    }
  }

  logger.info("[interview] question phrasing", {
    blueprint,
    level: bandFor(level),
    accepted: Object.keys(accepted).length,
    rejected,
    total: bank.questions.length,
  });

  return accepted;
}
