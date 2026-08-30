import { createJsonInterviewLLM } from "@/features/interview/agent/llm/json-provider";
import type { InterviewLLM } from "@/features/interview/agent/llm/provider";

/**
 * OpenAI-backed interview judge.
 *
 * This is the strongest reader of an answer this project has access to, and it
 * is the same key the room already uses for speech, so an interview that can
 * hear the candidate can now also be graded properly. Before this existed the
 * registry knew about Groq, Gemini and Anthropic only — so a deployment holding
 * nothing but `OPENAI_API_KEY` transcribed and spoke through OpenAI and then
 * handed the actual assessment to the mock, which scores everyone the same.
 *
 * Chat Completions rather than the Responses API on purpose: the whole point of
 * `createJsonInterviewLLM` is that every vendor collapses to "system + user in,
 * one JSON object out", and chat/completions is the shape all four adapters
 * already speak. Validation, the single retry and the deterministic fallback
 * all still live in the shared provider.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/**
 * The default judge.
 *
 * `gpt-4o` rather than `gpt-4o-mini`: this call decides how much of a
 * candidate's answer counted as evidence, and the mini model is measurably
 * looser about matching a spoken, rambling answer to a checklist item. One
 * interview is roughly thirty of these calls, which is cents — a wrong evidence
 * read costs a candidate their score. Override per environment when that trade
 * changes.
 */
export const DEFAULT_OPENAI_MODEL = "gpt-4o";

type ChatCompletion = {
  choices?: { message?: { content?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

/**
 * Running token total for this process, by model.
 *
 * The interview runs on a metered, prepaid key, and until now the only way to
 * learn what one interview cost was to read the billing page the next day.
 * Accumulating what the API itself reports turns "roughly thirty calls, maybe"
 * into a measured number — which is what capacity planning against a fixed
 * balance actually needs. Cheap: two integers per call, no I/O.
 */
export type TokenUsage = { calls: number; promptTokens: number; completionTokens: number };

const usageByModel = new Map<string, TokenUsage>();

export function recordUsage(
  model: string,
  promptTokens: number,
  completionTokens: number,
): void {
  const current = usageByModel.get(model) ?? {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
  };
  current.calls += 1;
  current.promptTokens += promptTokens;
  current.completionTokens += completionTokens;
  usageByModel.set(model, current);
}

/** Snapshot of everything spent so far in this process. */
export function readUsage(): Record<string, TokenUsage> {
  return Object.fromEntries(usageByModel);
}

export function resetUsage(): void {
  usageByModel.clear();
}

/** The first balanced JSON object in a string. */
function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Milliseconds to wait after a 429, read from the header. Bounded. */
function retryAfterMs(header: string | null): number {
  const seconds = header ? Number(header) : NaN;
  return Number.isFinite(seconds) ? Math.min(seconds * 1000 + 250, 20_000) : 3_000;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createOpenAiInterviewLLM(
  apiKey: string,
  model: string = DEFAULT_OPENAI_MODEL,
): InterviewLLM {
  return createJsonInterviewLLM({
    name: `openai:${model}`,
    async askJson({ system, user, maxTokens, temperature }) {
      const attempt = () =>
        fetch(OPENAI_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            // Assessment defaults to zero: two candidates giving the same
            // answer must get the same evidence read, or the interview stops
            // being comparable. Phrasing overrides it — see AskJson.
            temperature: temperature ?? 0,
            // The system prompt already says "Return ONLY a JSON object", which
            // is what json_object mode requires the conversation to contain.
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
          signal: AbortSignal.timeout(30_000),
        });

      try {
        let res = await attempt();

        // A rate limit mid-interview would otherwise route this answer to the
        // keyword heuristic, which scores a good candidate near zero. Waiting
        // the advertised interval once is far cheaper than that.
        if (res.status === 429) {
          await sleep(retryAfterMs(res.headers.get("retry-after")));
          res = await attempt();
        }

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          return {
            ok: false,
            message: `OpenAI HTTP ${res.status}: ${body.slice(0, 200)}`,
            // Quota and rate limits cannot succeed on an immediate retry; they
            // would only spend more of the budget that caused the failure.
            retryable: res.status !== 429 && res.status !== 402,
          };
        }

        const json = (await res.json()) as ChatCompletion;
        recordUsage(
          model,
          json.usage?.prompt_tokens ?? 0,
          json.usage?.completion_tokens ?? 0,
        );
        const content = json.choices?.[0]?.message?.content ?? "";
        const slice = extractJson(content);
        if (!slice) return { ok: false, message: "OpenAI returned no JSON object." };

        return { ok: true, data: JSON.parse(slice) };
      } catch (error) {
        return { ok: false, message: `OpenAI call failed: ${String(error)}` };
      }
    },
  });
}
