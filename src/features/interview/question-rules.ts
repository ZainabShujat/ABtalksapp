import { INTERVIEW_QUESTION_COUNT } from "@/features/interview/constants";
import { RUBRIC } from "@/features/interview/rubric";
import type {
  CandidateContext,
  Competency,
  CompletedChallengeTask,
  PlannedQuestion,
  QuestionSourceRef,
} from "@/features/interview/types";

/**
 * Deterministic question planning. Code decides WHICH competency is assessed and
 * WHAT verified material grounds it; the LLM only phrases the result. This is
 * what keeps scores comparable across candidates — every interview covers the
 * same competencies in the same proportion regardless of who is sitting it.
 */

/** Question slots per competency, proportional to rubric weight. Sums to 10. */
const SLOTS_PER_COMPETENCY: Record<Competency, number> = {
  CONCEPTUAL: 3,
  PRACTICAL: 3,
  PROBLEM_SOLVING: 2,
  TECHNICAL_DEPTH: 2,
  COMMUNICATION: 0,
};

/**
 * COMMUNICATION gets no dedicated slot on purpose: it is assessed across every
 * answer rather than by asking someone to demonstrate communication directly.
 */

function difficultyForIndex(index: number): "easy" | "medium" | "hard" {
  if (index === 0) return "easy";
  if (index < 6) return "medium";
  return "hard";
}

function challengeSourceRef(task: CompletedChallengeTask): QuestionSourceRef {
  return {
    source: "CHALLENGE_TASK",
    submissionId: task.submissionId,
    challengeId: task.challengeId,
    dayNumber: task.dayNumber,
    dailyTaskId: task.dailyTaskId,
    label: `Day ${task.dayNumber} — ${task.title}`,
  };
}

/** Fallback phrasing used verbatim if the LLM phrasing call fails. */
function templateText(
  competency: Competency,
  ref: QuestionSourceRef,
  task: CompletedChallengeTask | null,
): string {
  if (task) {
    switch (competency) {
      case "CONCEPTUAL":
        return `On Day ${task.dayNumber} you worked on "${task.title}". Explain the core idea behind that task in your own words.`;
      case "PRACTICAL":
        return `Walk me through what you actually built for "${task.title}" on Day ${task.dayNumber}. What specific steps did you take?`;
      case "PROBLEM_SOLVING":
        return `What was the hardest part of "${task.title}", and how did you work through it?`;
      case "TECHNICAL_DEPTH":
        return `In your Day ${task.dayNumber} solution for "${task.title}", where would it break at larger scale, and why?`;
      case "COMMUNICATION":
        return `Summarize what you learned from "${task.title}" as if explaining it to a teammate.`;
    }
  }

  switch (competency) {
    case "CONCEPTUAL":
      return `Pick a concept you've learned recently in your ${ref.label} work and explain it in your own words.`;
    case "PRACTICAL":
      return `Describe something you built recently. What did you personally implement?`;
    case "PROBLEM_SOLVING":
      return `Tell me about a problem you got stuck on recently. How did you approach it?`;
    case "TECHNICAL_DEPTH":
      return `Describe a bug you've debugged. What was the root cause?`;
    case "COMMUNICATION":
      return `Explain a technical topic you know well to someone non-technical.`;
  }
}

/**
 * Builds the ordered question plan. Challenge tasks are consumed at most once so
 * a candidate is never asked two questions about the same day.
 */
export function planQuestions(context: CandidateContext): PlannedQuestion[] {
  const available = [...context.challenge.tasks];
  const slots: Competency[] = [];

  for (const rubricEntry of RUBRIC) {
    const count = SLOTS_PER_COMPETENCY[rubricEntry.competency];
    for (let i = 0; i < count; i++) slots.push(rubricEntry.competency);
  }

  // Interleave competencies so the interview doesn't ask three conceptual
  // questions back to back.
  const ordered: Competency[] = [];
  const remaining = new Map<Competency, number>();
  for (const slot of slots) {
    remaining.set(slot, (remaining.get(slot) ?? 0) + 1);
  }
  while (ordered.length < slots.length) {
    for (const rubricEntry of RUBRIC) {
      const left = remaining.get(rubricEntry.competency) ?? 0;
      if (left <= 0) continue;
      ordered.push(rubricEntry.competency);
      remaining.set(rubricEntry.competency, left - 1);
      if (ordered.length >= slots.length) break;
    }
  }

  const questions: PlannedQuestion[] = [];

  ordered.slice(0, INTERVIEW_QUESTION_COUNT).forEach((competency, index) => {
    const task = available.shift() ?? null;
    const ref: QuestionSourceRef = task
      ? challengeSourceRef(task)
      : context.resume.hasStructuredResume
        ? {
            source: "RESUME_CLAIM",
            label: context.resume.targetRole ?? "your resume",
          }
        : context.resume.skills.length > 0
          ? { source: "PROFILE_SKILL", label: context.resume.skills[0]! }
          : { source: "GENERIC", label: context.domain };

    questions.push({
      id: `q${index + 1}`,
      order: index + 1,
      competency,
      sourceRef: ref,
      text: templateText(competency, ref, task),
      llmPhrased: false,
      difficulty: difficultyForIndex(index),
    });
  });

  return questions;
}
