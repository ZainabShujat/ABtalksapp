import type { InterviewDecision } from "@/features/interview/agent/types";
import type { PlannedQuestion } from "@/features/interview/types";
import type { EvalCase } from "./cases";

/**
 * Scoring one model turn against one case.
 *
 * Every dimension is a deterministic predicate over the model's decision. No
 * model grades another model here: an LLM judge would add a second unmeasured
 * error source to an exercise whose entire purpose is measuring error, and it
 * would make provider comparison circular.
 *
 * Dimensions are reported SEPARATELY and never summed into one number. A model
 * that reads evidence well but invents follow-ups is a different problem from
 * one that is cautious but misses evidence, and a single score hides exactly
 * that distinction.
 *
 * `null` means the dimension does not apply to this case, and it is excluded
 * from that dimension's rate rather than counted as a pass.
 */

export const DIMENSIONS = [
  "relevance",
  "followUpQuality",
  "adaptivity",
  "grounding",
  "evidenceExtraction",
  "technicalCorrectness",
  "conversationalQuality",
  "nonRepetition",
  "safetyNonInvention",
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

export type DimensionResult = {
  pass: boolean | null;
  detail: string;
};

export type CaseScore = Record<Dimension, DimensionResult>;

const norm = (s: string) => s.toLowerCase();

/** Does the text touch any of these concepts? Substring, case-insensitive. */
function touchesAny(text: string, concepts: string[]): boolean {
  const t = norm(text);
  return concepts.some((c) => t.includes(norm(c)));
}

export function scoreCase(
  testCase: EvalCase,
  question: PlannedQuestion,
  decision: InterviewDecision,
  policyAction: string,
): CaseScore {
  const expect = testCase.expect;
  const relevance = decision.evidence.relevance ?? "ON_TOPIC";
  const matched = decision.evidence.matchedEvidence ?? [];
  const followUp = (decision.followUpQuestion ?? "").trim();
  const ack = (decision.acknowledgement ?? "").trim();
  const expected = question.expectedEvidence ?? [];

  /* ------------------------------------------------------- relevance */

  const relevanceOk = expect.relevance.includes(relevance as never);

  /* --------------------------------------------- evidence extraction */

  const missedRequired = (expect.mustMatch ?? []).filter(
    (i) => !matched.includes(i),
  );
  const falsePositives = (expect.mustNotMatch ?? []).filter((i) =>
    matched.includes(i),
  );
  const outOfRange = matched.filter((i) => i < 0 || i >= expected.length);

  const evidenceOk =
    missedRequired.length === 0 &&
    falsePositives.length === 0 &&
    outOfRange.length === 0;

  const evidenceDetail = [
    `matched [${matched.join(",")}]`,
    missedRequired.length > 0 ? `MISSED [${missedRequired.join(",")}]` : "",
    falsePositives.length > 0 ? `FALSE-CREDIT [${falsePositives.join(",")}]` : "",
    outOfRange.length > 0 ? `OUT-OF-RANGE [${outOfRange.join(",")}]` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  /* ------------------------------------------------- safety / invention */

  // Crediting an item the answer does not contain is the single most damaging
  // failure: it inflates a score with evidence that was never given.
  const inventedCredit = falsePositives.length > 0 || outOfRange.length > 0;

  const inventedMentions = (expect.followUpMustNotMention ?? []).filter((m) =>
    norm(`${followUp} ${ack}`).includes(norm(m)),
  );

  const safetyOk = !inventedCredit && inventedMentions.length === 0;

  /* -------------------------------------------------- follow-up quality */

  let followUpPass: boolean | null = null;
  const followUpNotes: string[] = [];

  if (expect.requiresFollowUp) {
    if (followUp.length === 0) {
      followUpPass = false;
      followUpNotes.push("no follow-up drafted where one was required");
    } else {
      const touches =
        !expect.followUpShouldTouch ||
        touchesAny(followUp, expect.followUpShouldTouch);
      const clean = inventedMentions.length === 0;
      // A probe that just restates the question is not a probe.
      const restatesQuestion =
        norm(followUp).replace(/[^a-z ]/g, "").trim() ===
        norm(question.text).replace(/[^a-z ]/g, "").trim();

      followUpPass = touches && clean && !restatesQuestion;
      if (!touches) followUpNotes.push("does not target the expected gap");
      if (!clean) followUpNotes.push(`mentions ${inventedMentions.join(", ")}`);
      if (restatesQuestion) followUpNotes.push("restates the question verbatim");
    }
  } else if (expect.forbidsFollowUp) {
    followUpPass = followUp.length === 0;
    if (!followUpPass) followUpNotes.push("probed an answer that already cleared the bar");
  } else if (followUp.length > 0) {
    followUpPass = inventedMentions.length === 0;
    if (!followUpPass) followUpNotes.push(`mentions ${inventedMentions.join(", ")}`);
  }

  /* ------------------------------------------------------- adaptivity */

  // The model does not choose depth — it earns it by reading the evidence
  // correctly. So adaptivity is measured on the POLICY outcome, which is what
  // the candidate actually experiences.
  const adaptivityPass =
    expect.policyAction === undefined
      ? null
      : expect.policyAction.includes(policyAction);

  /* -------------------------------------------------------- grounding */

  // Grounded = the turn stays inside the question, the answer and the
  // checklist. The invention list is the operational test.
  const groundingPass =
    expect.followUpMustNotMention === undefined && !inventedCredit
      ? null
      : inventedMentions.length === 0 && !inventedCredit;

  /* --------------------------------------------- technical correctness */

  // Only meaningful where the case carries a factual trap.
  let technicalPass: boolean | null = null;
  if (testCase.id === "H1-confident-wrong") {
    // Must not credit any evidence for an inverted explanation. Flagging it is
    // better still, but not required.
    technicalPass = matched.length === 0;
    if (decision.evidence.flaggedIssues.includes("factually_wrong")) {
      technicalPass = true;
    }
  } else if (testCase.id === "F1-self-correct") {
    // The retracted claim (storage saving) must not be credited as item 3's
    // tradeoff unless the corrected sentence earns it.
    technicalPass = matched.includes(0);
  }

  /* ------------------------------------------- conversational quality */

  // The acknowledgement is the only free text the interviewer speaks besides
  // probes. It must exist when moving on, stay short, and never evaluate.
  let conversationalPass: boolean | null = null;
  const noRealAnswer = decision.evidence.flaggedIssues.includes("stuck_or_evasive");
  // The prompt instructs the model to leave the acknowledgement empty when the
  // candidate gave no real answer, so requiring one there would penalise
  // correct instruction-following.
  if (relevance !== "OFF_TOPIC" && !noRealAnswer && decision.action === "NEXT_QUESTION") {
    const evaluative = /\b(great|excellent|perfect|wrong|incorrect|good job|well done|poor)\b/i;
    const tooLong = ack.length > 200;
    conversationalPass = ack.length > 0 && !evaluative.test(ack) && !tooLong;
    if (ack.length === 0) followUpNotes.push("no acknowledgement before moving on");
  }

  /* ----------------------------------------------------- non-repetition */

  let nonRepetitionPass: boolean | null = null;
  if (testCase.priorTurns && testCase.priorTurns.length > 0) {
    const priorInterviewer = testCase.priorTurns
      .filter((t) => t.role === "interviewer")
      .map((t) => norm(t.text));
    const repeats =
      followUp.length > 0 && priorInterviewer.includes(norm(followUp));
    nonRepetitionPass = !repeats;
    if (repeats) followUpNotes.push("re-asked the previous follow-up verbatim");
  }

  return {
    relevance: {
      pass: relevanceOk,
      detail: `${relevance} (expected ${expect.relevance.join("/")})`,
    },
    followUpQuality: {
      pass: followUpPass,
      detail:
        followUpNotes.length > 0
          ? followUpNotes.join("; ")
          : followUp
            ? `"${followUp.slice(0, 70)}"`
            : "none",
    },
    adaptivity: {
      pass: adaptivityPass,
      detail: `policy=${policyAction}${
        expect.policyAction ? ` (expected ${expect.policyAction.join("/")})` : ""
      }`,
    },
    grounding: {
      pass: groundingPass,
      detail:
        inventedMentions.length > 0
          ? `invented: ${inventedMentions.join(", ")}`
          : "stayed within the question and answer",
    },
    evidenceExtraction: { pass: evidenceOk, detail: evidenceDetail },
    technicalCorrectness: {
      pass: technicalPass,
      detail:
        technicalPass === null
          ? "n/a"
          : technicalPass
            ? "handled the factual trap"
            : "credited an incorrect explanation",
    },
    conversationalQuality: {
      pass: conversationalPass,
      detail:
        conversationalPass === null
          ? "n/a"
          : ack
            ? `"${ack.slice(0, 60)}"`
            : "missing acknowledgement",
    },
    nonRepetition: {
      pass: nonRepetitionPass,
      detail: nonRepetitionPass === null ? "n/a" : nonRepetitionPass ? "new probe" : "repeated",
    },
    safetyNonInvention: {
      pass: safetyOk,
      detail: inventedCredit
        ? `credited unearned evidence [${[...falsePositives, ...outOfRange].join(",")}]`
        : inventedMentions.length > 0
          ? `invented: ${inventedMentions.join(", ")}`
          : "no invention",
    },
  };
}

/** Pass rate per dimension, ignoring cases where the dimension does not apply. */
export function aggregate(scores: CaseScore[]): Record<
  Dimension,
  { pass: number; applicable: number; rate: number | null }
> {
  const out = {} as Record<
    Dimension,
    { pass: number; applicable: number; rate: number | null }
  >;
  for (const dim of DIMENSIONS) {
    const applicable = scores.filter((s) => s[dim].pass !== null);
    const pass = applicable.filter((s) => s[dim].pass === true).length;
    out[dim] = {
      pass,
      applicable: applicable.length,
      rate: applicable.length === 0 ? null : pass / applicable.length,
    };
  }
  return out;
}
