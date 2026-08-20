import { logger } from "@/lib/logger";
import { QUESTION_BANK_VERSION } from "@/features/interview/cohort/question-bank";
import type { InterviewBlueprintKey } from "@/features/interview/cohort/blueprint";
import { scoreQuestion } from "@/features/interview/module-scoring";
import {
  assembleReport,
  deterministicNarrative,
  type ImprovementItem,
  type InterviewReportDocument,
  type NarrativeItem,
  type ReportCandidate,
} from "@/features/interview/report-assembly";
import type { AskJson } from "@/features/interview/agent/llm/json-provider";
import type { InterviewPlan, InterviewState } from "@/features/interview/types";

/**
 * Report generation: exactly one LLM call, and it is allowed to write prose and
 * nothing else.
 *
 * The model is INJECTED (`AskJson`), the same seam the interview agent uses.
 * That keeps this module pure — no `server-only`, no SDK — so report generation
 * can be exercised end to end in a test script with a stub, and so swapping
 * vendors is a binding change rather than an edit here. `report-provider.ts`
 * binds the real Claude call.
 *
 * The model never sees a score and never produces one. It is shown what the
 * candidate said and which checklist items they covered, and asked to explain
 * that in readable English — with a citation on every claim. Anything it says
 * about a question that was not answered is discarded by
 * `filterNarrative` before the document is built.
 *
 * If the call fails, the report is still produced: the deterministic narrative
 * states what the evidence shows, plainly, and the document is flagged
 * `narrativeDegraded` so nobody mistakes terseness for a judgment.
 */

const NARRATIVE_SYSTEM_PROMPT = `You write the narrative section of a technical interview report for an AI engineering cohort. You are writing for the candidate and for the programme director.

You are given, for each question: what was asked, what the candidate answered, which expected-evidence items they covered, and which they missed. You are NOT given scores and must never state, guess, or imply one.

Write:
- "strengths": 3 to 5 items. Each names something the candidate actually demonstrated, referring to what they said.
- "improvements": 3 to 5 items. Each names a specific gap, phrased as what to work on rather than as a verdict.
- "summary": 3 to 4 sentences describing how the interview went overall.
- "recommendation": 2 to 3 sentences on what this candidate should do next in the programme.

Hard rules:
- EVERY strength and EVERY improvement must include "evidenceRefs": the ids of the questions it is based on. An item without a real question id is discarded, so an uncited observation is wasted work.
- Refer only to questions you were given. Never mention work, tools, or projects that do not appear in the material.
- Be specific. "Strong understanding of RAG" is useless; "explained why overlap prevents an exclusion clause being split across chunks" is useful.
- Do not praise effort, attitude, or communication style unless the material shows it.
- If the candidate did poorly, say so plainly and kindly. Do not inflate.
- No score, no grade, no percentage, no ranking anywhere.

Return ONLY JSON:
{"strengths":[{"text":"","evidenceRefs":[""]}],"improvements":[{"text":"","evidenceRefs":[""]}],"summary":"","recommendation":""}`;

type NarrativeResponse = {
  strengths?: { text?: string; evidenceRefs?: string[] }[];
  improvements?: { text?: string; evidenceRefs?: string[] }[];
  summary?: string;
  recommendation?: string;
};

/**
 * What the model is shown.
 *
 * Only answered CORE questions, and for each one the candidate's own words plus
 * the covered/missed checklist. Deliberately excluded: every score, the module
 * and competency numbers, and the extension questions — a narrative about
 * beyond-milestone work would blur the milestone the report is about.
 */
function buildNarrativeUserMessage(
  plan: InterviewPlan,
  state: InterviewState,
  candidate: ReportCandidate,
): string {
  const blocks = plan.questions
    .filter((q) => (q.tier ?? "CORE") === "CORE")
    .filter((q) => state.evidenceByQuestionId[q.id] !== undefined)
    .map((question) => {
      const expected = question.expectedEvidence ?? [];
      const indices = new Set(
        state.evidenceByQuestionId[question.id]?.matchedEvidence ?? [],
      );
      const answer = state.transcript.find(
        (l) => l.role === "candidate" && l.questionId === question.id,
      );

      return [
        `QUESTION ${question.id} (${question.mode ?? "CONCEPTUAL"}, ${question.competency})`,
        `Source: ${question.sourceRef.label}`,
        `Asked: ${question.text}`,
        `Candidate said: """${(answer?.text ?? "(no answer recorded)").slice(0, 900)}"""`,
        `Covered: ${
          expected.filter((_, i) => indices.has(i)).join(" · ") || "(nothing on the checklist)"
        }`,
        `Missed: ${
          expected.filter((_, i) => !indices.has(i)).join(" · ") || "(nothing)"
        }`,
      ].join("\n");
    });

  return [
    `CANDIDATE: ${candidate.name}, ${candidate.jobRole} at ${candidate.company}.`,
    `COHORT: ${candidate.cohort}.`,
    "",
    "Use ONLY these question ids in evidenceRefs:",
    blocks.length > 0
      ? plan.questions
          .filter((q) => state.evidenceByQuestionId[q.id] !== undefined)
          .map((q) => q.id)
          .join(", ")
      : "(none)",
    "",
    ...blocks,
  ].join("\n\n");
}

function coerceItems(
  raw: NarrativeResponse["strengths"],
): NarrativeItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => typeof item?.text === "string")
    .map((item) => ({
      text: String(item.text).slice(0, 600),
      evidenceRefs: Array.isArray(item.evidenceRefs)
        ? item.evidenceRefs.filter((r): r is string => typeof r === "string")
        : [],
    }));
}

export type BuildReportInput = {
  plan: InterviewPlan;
  state: InterviewState;
  blueprint: InterviewBlueprintKey;
  scopeDays: number[];
  candidate: ReportCandidate;
  progressDay: number | null;
  durationSec: number;
};

/**
 * Builds the report document. Never throws on a model failure.
 */
export async function buildInterviewReport(
  ask: AskJson,
  input: BuildReportInput,
): Promise<InterviewReportDocument> {
  const { plan, state, candidate } = input;

  const coreScores = plan.questions
    .filter((q) => (q.tier ?? "CORE") === "CORE")
    .map((q) => scoreQuestion(q, state));
  const fallback = deterministicNarrative(plan, coreScores);

  let strengths: NarrativeItem[] = [];
  let improvements: ImprovementItem[] = [];
  let summary = "";
  let recommendation = "";
  let degraded = true;

  const answeredCount = coreScores.filter((s) => s.answered).length;

  if (answeredCount > 0) {
    const result = await ask({
      system: NARRATIVE_SYSTEM_PROMPT,
      user: buildNarrativeUserMessage(plan, state, candidate),
      maxTokens: 2000,
    });

    if (result.ok) {
      const data = (result.data ?? {}) as NarrativeResponse;
      strengths = coerceItems(data.strengths);
      improvements = coerceItems(data.improvements).map((item) => ({
        ...item,
        // Suggested days are NEVER taken from the model — they are read off the
        // cited questions' own provenance, so "revisit Day 9" is always a day
        // the question actually came from.
        suggestedDays: [
          ...new Set(
            item.evidenceRefs.flatMap(
              (ref) =>
                plan.questions.find((q) => q.id === ref)?.sourceRef.sourceDays ??
                [],
            ),
          ),
        ].sort((a, b) => a - b),
      }));
      summary = (data.summary ?? "").trim().slice(0, 2000);
      recommendation = (data.recommendation ?? "").trim().slice(0, 1000);
      degraded = false;
    } else {
      logger.warn("[interview-report] narrative generation failed", {
        message: result.message,
      });
    }
  }

  if (summary.length === 0) {
    const answered = coreScores.filter((s) => s.answered);
    const cleared = answered.filter((s) => s.cleared).length;
    summary =
      `Answered ${answered.length} of ${coreScores.length} questions, clearing ` +
      `the evidence bar on ${cleared}. This summary was generated from the ` +
      `recorded evidence because the narrative model was unavailable.`;
    degraded = true;
  }

  if (recommendation.length === 0) {
    const weakDays = [
      ...new Set(
        coreScores.filter((s) => s.answered && !s.cleared).flatMap((s) => s.sourceDays),
      ),
    ].sort((a, b) => a - b);
    recommendation =
      weakDays.length > 0
        ? `Revisit cohort day${weakDays.length === 1 ? "" : "s"} ${weakDays.join(", ")}, where the evidence bar was not met.`
        : "No specific gaps were recorded against the assessed days.";
    degraded = true;
  }

  return assembleReport({
    ...input,
    bankVersion: QUESTION_BANK_VERSION,
    narrative: {
      strengths: strengths.length > 0 ? strengths : fallback.strengths,
      improvements: improvements.length > 0 ? improvements : fallback.improvements,
      summary,
      recommendation,
      degraded,
    },
  });
}

