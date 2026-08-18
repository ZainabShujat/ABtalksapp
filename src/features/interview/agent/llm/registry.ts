import "server-only";
import { logger } from "@/lib/logger";
import { createAnthropicInterviewLLM } from "@/features/interview/agent/llm/anthropic-provider";
import {
  createGeminiInterviewLLM,
  DEFAULT_GEMINI_MODEL,
} from "@/features/interview/agent/llm/gemini-provider";
import { createMockInterviewLLM } from "@/features/interview/agent/llm/mock-provider";
import type { InterviewLLM } from "@/features/interview/agent/llm/provider";

/**
 * The single place that decides which model backs a live interview.
 *
 * Resolution is by configuration, never by request input — a candidate cannot
 * ask to be graded by a weaker model. Adding a vendor means one adapter file and
 * one case here; no node, policy or test changes.
 *
 * `INTERVIEW_LLM_PROVIDER` = `gemini` | `anthropic` | `mock`. Unset falls back to
 * whichever key is present, preferring Gemini, and finally to the mock. The mock
 * fallback keeps local development and preview deploys usable, and it is logged
 * loudly because a mock-graded interview is not a real result.
 */
export function resolveInterviewLLM(): InterviewLLM {
  const configured = (process.env.INTERVIEW_LLM_PROVIDER ?? "").toLowerCase();

  switch (configured) {
    case "mock":
      return createMockInterviewLLM();

    case "gemini":
      return geminiOrMock();

    case "anthropic":
      if (process.env.ANTHROPIC_API_KEY) return createAnthropicInterviewLLM();
      logger.warn("[interview-agent] anthropic selected but no ANTHROPIC_API_KEY");
      return createMockInterviewLLM();

    case "":
      if (process.env.GEMINI_API_KEY) return geminiOrMock();
      if (process.env.ANTHROPIC_API_KEY) return createAnthropicInterviewLLM();
      logger.warn(
        "[interview-agent] no provider key configured — using mock; results are not real",
      );
      return createMockInterviewLLM();

    default:
      logger.warn("[interview-agent] unknown INTERVIEW_LLM_PROVIDER, using mock", {
        configured,
      });
      return createMockInterviewLLM();
  }
}

function geminiOrMock(): InterviewLLM {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    logger.warn("[interview-agent] gemini selected but no GEMINI_API_KEY");
    return createMockInterviewLLM();
  }
  return createGeminiInterviewLLM(
    key,
    process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
  );
}
