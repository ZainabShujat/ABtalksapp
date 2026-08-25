import "server-only";

import { logger } from "@/lib/logger";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-120b";

/**
 * A Server Action blocks the recruiter's UI while this runs, so a slow or wedged
 * upstream must never outlast a click. Groq answers this prompt in ~1.5s; past
 * this budget the caller is better served by its deterministic fallback.
 */
const DEFAULT_TIMEOUT_MS = 8000;

export type GroqMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GroqJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export function groqApiKeys(): string[] {
  return [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
  ].filter((k): k is string => Boolean(k && k.trim()));
}

export function groqConfigured(): boolean {
  return groqApiKeys().length > 0;
}

/**
 * Chat completion constrained to a JSON Schema (Groq's OpenAI-compatible
 * structured outputs). The model cannot return prose or a differently shaped
 * object, so callers get either well-formed data or a clean failure.
 *
 * `strict: true` requires every property to be listed in `required` and
 * `additionalProperties: false` on each object — express optional fields as a
 * nullable type rather than by omitting them.
 */
export async function askGroqJson<T>(opts: {
  system: string;
  messages: GroqMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  /** Ignored by models without a reasoning stage. */
  reasoningEffort?: "low" | "medium" | "high";
  timeoutMs?: number;
}): Promise<GroqJsonResult<T>> {
  const keys = groqApiKeys();
  if (keys.length === 0) return { ok: false, message: "AI is not configured." };

  const model = process.env.HIRE_GROQ_MODEL ?? DEFAULT_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  const payload = {
    model,
    temperature: opts.temperature ?? 0.4,
    // gpt-oss reasons before it answers, and that reasoning is billed
    // against max_tokens. Left at the default the model spent the whole
    // budget thinking and returned "max completion tokens reached before
    // generating a valid document" — a 400, not a parse error.
    reasoning_effort: opts.reasoningEffort ?? "low",
    max_tokens: opts.maxTokens ?? 1000,
    messages: [
      { role: "system", content: opts.system },
      ...opts.messages,
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: opts.schemaName,
        strict: true,
        schema: opts.schema,
      },
    },
  };

  try {
    let res: Response | null = null;
    let lastDetail = "";
    for (let i = 0; i < keys.length; i += 1) {
      res = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${keys[i]}`,
          "content-type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify(payload),
      });
      if (res.ok) break;
      lastDetail = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status === 401;
      logger.error("[groq] request failed", {
        status: res.status,
        key: i + 1,
        detail: lastDetail.slice(0, 300),
      });
      if (!retryable || i === keys.length - 1) {
        return { ok: false, message: "AI request failed." };
      }
    }
    if (!res?.ok) return { ok: false, message: "AI request failed." };

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content;
    if (!text) {
      logger.error("[groq] empty completion");
      return { ok: false, message: "AI returned an empty response." };
    }

    return { ok: true, data: JSON.parse(text) as T };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    logger.error("[groq] errored", {
      error: aborted ? "timeout" : String(error),
    });
    return {
      ok: false,
      message: aborted ? "AI timed out." : "AI request errored.",
    };
  } finally {
    clearTimeout(timer);
  }
}
