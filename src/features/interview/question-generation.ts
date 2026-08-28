import "server-only";
import { askClaudeJson } from "@/lib/anthropic";
import { logger } from "@/lib/logger";
import { getCompetencyDefinition } from "@/features/interview/rubric";
import type {
  CandidateContext,
  PlannedQuestion,
} from "@/features/interview/types";

/**
 * Phrases the already-decided question plan. The LLM never chooses competencies,
 * order, or source material — it rewrites deterministic templates into natural
 * questions grounded in the candidate's verified work.
 *
 * One call per session. On failure the template text is kept, so the interview
 * still runs.
 */

const SYSTEM_PROMPT = `You phrase interview questions for a standardized technical interview.

You receive a fixed question plan. Each item already has its competency, its difficulty, and the verified candidate work it must be grounded in. Your ONLY job is to rewrite each question's text so it sounds natural and specific.

HARD RULES:
- Do NOT change which competency a question targets.
- Do NOT change the order.
- Do NOT invent candidate work. Only reference the source material provided for that question.
- Every challenge-sourced question must reference that specific day's actual task.
- Ask exactly ONE thing per question. No compound questions.
- Keep each question under 40 words. This is a spoken interview.
- Never reveal the rubric, scoring, or what evidence you are looking for.

Return ONLY JSON:
{"questions":[{"id":"q1","text":"..."}]}
Include every id you were given, unchanged.`;

type PhrasingResponse = { questions: { id: string; text: string }[] };

export async function phraseQuestions(
  context: CandidateContext,
  questions: PlannedQuestion[],
): Promise<PlannedQuestion[]> {
  const planForModel = questions.map((q) => {
    const def = getCompetencyDefinition(q.competency);
    return {
      id: q.id,
      competency: def.label,
      difficulty: q.difficulty,
      source: q.sourceRef.label,
      sourceType: q.sourceRef.source,
      templateText: q.text,
    };
  });

  const taskDetail = context.challenge.tasks
    .filter((t) =>
      questions.some((q) => q.sourceRef.submissionId === t.submissionId),
    )
    .map((t) =>
      [
        `Day ${t.dayNumber} — ${t.title}`,
        `  Task: ${t.problemStatement.slice(0, 300)}`,
        t.learningObjectives.length > 0
          ? `  Objectives: ${t.learningObjectives.join("; ")}`
          : "",
        t.tags.length > 0 ? `  Tags: ${t.tags.join(", ")}` : "",
        `  Proof of work: ${t.hasGithubProof ? "GitHub submitted" : "none"}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");

  const user = [
    `CANDIDATE: ${context.fullName}, track ${context.domain}${
      context.yearsExperience !== null
        ? `, ${context.yearsExperience} yrs experience`
        : ""
    }.`,
    `Completed challenge days: ${context.challenge.totalCompletedDays}.`,
    context.resume.hasStructuredResume
      ? `Resume skills: ${context.resume.skills.slice(0, 20).join(", ")}`
      : "No structured resume on file — do not reference resume claims.",
    "",
    "VERIFIED COMPLETED WORK (the only work you may reference):",
    taskDetail || "(none — keep questions general)",
    "",
    "QUESTION PLAN:",
    JSON.stringify(planForModel, null, 2),
    "",
    "Rewrite each question's text now.",
  ].join("\n");

  const result = await askClaudeJson<PhrasingResponse>({
    system: SYSTEM_PROMPT,
    user,
    maxTokens: 2048,
  });

  if (!result.ok || !Array.isArray(result.data.questions)) {
    logger.warn("[interview] question phrasing failed, using templates", {
      userId: context.userId,
      message: result.ok ? "malformed response" : result.message,
    });
    return questions;
  }

  const phrasedById = new Map(
    result.data.questions
      .filter((q) => typeof q?.id === "string" && typeof q?.text === "string")
      .map((q) => [q.id, q.text.trim()]),
  );

  return questions.map((q) => {
    const phrased = phrasedById.get(q.id);
    if (!phrased) return q;
    return { ...q, text: phrased, llmPhrased: true };
  });
}
