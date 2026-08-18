import {
  heuristicEvidence,
  isBlankAnswer,
  looksLikeRepeatRequest,
  looksOffTopic,
  looksStuck,
} from "@/features/interview/agent/llm/heuristics";
import type { InterviewDecision, LlmAction } from "@/features/interview/agent/types";
import type {
  AnalyzeAnswerInput,
  InterviewLLM,
} from "@/features/interview/agent/llm/provider";

/**
 * Deterministic stand-in for a real model.
 *
 * Used by the verification script and by local development without an API key.
 * It is NOT a simulation of model quality — it is a fixed function of the
 * answer text, which is exactly what a test needs: the same input always routes
 * the same way, so a failing routing test means the POLICY changed, never that
 * the model had an off day.
 *
 * Pure: no network, no `server-only`, no environment variables.
 */
export function createMockInterviewLLM(
  overrides: Partial<Record<string, InterviewDecision>> = {},
): InterviewLLM {
  return {
    name: "mock",
    async analyzeAnswer(input: AnalyzeAnswerInput): Promise<InterviewDecision> {
      const canned = overrides[input.answerText.trim()];
      if (canned) return canned;

      const { answerText, question, followUpsRemaining } = input;
      const evidence = heuristicEvidence(answerText);

      let action: LlmAction = "NEXT_QUESTION";
      let followUpQuestion: string | null = null;

      if (looksOffTopic(answerText)) {
        action = "REDIRECT";
      } else if (looksLikeRepeatRequest(answerText)) {
        action = "REPEAT";
      } else if (isBlankAnswer(answerText) || looksStuck(answerText)) {
        action = "NEXT_QUESTION";
      } else if (
        followUpsRemaining > 0 &&
        !(evidence.practicalFound && evidence.conceptualFound)
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
        action === "NEXT_QUESTION" && !evidence.flaggedIssues.includes("off_topic")
          ? "Okay, thanks for talking me through that."
          : null;

      return {
        action,
        reason: "Mock provider decision.",
        evidence,
        followUpQuestion,
        acknowledgement,
        confidence: 0.5,
        degraded: false,
      };
    },
  };
}
