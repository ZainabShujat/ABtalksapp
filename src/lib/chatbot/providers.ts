import "server-only";
import { logger } from "@/lib/logger";

/**
 * Generation providers, tried in order: OpenAI -> Gemini -> Groq -> Anthropic.
 *
 * OpenAI leads because it is the only rung on a PAID plan. A readiness check on
 * 2026-08-28 found Gemini rate-limited (`429`, ~15 requests/day on this
 * project's free tier), Anthropic returning `400 credit balance is too low`,
 * and Groq — the sole working provider — rate-limiting under ordinary test
 * load. A chain whose first three rungs are free tiers is a chain that fails
 * during exactly the traffic you built it for.
 *
 * Every provider receives the SAME system prompt and the SAME retrieved
 * context. A fallback that answered from its own knowledge would turn a
 * provider outage into a hallucination, so the contract does not change with
 * the upstream.
 *
 * Each adapter normalises its vendor's stream into plain text deltas, so the
 * route emits ONE wire format and the browser never has to know which provider
 * answered. The previous implementation piped Gemini's raw SSE to the client,
 * which is why the widget carried a parser for two vendors' JSON shapes.
 */

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ProviderName = "openai" | "gemini" | "groq" | "anthropic";

type ProviderResult =
  | { ok: true; stream: ReadableStream<string>; provider: ProviderName }
  | { ok: false; reason: string };

/**
 * Time allowed to OPEN a stream, not to finish one.
 *
 * 8s, down from 20s. This is a failover budget, and it is paid on every single
 * message when the primary is unhealthy: with Gemini unreachable, a 20s ceiling
 * meant every user waited 20 seconds before the working provider was even
 * tried. Gemini's own free tier is capped at ~15 requests/day on this project
 * (see features/interview/agent/llm/groq-provider.ts), so an unhealthy primary
 * is the expected steady state, not an edge case.
 *
 * The abort applies to the response headers; once the stream is open, tokens
 * flow without a deadline.
 */
const TIMEOUT_MS = 8_000;

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(TIMEOUT_MS);
}

/**
 * Pulls `data:` lines out of an SSE byte stream and hands each payload to
 * `extract`, which returns the text delta for that vendor's JSON shape.
 */
function sseToText(
  body: ReadableStream<Uint8Array>,
  extract: (payload: unknown) => string,
): ReadableStream<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream<string>({
    async start(controller) {
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const text = extract(JSON.parse(payload));
              if (text) controller.enqueue(text);
            } catch {
              // Partial or non-JSON keepalive frame — skip it.
            }
          }
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}

async function callOpenAI(
  system: string,
  turns: ChatTurn[],
): Promise<ProviderResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, reason: "OPENAI_API_KEY not set" };

  // `gpt-4.1-mini`, not the `gpt-4o` the interview judge uses: this call
  // summarises retrieved text under fixed rules rather than assessing anyone,
  // and the mini tier follows the grounding constraints just as closely for a
  // fraction of the cost. At roughly 4k context + 200 output tokens per reply
  // that is well under a cent per conversation.
  const model = process.env.CHATBOT_OPENAI_MODEL ?? "gpt-4.1-mini";
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      signal: timeoutSignal(),
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0,
        max_tokens: 800,
        messages: [
          { role: "system", content: system },
          ...turns.map((t) => ({ role: t.role, content: t.content })),
        ],
      }),
    });
    if (!response.ok || !response.body) {
      return { ok: false, reason: `openai http ${response.status}` };
    }
    // Same wire shape as Groq — both speak the OpenAI chat-completions stream.
    const stream = sseToText(response.body, (payload) => {
      const data = payload as { choices?: { delta?: { content?: string } }[] };
      return data.choices?.[0]?.delta?.content ?? "";
    });
    return { ok: true, stream, provider: "openai" };
  } catch (error) {
    return { ok: false, reason: `openai threw: ${String(error)}` };
  }
}

async function callGemini(
  system: string,
  turns: ChatTurn[],
): Promise<ProviderResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, reason: "GEMINI_API_KEY not set" };

  const model = process.env.CHATBOT_GEMINI_MODEL ?? "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${key}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: timeoutSignal(),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((t) => ({
          role: t.role === "assistant" ? "model" : "user",
          parts: [{ text: t.content }],
        })),
        generationConfig: { temperature: 0, maxOutputTokens: 800 },
      }),
    });
    if (!response.ok || !response.body) {
      return { ok: false, reason: `gemini http ${response.status}` };
    }
    const stream = sseToText(response.body, (payload) => {
      const data = payload as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    });
    return { ok: true, stream, provider: "gemini" };
  } catch (error) {
    return { ok: false, reason: `gemini threw: ${String(error)}` };
  }
}

async function callGroq(
  system: string,
  turns: ChatTurn[],
): Promise<ProviderResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { ok: false, reason: "GROQ_API_KEY not set" };

  // `openai/gpt-oss-120b`, matching `DEFAULT_GROQ_MODEL` in
  // features/interview/agent/llm/groq-provider.ts. The name is repeated rather
  // than imported to keep the chatbot from pulling an interview module into its
  // bundle, but it is the same deliberate choice: it is what this account
  // actually has access to. The previous default here, `llama-3.3-70b-versatile`,
  // does not exist on this Groq account and returned `model_not_found` — so the
  // whole Groq fallback rung was dead, which only shows up once Gemini fails.
  const model = process.env.CHATBOT_GROQ_MODEL ?? "openai/gpt-oss-120b";
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      signal: timeoutSignal(),
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0,
        max_tokens: 800,
        messages: [
          { role: "system", content: system },
          ...turns.map((t) => ({ role: t.role, content: t.content })),
        ],
      }),
    });
    if (!response.ok || !response.body) {
      return { ok: false, reason: `groq http ${response.status}` };
    }
    const stream = sseToText(response.body, (payload) => {
      const data = payload as { choices?: { delta?: { content?: string } }[] };
      return data.choices?.[0]?.delta?.content ?? "";
    });
    return { ok: true, stream, provider: "groq" };
  } catch (error) {
    return { ok: false, reason: `groq threw: ${String(error)}` };
  }
}

async function callAnthropic(
  system: string,
  turns: ChatTurn[],
): Promise<ProviderResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, reason: "ANTHROPIC_API_KEY not set" };

  const model = process.env.CHATBOT_ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      signal: timeoutSignal(),
      body: JSON.stringify({
        model,
        system,
        stream: true,
        temperature: 0,
        max_tokens: 800,
        messages: turns.map((t) => ({ role: t.role, content: t.content })),
      }),
    });
    if (!response.ok || !response.body) {
      return { ok: false, reason: `anthropic http ${response.status}` };
    }
    const stream = sseToText(response.body, (payload) => {
      const data = payload as {
        type?: string;
        delta?: { type?: string; text?: string };
      };
      return data.type === "content_block_delta" ? (data.delta?.text ?? "") : "";
    });
    return { ok: true, stream, provider: "anthropic" };
  } catch (error) {
    return { ok: false, reason: `anthropic threw: ${String(error)}` };
  }
}

/**
 * Tries each provider until one opens a stream. Only called once retrieval has
 * already decided the question is answerable — an unsupported question never
 * reaches any provider.
 */
export async function generateStream(
  system: string,
  turns: ChatTurn[],
): Promise<ProviderResult> {
  const chain = [callOpenAI, callGemini, callGroq, callAnthropic];
  const reasons: string[] = [];

  for (const call of chain) {
    const result = await call(system, turns);
    if (result.ok) {
      if (reasons.length > 0) {
        logger.warn("Chatbot generation fell back to a secondary provider", {
          provider: result.provider,
          skipped: reasons,
        });
      }
      return result;
    }
    reasons.push(result.reason);
  }

  logger.error("All chatbot generation providers failed", { reasons });
  return { ok: false, reason: reasons.join("; ") };
}
