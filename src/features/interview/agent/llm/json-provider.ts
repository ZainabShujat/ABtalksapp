import { logger } from "@/lib/logger";
import {
  interviewDecisionSchema,
  type InterviewDecision,
} from "@/features/interview/agent/types";
import {
  ANALYZE_SYSTEM_PROMPT,
  STRICT_JSON_REMINDER,
  buildAnalyzeUserMessage,
} from "@/features/interview/agent/llm/prompt";
import { fallbackDecision } from "@/features/interview/agent/llm/heuristics";
import type {
  AnalyzeAnswerInput,
  InterviewLLM,
} from "@/features/interview/agent/llm/provider";

/**
 * A generic JSON-completion provider.
 *
 * Any model vendor that can be reduced to "send system + user, get JSON back"
 * plugs in here by supplying `askJson`. Anthropic, Groq, OpenAI and Gemini all
 * fit that shape, which is why there is one validation/retry/fallback path
 * instead of one per SDK.
 *
 * Pure module — no `server-only`, no SDK import — so the malformed-output path
 * is testable by injecting a fake `askJson`.
 */

export type AskJson = (args: {
  system: string;
  user: string;
  maxTokens: number;
}) => Promise<
  | { ok: true; data: unknown }
  /**
   * `retryable: false` means a second immediate attempt cannot succeed — a quota
   * or rate-limit rejection, say. Retrying those does not just waste time, it
   * spends another request against the very limit that caused the failure.
   */
  | { ok: false; message: string; retryable?: boolean }
>;

export type JsonProviderOptions = {
  name: string;
  askJson: AskJson;
  maxTokens?: number;
  /** Extra attempts after the first. One retry is enough; more just burns time. */
  retries?: number;
};

/**
 * Validation is the whole point of this function. A model response becomes an
 * `InterviewDecision` only by passing the schema; there is no path where raw
 * model fields reach the graph.
 */
function validate(raw: unknown): InterviewDecision | null {
  const parsed = interviewDecisionSchema.safeParse(raw);
  if (!parsed.success) return null;

  const followUp = (parsed.data.followUpQuestion ?? "").trim();
  return {
    action: parsed.data.action,
    reason: parsed.data.reason,
    evidence: parsed.data.evidence,
    followUpQuestion: followUp.length > 0 ? followUp : null,
    acknowledgement: (parsed.data.acknowledgement ?? "").trim() || null,
    confidence: parsed.data.confidence ?? null,
    degraded: false,
  };
}

export function createJsonInterviewLLM(
  options: JsonProviderOptions,
): InterviewLLM {
  const { name, askJson, maxTokens = 700, retries = 1 } = options;

  return {
    name,
    async analyzeAnswer(input: AnalyzeAnswerInput): Promise<InterviewDecision> {
      const user = buildAnalyzeUserMessage(input);

      for (let attempt = 0; attempt <= retries; attempt++) {
        const system =
          attempt === 0
            ? ANALYZE_SYSTEM_PROMPT
            : `${ANALYZE_SYSTEM_PROMPT}\n\n${STRICT_JSON_REMINDER}`;

        // A provider that throws is a provider that ends someone's interview.
        // Treat an exception exactly like a failed response.
        let result: Awaited<ReturnType<AskJson>>;
        try {
          result = await askJson({ system, user, maxTokens });
        } catch (error) {
          result = { ok: false, message: String(error) };
        }

        if (!result.ok) {
          logger.warn("[interview-agent] llm call failed", {
            provider: name,
            attempt,
            questionId: input.question.id,
            message: result.message,
          });
          if (result.retryable === false) break;
          continue;
        }

        const decision = validate(result.data);
        if (decision) {
          if (attempt > 0) {
            logger.info("[interview-agent] llm recovered on retry", {
              provider: name,
              questionId: input.question.id,
            });
          }
          return decision;
        }

        logger.warn("[interview-agent] llm returned malformed decision", {
          provider: name,
          attempt,
          questionId: input.question.id,
        });
      }

      logger.warn("[interview-agent] falling back to deterministic decision", {
        provider: name,
        questionId: input.question.id,
      });
      return fallbackDecision(input);
    },
  };
}
