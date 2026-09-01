import { logger } from "@/lib/logger";
import { assessmentReportSchema } from "@/lib/validations/mock-interview";
import { scoreQuestion } from "@/features/interview/module-scoring";
import {
  assembleAssessmentReport,
  deterministicNarrative,
  type AssembleInput,
  type AssessmentReportDocument,
  type ImprovementItem,
  type NarrativeItem,
} from "@/features/interview/platform/report-assembly";
import type { AskJson } from "@/features/interview/agent/llm/json-provider";
import type { InterviewPlan, InterviewState } from "@/features/interview/types";

/**
 * Report generation: exactly one LLM call, and it is allowed to write prose and
 * nothing else.
 *
 * The model is INJECTED (`AskJson`), the same seam the interview agent uses, so
 * this module stays pure — no `server-only`, no SDK — and can be exercised end
 * to end with a stub. `report-provider.ts:askForReport` binds the real call and
 * is reused unchanged.
 *
 * THE MODEL NEVER SEES A SCORE AND NEVER PRODUCES ONE. It is shown what the
 * candidate said and which checklist items they covered, and asked to explain
 * that in readable English with a citation on every claim. Anything it says
 * about a question that was not answered is discarded by `filterNarrative`
 * before the document is built.
 *
 * If the call fails the report is still produced: the deterministic narrative
 * states what the evidence shows, plainly, and the document is flagged
 * `narrativeDegraded` so nobody mistakes terseness for a judgment.
 */

const NARRATIVE_SYSTEM_PROMPT = `You write the narrative section of a practice interview report. You are writing for the candidate, who will read it to find out how they did and what to work on.

You are given, for each question: what was asked, what the candidate answered, which expected-evidence items they covered, and which they missed. You are NOT given scores and must never state, guess, or imply one.

Write:
- "strengths": 3 to 5 items. Each names something the candidate actually demonstrated, referring to what they said.
- "improvements": 3 to 5 items. Each names a specific gap, phrased as what to work on rather than as a verdict.
- "summary": 3 to 4 sentences describing how the interview went overall.
- "recommendation": 2 to 3 sentences on what this candidate should practise next.

Hard rules:
- EVERY strength and EVERY improvement must include "evidenceRefs": the ids of the questions it is based on. An item without a real question id is discarded, so an uncited observation is wasted work.
- Refer only to questions you were given. Never mention work, tools, or experience that does not appear in the material.
- Be specific. "Good understanding of AI" is useless; "explained that the model predicts text rather than retrieving a stored answer" is useful.
- Do not praise effort, attitude, or communication style unless the material shows it.
- If the candidate did poorly, say so plainly and kindly. Do not inflate.
- This is practice, not a verdict. Write so the candidate knows what to do next.
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
 * Only ANSWERED questions, and for each one the candidate's own words plus the
 * covered/missed checklist. Deliberately excluded: every score, the section and
 * competency numbers, the rubric, and the weights.
 */
function buildNarrativeUserMessage(
  plan: InterviewPlan,
  state: InterviewState,
  candidateName: string,
  domainLabel: string,
): string {
  const answered = plan.questions.filter(
    (q) => state.evidenceByQuestionId[q.id] !== undefined,
  );

  const blocks = answered.map((question) => {
    const expected = question.expectedEvidence ?? [];
    const indices = new Set(
      state.evidenceByQuestionId[question.id]?.matchedEvidence ?? [],
    );
    const answer = state.transcript.find(
      (l) => l.role === "candidate" && l.questionId === question.id,
    );

    return [
      `QUESTION ${question.id} (${question.mode ?? "CONCEPTUAL"})`,
      `Asked: ${question.text}`,
      `Candidate said: """${(answer?.text ?? "(no answer recorded)").slice(0, 420)}"""`,
      `Covered: ${
        expected.filter((_, i) => indices.has(i)).join(" · ") ||
        "(nothing on the checklist)"
      }`,
      `Missed: ${
        expected.filter((_, i) => !indices.has(i)).join(" · ") || "(nothing)"
      }`,
    ].join("\n");
  });

  return [
    `CANDIDATE: ${candidateName}`,
    `INTERVIEW: ${domainLabel} (practice)`,
    "",
    "Use ONLY these question ids in evidenceRefs:",
    answered.length > 0 ? answered.map((q) => q.id).join(", ") : "(none)",
    "",
    ...blocks,
  ].join("\n\n");
}

function coerceItems(raw: NarrativeResponse["strengths"]): NarrativeItem[] {
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

export type BuildReportInput = Omit<AssembleInput, "narrative">;

/**
 * Builds the report document. Never throws on a model failure.
 */
export async function buildAssessmentReport(
  ask: AskJson,
  input: BuildReportInput,
): Promise<AssessmentReportDocument> {
  const { plan, state, context, candidate } = input;

  const scores = plan.questions.map((q) => scoreQuestion(q, state));
  const fallback = deterministicNarrative(plan, scores);

  let strengths: NarrativeItem[] = [];
  let improvements: ImprovementItem[] = [];
  let summary = "";
  let recommendation = "";
  let degraded = true;

  const answeredCount = scores.filter((s) => s.answered).length;

  if (answeredCount > 0) {
    const result = await ask({
      system: NARRATIVE_SYSTEM_PROMPT,
      user: buildNarrativeUserMessage(
        plan,
        state,
        candidate.name,
        context.domainLabel,
      ),
      maxTokens: 2000,
    });

    if (result.ok) {
      const data = (result.data ?? {}) as NarrativeResponse;
      strengths = coerceItems(data.strengths);
      improvements = coerceItems(data.improvements).map((item) => ({
        ...item,
        // Suggested sections are NEVER taken from the model — they are read off
        // the cited questions' own provenance, so "revisit Judgement and limits"
        // always names a section those questions actually belong to.
        suggestedSections: [
          ...new Set(
            item.evidenceRefs
              .map((ref) => plan.questions.find((q) => q.id === ref)?.sectionId)
              .filter((s): s is string => typeof s === "string"),
          ),
        ],
      }));
      summary = (data.summary ?? "").trim().slice(0, 2000);
      recommendation = (data.recommendation ?? "").trim().slice(0, 1000);
      degraded = false;
    } else {
      logger.warn("[mock-interview-report] narrative generation failed", {
        message: result.message,
      });
    }
  }

  if (summary.length === 0) {
    const answered = scores.filter((s) => s.answered);
    const cleared = answered.filter((s) => s.cleared).length;
    summary =
      `Answered ${answered.length} of ${scores.length} questions, clearing the ` +
      `evidence bar on ${cleared}. This summary was generated from the recorded ` +
      `evidence because the narrative model was unavailable.`;
    degraded = true;
  }

  if (recommendation.length === 0) {
    const weakSections = [
      ...new Set(
        scores
          .filter((s) => s.answered && !s.cleared)
          .map(
            (s) => plan.questions.find((q) => q.id === s.questionId)?.sectionId,
          )
          .filter((s): s is string => typeof s === "string"),
      ),
    ];
    const labels = weakSections
      .map((id) => context.sections.find((s) => s.id === id)?.label ?? id)
      .join(", ");
    recommendation =
      weakSections.length > 0
        ? `Practise the areas where the evidence bar was not met: ${labels}.`
        : "No specific gaps were recorded against the questions you answered.";
    degraded = true;
  }

  return assembleAssessmentReport({
    ...input,
    narrative: {
      strengths: strengths.length > 0 ? strengths : fallback.strengths,
      improvements:
        improvements.length > 0 ? improvements : fallback.improvements,
      summary,
      recommendation,
      degraded,
    },
  });
}

/* ------------------------------------------------------------- validation */

/**
 * Validates a report document before it is written or after it is read.
 *
 * Both directions on purpose, and this is what closes the obligation left open
 * in Phase 2: `platform/repository.ts:saveReport` takes an already-validated
 * document, and THIS is the boundary that validates it. The service calls
 * `parseAssessmentReport` before persisting and again after loading, so there
 * is no path on which an unvalidated document reaches the column or the page.
 */
export function parseAssessmentReport(
  value: unknown,
):
  | { ok: true; data: AssessmentReportDocument }
  | { ok: false; message: string } {
  const parsed = assessmentReportSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }
  return { ok: true, data: value as AssessmentReportDocument };
}
