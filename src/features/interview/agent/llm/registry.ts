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
import {
  createOpenAiInterviewLLM,
  DEFAULT_OPENAI_MODEL,
} from "@/features/interview/agent/llm/openai-provider";
import type { InterviewLLM } from "@/features/interview/agent/llm/provider";

/**
 * The single place that decides which model backs a live interview.
 *
 * Resolution is by configuration, never by request input — a candidate cannot
 * ask to be graded by a weaker model. Adding a vendor means one adapter file and
 * one case here; no node, policy or test changes.
 *
 * `INTERVIEW_LLM_PROVIDER` = `openai` | `groq` | `gemini` | `anthropic` |
 * `mock`. Unset falls back to whichever key is present, preferring OpenAI, then
 * Groq, then Gemini, then Anthropic, and finally to the mock.
 *
 * OpenAI is preferred on autodetect because it is both the best reader of a
 * spoken answer available here and the key the voice layer already requires —
 * a deployment that can hear the candidate can therefore also grade them.
 * Groq comes next for a boring operational reason discovered the hard way: the
 * Gemini free tier allows 15 requests a day and one interview needs about
 * thirty, so a Gemini-backed session runs out of quota partway and finishes on
 * keyword heuristics — which scores a good candidate near zero. A provider that
 * cannot complete a session is not a usable default.
 *
 * The mock fallback keeps local development usable, and it is logged loudly
 * because a mock-graded interview is not a real result.
 */
export function resolveInterviewLLM(): InterviewLLM {
  const configured = (process.env.INTERVIEW_LLM_PROVIDER ?? "").toLowerCase();

  switch (configured) {
    case "mock":
      return createMockInterviewLLM();

    case "openai":
      return openAiOrMock();

    case "groq":
      return groqOrMock();

    case "gemini":
      return geminiOrMock();

    case "anthropic":
      if (process.env.ANTHROPIC_API_KEY) return createAnthropicInterviewLLM();
      logger.warn("[interview-agent] anthropic selected but no ANTHROPIC_API_KEY");
      return createMockInterviewLLM();

    case "":
      // OpenAI ONLY on autodetect. This deliberately does NOT walk down to the
      // free tiers.
      //
      // A 15-minute assessment cannot survive a mid-session quota rejection:
      // Gemini's free tier allows ~15 requests a day against roughly thirty per
      // interview, Groq rate-limits under ordinary load, and Anthropic currently
      // reports a zero credit balance. A candidate whose interview degrades
      // halfway through is scored on a different instrument than the person
      // before them, which is worse than the interview not starting at all.
      //
      // The helper chatbot keeps its four-provider chain — a support answer can
      // tolerate a retry; a graded interview cannot. See
      // src/lib/chatbot/providers.ts.
      if (process.env.OPENAI_API_KEY) return openAiOrMock();
      logger.warn(
        "[interview-agent] no OPENAI_API_KEY — using mock; results are NOT real. " +
          "Free-tier providers are deliberately not used for interviews.",
      );
      return createMockInterviewLLM();

    default:
      logger.warn("[interview-agent] unknown INTERVIEW_LLM_PROVIDER, using mock", {
        configured,
      });
      return createMockInterviewLLM();
  }
}

function openAiOrMock(): InterviewLLM {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    logger.warn("[interview-agent] openai selected but no OPENAI_API_KEY");
    return createMockInterviewLLM();
  }
  return createOpenAiInterviewLLM(
    key,
    process.env.OPENAI_INTERVIEW_MODEL ?? DEFAULT_OPENAI_MODEL,
  );
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
