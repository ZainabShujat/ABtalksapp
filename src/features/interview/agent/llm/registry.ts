import "server-only";
import { logger } from "@/lib/logger";
import { createAnthropicInterviewLLM } from "@/features/interview/agent/llm/anthropic-provider";
import {
  createGeminiInterviewLLM,
  DEFAULT_GEMINI_MODEL,
} from "@/features/interview/agent/llm/gemini-provider";
import {
  createGroqInterviewLLM,
  DEFAULT_GROQ_MODEL,
} from "@/features/interview/agent/llm/groq-provider";
import { createMockInterviewLLM } from "@/features/interview/agent/llm/mock-provider";
import type { InterviewLLM } from "@/features/interview/agent/llm/provider";

/**
 * The single place that decides which model backs a live interview.
 *
 * Resolution is by configuration, never by request input — a candidate cannot
 * ask to be graded by a weaker model. Adding a vendor means one adapter file and
 * one case here; no node, policy or test changes.
 *
 * `INTERVIEW_LLM_PROVIDER` = `groq` | `gemini` | `anthropic` | `mock`. Unset
 * falls back to whichever key is present, preferring Groq, then Gemini, then
 * Anthropic, and finally to the mock.
 *
 * Groq is preferred on autodetect for a boring operational reason discovered
 * the hard way: the Gemini free tier allows 15 requests a day and one interview
 * needs about thirty, so a Gemini-backed session runs out of quota partway and
 * finishes on keyword heuristics — which scores a good candidate near zero. A
 * provider that cannot complete a session is not a usable default.
 *
 * The mock fallback keeps local development usable, and it is logged loudly
 * because a mock-graded interview is not a real result.
 */
export function resolveInterviewLLM(): InterviewLLM {
  const configured = (process.env.INTERVIEW_LLM_PROVIDER ?? "").toLowerCase();

  switch (configured) {
    case "mock":
      return createMockInterviewLLM();

    case "groq":
      return groqOrMock();

    case "gemini":
      return geminiOrMock();

    case "anthropic":
      if (process.env.ANTHROPIC_API_KEY) return createAnthropicInterviewLLM();
      logger.warn("[interview-agent] anthropic selected but no ANTHROPIC_API_KEY");
      return createMockInterviewLLM();

    case "":
      if (process.env.GROQ_API_KEY) return groqOrMock();
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

function groqOrMock(): InterviewLLM {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    logger.warn("[interview-agent] groq selected but no GROQ_API_KEY");
    return createMockInterviewLLM();
  }
  return createGroqInterviewLLM(
    key,
    process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
  );
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
