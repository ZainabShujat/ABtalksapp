import "server-only";
import { askClaudeJson } from "@/lib/anthropic";
import { logger } from "@/lib/logger";
import type { AskJson } from "@/features/interview/agent/llm/json-provider";

/**
 * Binds report generation to a real model.
 *
 * The only `server-only` file in the reporting path. Everything else —
 * assembly, scoring, validation, the prompt — is pure and runs in a plain
 * script, which is what makes the report flow testable without a network.
 *
 * Provider order is availability-driven, learned the hard way: the Anthropic
 * key on this project reports a zero credit balance, so a Claude-only binding
 * silently produced a deterministic fallback narrative on every report. Groq is
 * tried first when its key is present, Claude second.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_REPORT_MODEL = "openai/gpt-oss-120b";

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

const askGroq: AskJson = async ({ system, user, maxTokens }) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { ok: false, message: "no GROQ_API_KEY" };

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL ?? DEFAULT_GROQ_REPORT_MODEL,
        max_tokens: maxTokens,
        temperature: 0.3,
        reasoning_effort: "low",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, message: `Groq HTTP ${res.status}: ${body.slice(0, 200)}` };
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const slice = extractJson(json.choices?.[0]?.message?.content ?? "");
    if (!slice) return { ok: false, message: "Groq returned no JSON object." };
    return { ok: true, data: JSON.parse(slice) };
  } catch (error) {
    return { ok: false, message: String(error) };
  }
};

const askClaude: AskJson = async ({ system, user, maxTokens }) => {
  const result = await askClaudeJson<unknown>({ system, user, maxTokens });
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, message: result.message };
};

/**
 * Tries each configured provider in turn. Falling through to the deterministic
 * narrative is still possible and still safe — it only costs prose, never a
 * score — but it should be the last resort rather than the first outcome.
 */
export const askForReport: AskJson = async (params) => {
  if (process.env.GROQ_API_KEY) {
    const viaGroq = await askGroq(params);
    if (viaGroq.ok) return viaGroq;
    logger.warn("[interview-report] groq narrative failed", {
      message: viaGroq.message,
    });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const viaClaude = await askClaude(params);
    if (viaClaude.ok) return viaClaude;
    logger.warn("[interview-report] claude narrative failed", {
      message: viaClaude.message,
    });
  }

  return { ok: false, message: "No narrative provider is available." };
};
