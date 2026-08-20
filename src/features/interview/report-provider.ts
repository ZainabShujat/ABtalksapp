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
 * Provider order is availability-driven, learned the hard way on this project:
 * the Anthropic key reports a zero credit balance, so a Claude-only binding
 * silently produced a deterministic stub narrative on every report. Groq is
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

/** Milliseconds to wait after a 429, read from the body. Bounded. */
function retryAfterMs(body: string): number {
  const match = body.match(/try again in ([0-9.]+)s/i);
  const seconds = match ? Number(match[1]) : NaN;
  return Number.isFinite(seconds) ? Math.min(seconds * 1000 + 500, 65_000) : 20_000;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const askGroq: AskJson = async ({ system, user, maxTokens }) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { ok: false, message: "no GROQ_API_KEY" };

  const call = () =>
    fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL ?? DEFAULT_GROQ_REPORT_MODEL,
        max_tokens: maxTokens,
        // A little warmth is wanted here — this is the only prose a candidate
        // reads — but not enough to make two runs of the same interview
        // describe it differently.
        temperature: 0.3,
        reasoning_effort: "low",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });

  try {
    let res = await call();

    // The report is generated the instant the interview ends, which is exactly
    // when a tokens-per-minute budget is most depleted — by the interview
    // itself. Waiting out the window is worth it: the alternative is the
    // candidate receiving a deterministic stub where their written assessment
    // should be.
    if (res.status === 429) {
      const body = await res.text().catch(() => "");
      logger.info("[interview-report] narrative rate-limited, waiting", {
        waitMs: retryAfterMs(body),
      });
      await sleep(retryAfterMs(body));
      res = await call();
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        message: `Groq HTTP ${res.status}: ${body.slice(0, 200)}`,
      };
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
 * Tries each configured provider in turn.
 *
 * Falling through to the deterministic narrative is still safe — it costs prose,
 * never a score, and the report is flagged `narrativeDegraded` so no reader
 * mistakes terseness for a judgment. But it should be the last resort rather
 * than the first outcome.
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
