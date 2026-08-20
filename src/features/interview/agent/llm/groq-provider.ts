import { createJsonInterviewLLM } from "@/features/interview/agent/llm/json-provider";
import type { InterviewLLM } from "@/features/interview/agent/llm/provider";

/**
 * Groq-backed interview judge.
 *
 * Added because it is the only reasoning provider this project currently has
 * working credit on: the Gemini key is capped at 15 free requests a day (one
 * interview needs roughly thirty) and the Anthropic key reports a zero credit
 * balance. An interview that silently falls back to keyword heuristics scores
 * every candidate near zero, so provider availability is a correctness
 * concern here, not just an operational one.
 *
 * Groq speaks the OpenAI chat-completions shape, so this is a thin adapter over
 * the shared `createJsonInterviewLLM`: validation, the single retry and the
 * deterministic fallback all still live there.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Fast, cheap, and reliable at JSON-mode output. */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

type ChatCompletion = {
  choices?: { message?: { content?: string } }[];
};

/**
 * The first balanced JSON object in a string.
 *
 * Needed because the strict `response_format` is not always usable (see below),
 * and without it a model may wrap the object in a sentence or a code fence.
 */
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

/** Milliseconds to wait after a 429, read from the body or header. Bounded. */
function retryAfterMs(body: string, header: string | null): number {
  const fromHeader = header ? Number(header) : NaN;
  if (Number.isFinite(fromHeader)) return Math.min(fromHeader * 1000, 20_000);
  const match = body.match(/try again in ([0-9.]+)s/i);
  const seconds = match ? Number(match[1]) : NaN;
  return Number.isFinite(seconds) ? Math.min(seconds * 1000 + 250, 20_000) : 3_000;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createGroqInterviewLLM(
  apiKey: string,
  model: string = DEFAULT_GROQ_MODEL,
): InterviewLLM {
  return createJsonInterviewLLM({
    name: `groq:${model}`,
    async askJson({ system, user, maxTokens }) {
      /**
       * One attempt. `strictJson` asks Groq to enforce JSON server-side.
       *
       * That enforcement is not always usable: gpt-oss intermittently returns
       * HTTP 400 `json_validate_failed` with an EMPTY `failed_generation` —
       * rejecting its own output. A failure of strict mode therefore retries
       * once in free-text mode, where the object is extracted locally. The
       * prompt demands bare JSON either way.
       */
      const attempt = (strictJson: boolean) =>
        fetch(GROQ_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            // Zero temperature: two candidates giving the same answer must get
            // the same evidence read, or the interview stops being comparable.
            temperature: 0,
            // This model reasons before answering, and those tokens count
            // against a tokens-per-minute budget a 25-turn interview can
            // exhaust. The task is extraction against a supplied checklist,
            // not open reasoning, so low effort costs nothing that matters.
            reasoning_effort: "low",
            ...(strictJson ? { response_format: { type: "json_object" } } : {}),
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
          signal: AbortSignal.timeout(30_000),
        });

      try {
        let res = await attempt(true);

        if (res.status === 400) {
          const body = await res.text().catch(() => "");
          if (!body.includes("json_validate_failed")) {
            return { ok: false, message: `Groq HTTP 400: ${body.slice(0, 200)}` };
          }
          res = await attempt(false);
        }

        // The free tier caps tokens per minute and an interview is bursty.
        // Waiting the advertised interval and trying once more beats degrading
        // a candidate's answer to a keyword heuristic because the minute
        // boundary happened to fall mid-question.
        if (res.status === 429) {
          const body = await res.text().catch(() => "");
          await sleep(retryAfterMs(body, res.headers.get("retry-after")));
          res = await attempt(false);
        }

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          return {
            ok: false,
            message: `Groq HTTP ${res.status}: ${body.slice(0, 200)}`,
            // A rate limit was already waited out above; an immediate third
            // attempt would only spend more of the budget that caused it.
            retryable: res.status !== 429 && res.status !== 402,
          };
        }

        const json = (await res.json()) as ChatCompletion;
        const content = json.choices?.[0]?.message?.content ?? "";
        const slice = extractJson(content);
        if (!slice) {
          return { ok: false, message: "Groq returned no JSON object." };
        }

        return { ok: true, data: JSON.parse(slice) };
      } catch (error) {
        return { ok: false, message: `Groq call failed: ${String(error)}` };
      }
    },
  });
}
