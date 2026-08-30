import { logger } from "@/lib/logger";
import {
  interviewDecisionSchema,
  type InterviewDecision,
} from "@/features/interview/agent/types";
import {
  ANALYZE_SYSTEM_PROMPT,
  STRICT_JSON_REMINDER,
  buildAnalyzeUserMessage,
  buildPhraseUserMessage,
  PHRASE_SYSTEM_PROMPT,
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
  /**
   * Omitted means 0, which is what ASSESSMENT needs: two candidates giving the
   * same answer must get the same evidence read, or the interview stops being
   * comparable. Only question PHRASING overrides it, where the whole point is
   * that no two interviews open with the same sentence.
   */
  temperature?: number;
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
/**
 * Turns whatever the model wrote for `matchedEvidence` into 0-based indices.
 *
 * Models are unreliable about this one field in a specific, repeatable way:
 * gpt-oss-120b writes `[123]` when it means items 1, 2 and 3, and no amount of
 * prompt instruction has stopped it. Other models emit `"1,2,3"` as a string.
 * Rather than lose a correct evidence read to a formatting habit, the parsing
 * is lenient — but it is NOT guesswork:
 *
 *   - a run of digits is only split when EVERY digit is a real item number,
 *     which is checkable because a checklist never has more than nine items
 *   - anything that does not resolve to a real item is dropped
 *
 * So the worst case is that a claim is ignored, never that one is invented.
 */
export function coerceMatchedEvidence(raw: unknown, expectedCount: number): number[] {
  if (expectedCount === 0) return [];

  const tokens: number[] = [];

  const pushToken = (value: unknown) => {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
      tokens.push(value);
      return;
    }
    if (typeof value === "string") {
      for (const part of value.split(/[^0-9]+/)) {
        if (part.length > 0) tokens.push(Number(part));
      }
    }
  };

  if (Array.isArray(raw)) raw.forEach(pushToken);
  else pushToken(raw);

  const out = new Set<number>();
  for (const token of tokens) {
    // In range as written: the ordinary case.
    if (token >= 1 && token <= expectedCount) {
      out.add(token - 1);
      continue;
    }

    // Out of range: it may be concatenated ordinals. Only accept that reading
    // when every digit is itself a valid item number, and only for checklists
    // small enough that the reading is unambiguous.
    if (expectedCount <= 9 && token > expectedCount) {
      const digits = String(token).split("");
      const allValid = digits.every((d) => {
        const n = Number(d);
        return n >= 1 && n <= expectedCount;
      });
      if (allValid) {
        for (const d of digits) out.add(Number(d) - 1);
      }
    }
  }

  return [...out].sort((a, b) => a - b);
}

function validate(
  raw: unknown,
  input: AnalyzeAnswerInput,
): InterviewDecision | null {
  const parsed = interviewDecisionSchema.safeParse(raw);
  if (!parsed.success) return null;

  const followUp = (parsed.data.followUpQuestion ?? "").trim();

  // The prompt numbers the checklist from 1 because models count that way;
  // everything downstream indexes from 0. A number that does not address a real
  // item is dropped, so a model that invents "item 9" on a four-item checklist
  // cannot inflate the evidence count the score is computed from.
  const expectedCount = input.question.expectedEvidence?.length ?? 0;
  const matchedEvidence = coerceMatchedEvidence(
    parsed.data.evidence.matchedEvidence,
    expectedCount,
  );

  return {
    action: parsed.data.action,
    reason: parsed.data.reason,
    evidence: { ...parsed.data.evidence, matchedEvidence },
    followUpQuestion: followUp.length > 0 ? followUp : null,
    acknowledgement: (parsed.data.acknowledgement ?? "").trim() || null,
    clarification: (parsed.data.clarification ?? "").trim() || null,
    simplified: (parsed.data.simplified ?? "").trim() || null,
    bridge: (parsed.data.bridge ?? "").trim() || null,
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

    async phraseQuestions(input) {
      // One call for the whole plan. Per-question calls would multiply latency
      // by ten at the moment the candidate is waiting for the interview to open.
      try {
        const res = await askJson({
          system: PHRASE_SYSTEM_PROMPT,
          user: buildPhraseUserMessage(input),
          // Every target must fit in ONE response. A cap that truncates the
          // JSON does not degrade gracefully: the parse fails, the map comes
          // back empty, and every question is asked exactly as authored — the
          // failure looks like "the LLM changed nothing", not like an error.
          maxTokens: 200 * input.targets.length + 600,
          // High, deliberately. Assessment must be reproducible; phrasing must
          // NOT be. At zero, two candidates with similar submissions were asked
          // word-for-word identical questions, which is what made the
          // interviewer sound scripted.
          temperature: 0.9,
        });
        if (!res.ok) {
          logger.warn("[interview-agent] question phrasing rejected", {
            provider: name,
            message: res.message,
            targets: input.targets.length,
          });
          return {};
        }

        const parsed = res.data;
        if (!parsed || typeof parsed !== "object") return {};

        const out: Record<string, string> = {};
        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value === "string" && value.trim().length > 0) {
            out[id] = value.trim();
          }
        }
        return out;
      } catch (err) {
        // Never throws: an empty map means every question is asked as authored,
        // which is a working interview rather than a failed one.
        logger.warn("[interview-agent] question phrasing failed", {
          provider: name,
          error: err instanceof Error ? err.message : String(err),
        });
        return {};
      }
    },

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

        const decision = validate(result.data, input);
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
