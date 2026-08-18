import "server-only";
import { askClaudeJson } from "@/lib/anthropic";
import { logger } from "@/lib/logger";
import { RUBRIC, getCompetencyDefinition } from "@/features/interview/rubric";
import type {
  AnswerEvidence,
  CompetencyJudgment,
  EvidenceTier,
  InterviewPlan,
  InterviewState,
  IssueType,
  PlannedQuestion,
  TurnAction,
  TurnDecision,
} from "@/features/interview/types";
import { EVIDENCE_TIERS, ISSUE_TYPES } from "@/features/interview/types";
import {
  deriveCompetencyTier,
  deriveFallbackJudgments,
} from "@/features/interview/evidence";
import { transcriptToText } from "@/features/interview/state";

/**
 * Two LLM call sites, both bounded and both with deterministic fallbacks:
 *   1. per answer — extract evidence and propose a turn action
 *   2. once at the end — per-competency judgment over the full transcript
 *
 * Neither produces a final score. `scoring.ts` aggregates in code.
 */

/* ----------------------------------------------------- per-answer evidence */

const TURN_SYSTEM_PROMPT = `You extract evidence from a candidate's interview answer and propose the next turn.

Extract three independent evidence axes:
- conceptual: did they explain the underlying idea, not just name it?
- practical: did they cite specific work THEY did (files, tools, data, steps)?
- tradeoffs: did they discuss limits, edge cases, or alternatives?

Flag any of these issues that apply:
- "stuck_or_evasive": says "I don't know", one-word or non-answer
- "no_practical_evidence": textbook answer with no real work cited
- "factually_wrong": incorrect technical claims
- "contradicts_earlier": conflicts with what they said before
- "off_topic": does not address the question

Propose ONE action:
- "FOLLOW_UP": the answer is promising but missing a specific evidence axis. Draft one targeted follow-up probing ONLY the missing axis. Never change topic.
- "NEXT_QUESTION": evidence is sufficient, or the candidate is stuck and probing further would waste time.

Never invent a new topic. Never reveal scoring.

Return ONLY JSON:
{"conceptualFound":bool,"practicalFound":bool,"tradeoffsFound":bool,"flaggedIssues":[],"action":"FOLLOW_UP"|"NEXT_QUESTION","followUpText":"","reasoning":"one short line"}`;

type TurnResponse = {
  conceptualFound?: boolean;
  practicalFound?: boolean;
  tradeoffsFound?: boolean;
  flaggedIssues?: string[];
  action?: string;
  followUpText?: string;
  reasoning?: string;
};

function coerceIssues(value: unknown): IssueType[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is IssueType =>
    (ISSUE_TYPES as readonly string[]).includes(v as string),
  );
}

function blankAnswerDecision(answerText: string): TurnDecision {
  const isBlank = answerText.trim().length < 5;
  return {
    evidence: {
      conceptualFound: false,
      practicalFound: false,
      tradeoffsFound: false,
      flaggedIssues: isBlank ? ["stuck_or_evasive"] : [],
      reasoning: isBlank
        ? "No substantive answer given."
        : "Evaluation unavailable; recorded without evidence.",
    },
    action: "NEXT_QUESTION",
    followUpText: null,
    candidateStuck: isBlank,
  };
}

export async function evaluateAnswer(
  question: PlannedQuestion,
  answerText: string,
  priorEvidence: AnswerEvidence | null,
): Promise<TurnDecision> {
  if (answerText.trim().length < 5) {
    return blankAnswerDecision(answerText);
  }

  const def = getCompetencyDefinition(question.competency);

  // Cohort bank questions carry an explicit expected-evidence checklist. Giving
  // the model the checklist it is grading against is what keeps evaluation
  // consistent across candidates — without it, "sufficient" drifts per answer.
  const bankEvidence =
    question.expectedEvidence && question.expectedEvidence.length > 0
      ? [
          "EXPECTED EVIDENCE FOR THIS QUESTION (the standard to grade against):",
          ...question.expectedEvidence.map((item, i) => `  ${i + 1}. ${item}`),
          question.minEvidence
            ? `An answer is sufficient at ${question.minEvidence} of these.`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";

  const user = [
    `QUESTION: ${question.text}`,
    `COMPETENCY: ${def.label} — ${def.expectations}`,
    bankEvidence,
    `EVIDENCE SOUGHT:`,
    `  conceptual: ${def.evidenceRequired.conceptual}`,
    `  practical: ${def.evidenceRequired.practical}`,
    `  tradeoffs: ${def.evidenceRequired.tradeoffs}`,
    priorEvidence
      ? `ALREADY ESTABLISHED THIS QUESTION: ${JSON.stringify(priorEvidence)}`
      : "",
    `CANDIDATE ANSWER:\n"""${answerText}"""`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await askClaudeJson<TurnResponse>({
    system: TURN_SYSTEM_PROMPT,
    user,
    maxTokens: 600,
  });

  if (!result.ok) {
    logger.warn("[interview] answer evaluation failed", {
      questionId: question.id,
      message: result.message,
    });
    return blankAnswerDecision(answerText);
  }

  const data = result.data;
  const flaggedIssues = coerceIssues(data.flaggedIssues);

  // If the model wants to probe but returns no text, fall back to the bank's
  // own follow-up prompt rather than dropping the probe. The bank prompt targets
  // exactly the gap the question was written to expose, so the probe stays on
  // topic even when the model's drafting fails.
  const followUpText =
    (data.followUpText ?? "").trim() || (question.followUpPrompt ?? "");

  const action: TurnAction =
    data.action === "FOLLOW_UP" && followUpText.length > 0
      ? "FOLLOW_UP"
      : "NEXT_QUESTION";

  return {
    evidence: {
      conceptualFound: data.conceptualFound === true,
      practicalFound: data.practicalFound === true,
      tradeoffsFound: data.tradeoffsFound === true,
      flaggedIssues,
      reasoning: (data.reasoning ?? "").slice(0, 500),
    },
    action,
    followUpText: action === "FOLLOW_UP" ? followUpText : null,
    candidateStuck: flaggedIssues.includes("stuck_or_evasive"),
  };
}

/* ------------------------------------------------ final per-competency call */

const JUDGMENT_SYSTEM_PROMPT = `You assign an evidence tier per competency for a completed technical interview.

Tiers:
- "NONE": no usable evidence.
- "CLAIMED": asserted ability without explanation or specifics.
- "EXPLAINED": explained the reasoning correctly, but without concrete personal work.
- "DEMONSTRATED": explained it AND cited specific work they personally did.

Judge ONLY from the transcript. Do not reward confidence, fluency, or length — reward specificity. A candidate who says "I don't know" honestly is not penalized beyond the missing evidence itself.

Return ONLY JSON:
{"judgments":[{"competency":"CONCEPTUAL","tier":"EXPLAINED","justification":"one short line"}],"summary":"2-3 recruiter-readable sentences"}
Include every competency you were given.`;

type JudgmentResponse = {
  judgments?: { competency?: string; tier?: string; justification?: string }[];
  summary?: string;
};

export async function judgeInterview(
  plan: InterviewPlan,
  state: InterviewState,
): Promise<{ judgments: CompetencyJudgment[]; summary: string }> {
  const transcript = transcriptToText(state);
  if (transcript.trim().length === 0) {
    return deriveFallbackJudgments(state, plan);
  }

  const user = [
    "COMPETENCIES TO JUDGE:",
    RUBRIC.map(
      (r) => `- ${r.competency} (${r.label}): ${r.expectations}`,
    ).join("\n"),
    "",
    "PER-ANSWER EVIDENCE ALREADY EXTRACTED:",
    JSON.stringify(state.evidenceByQuestionId),
    "",
    "TRANSCRIPT:",
    transcript,
  ].join("\n");

  const result = await askClaudeJson<JudgmentResponse>({
    system: JUDGMENT_SYSTEM_PROMPT,
    user,
    maxTokens: 1500,
  });

  if (!result.ok || !Array.isArray(result.data.judgments)) {
    logger.warn("[interview] final judgment failed, using evidence fallback", {
      message: result.ok ? "malformed response" : result.message,
    });
    return deriveFallbackJudgments(state, plan);
  }

  const byCompetency = new Map(
    result.data.judgments
      .filter((j) => typeof j?.competency === "string")
      .map((j) => [j.competency as string, j]),
  );

  const judgments: CompetencyJudgment[] = RUBRIC.map((r) => {
    const raw = byCompetency.get(r.competency);
    const tier =
      raw?.tier && (EVIDENCE_TIERS as readonly string[]).includes(raw.tier)
        ? (raw.tier as EvidenceTier)
        : deriveCompetencyTier(r.competency, state, plan);
    return {
      competency: r.competency,
      tier,
      justification: (raw?.justification ?? "").slice(0, 400),
    };
  });

  return {
    judgments,
    summary: (result.data.summary ?? "").trim().slice(0, 1000),
  };
}
