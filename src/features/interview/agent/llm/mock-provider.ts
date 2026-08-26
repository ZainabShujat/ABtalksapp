import {
  looksLikeAudioCheck,
  looksLikeClarifyRequest,
  heuristicEvidence,
  isBlankAnswer,
  looksLikeRepeatRequest,
  looksStuck,
} from "@/features/interview/agent/llm/heuristics";
import type { InterviewDecision, LlmAction } from "@/features/interview/agent/types";
import type { Relevance } from "@/features/interview/types";
import type {
  AnalyzeAnswerInput,
  InterviewLLM,
} from "@/features/interview/agent/llm/provider";

/**
 * Deterministic stand-in for a real model.
 *
 * Used by the verification scripts and by local development without an API key.
 * It is NOT a simulation of model quality — it is a fixed function of the
 * answer text, which is exactly what a test needs: the same input always routes
 * the same way, so a failing routing test means the POLICY changed, never that
 * the model had an off day.
 *
 * It does have to produce the two judgments the depth ladder now depends on —
 * which expected-evidence items an answer covered, and whether it was on topic.
 * Both are computed by word overlap AGAINST THE QUESTION'S OWN TEXT, never
 * against a hardcoded list of off-topic subjects. That distinction matters: a
 * topic list is the thing this feature is not allowed to have, and overlap
 * against the live question keeps the mock honest about what it is (arithmetic,
 * not comprehension).
 *
 * Pure: no network, no `server-only`, no environment variables.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this",
  "these", "those", "is", "are", "was", "were", "be", "been", "being", "to",
  "of", "in", "on", "for", "with", "as", "by", "at", "from", "it", "its",
  "you", "your", "i", "we", "they", "he", "she", "them", "my", "our", "me",
  "do", "does", "did", "done", "have", "has", "had", "can", "could", "would",
  "should", "will", "what", "which", "who", "when", "where", "why", "how",
  "not", "no", "yes", "so", "up", "out", "about", "into", "over", "any",
  "all", "some", "one", "two", "there", "their", "just", "also", "more",
]);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_.-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Fraction of `needle`'s content words that appear in `haystack`. */
function overlapRatio(needle: string, haystackWords: Set<string>): number {
  const words = contentWords(needle);
  if (words.length === 0) return 0;
  const hits = words.filter((w) => haystackWords.has(w)).length;
  return hits / words.length;
}

/**
 * Which checklist items the answer plausibly covered.
 *
 * The threshold is deliberately forgiving on short items and stricter on long
 * ones (a ratio, not a count), because a four-word expected item is fully
 * covered by two matching words while a twelve-word one is not.
 */
function matchExpectedEvidence(
  answerText: string,
  expected: readonly string[] | undefined,
): number[] {
  if (!expected || expected.length === 0) return [];
  const answerWords = new Set(contentWords(answerText));

  return expected
    .map((item, index) => ({ index, ratio: overlapRatio(item, answerWords) }))
    .filter((e) => e.ratio >= 0.34)
    .map((e) => e.index);
}

function judgeRelevance(
  answerText: string,
  input: AnalyzeAnswerInput,
  matched: number[],
): Relevance {
  if (matched.length > 0) return "ON_TOPIC";

  const answerWords = new Set(contentWords(answerText));
  const questionOverlap = overlapRatio(input.question.text, answerWords);

  if (questionOverlap > 0) {
    return questionOverlap < 0.12 ? "PARTIAL" : "ON_TOPIC";
  }

  // Zero overlap on its own is NOT enough to call something off-topic. A weak
  // candidate answers vaguely — "it was just easier that way" — sharing no
  // vocabulary with the question while genuinely trying. Redirecting them would
  // be the cruellest possible misread, and it is exactly the case a scaffold
  // exists for.
  //
  // So a digression has to look like one: the candidate turning a question back
  // on the interviewer, or holding forth at length about something else.
  const asksTheInterviewer = answerText.includes("?");
  const substantialTangent = contentWords(answerText).length >= 8;

  if (asksTheInterviewer || substantialTangent) return "OFF_TOPIC";
  return "PARTIAL";
}

export function createMockInterviewLLM(
  overrides: Partial<Record<string, InterviewDecision>> = {},
): InterviewLLM {
  return {
    name: "mock",
    async analyzeAnswer(input: AnalyzeAnswerInput): Promise<InterviewDecision> {
      const canned = overrides[input.answerText.trim()];
      if (canned) return canned;

      const { answerText, question, followUpsRemaining } = input;
      const base = heuristicEvidence(answerText);

      const stuck = isBlankAnswer(answerText) || looksStuck(answerText);
      // A repeat request shares no vocabulary with the question, so relevance
      // scoring would call it off-topic. It is neither an answer nor a
      // digression — it is a request to hear the question again.
      const repeatRequest = looksLikeRepeatRequest(answerText);
      const audioCheck = looksLikeAudioCheck(answerText);
      const clarifyRequest =
        !repeatRequest && looksLikeClarifyRequest(answerText);

      const matchedEvidence =
        stuck || repeatRequest || clarifyRequest
          ? []
          : matchExpectedEvidence(answerText, question.expectedEvidence);
      const relevance: Relevance =
        stuck || repeatRequest || clarifyRequest
          ? "ON_TOPIC"
          : judgeRelevance(answerText, input, matchedEvidence);

      const evidence = {
        ...base,
        matchedEvidence,
        relevance,
        flaggedIssues:
          relevance === "OFF_TOPIC"
            ? [...new Set([...base.flaggedIssues, "off_topic" as const])]
            : base.flaggedIssues,
      };

      let action: LlmAction = "NEXT_QUESTION";
      let followUpQuestion: string | null = null;
      let clarification: string | null = null;

      if (audioCheck) {
        action = "CLARIFY";
        clarification = "Yes, I can hear you clearly.";
      } else if (repeatRequest) {
        action = "REPEAT";
      } else if (clarifyRequest) {
        action = "CLARIFY";
        clarification =
          "That refers to the specific approach named in the question, as opposed to the alternative it is being compared with.";
      } else if (relevance === "OFF_TOPIC") {
        action = "REDIRECT";
      } else if (stuck) {
        action = "NEXT_QUESTION";
      } else if (
        followUpsRemaining > 0 &&
        matchedEvidence.length < (question.minEvidence ?? 1)
      ) {
        action = "FOLLOW_UP";
        followUpQuestion =
          question.followUpPrompt ??
          "Can you give me a specific example from your own work?";
      }

      // A canned but non-evaluative line, so the offline demo still shows the
      // interviewer reacting before it moves on. A real provider writes
      // something specific to the answer.
      const acknowledgement =
        action === "NEXT_QUESTION" && relevance !== "OFF_TOPIC"
          ? "Okay, thanks for talking me through that."
          : null;

      return {
        action,
        reason: `Mock: matched ${matchedEvidence.length}/${
          question.expectedEvidence?.length ?? 0
        } expected items, relevance ${relevance}.`,
        evidence,
        followUpQuestion,
        acknowledgement,
        clarification,
        confidence: 0.5,
        degraded: false,
      };
    },
  };
}
