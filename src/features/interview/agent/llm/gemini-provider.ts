import { createJsonInterviewLLM } from "@/features/interview/agent/llm/json-provider";
import type { InterviewLLM } from "@/features/interview/agent/llm/provider";

/**
 * Google Gemini implementation of `InterviewLLM`.
 *
 * Proof that the provider seam works: this file is the ENTIRE cost of adding a
 * second vendor. No LangGraph node, no policy rule and no test changed — the
 * shared `json-provider` still owns schema validation, the retry and the
 * deterministic fallback.
 *
 * The API key is a parameter, never read from `process.env` in here. That keeps
 * the module free of `server-only` (so the CLI demo can use it too) while making
 * it impossible for a key to be captured into a client bundle by an accidental
 * import.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Default model. Override per environment with `GEMINI_MODEL`.
 *
 * Chosen on latency AND free-tier quota, both of which bite in practice:
 *   - `gemini-3.6-flash` took ~37s per turn; its heavy internal reasoning buys
 *     nothing on a task this constrained, and a candidate sits in silence.
 *   - `gemini-3.5-flash` runs ~3s but the free tier allows only 20 requests,
 *     which one demo session exhausts.
 * The `-lite` models carry a separate, larger free-tier allowance and are fast,
 * so they are the sensible default until the account is on a paid plan.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

/**
 * Gemini bills internal reasoning ("thoughts") against `maxOutputTokens`. With
 * the ~700 the analysis prompt asks for, thinking alone can exhaust the budget
 * and the response comes back with `finishReason: MAX_TOKENS` and NO text —
 * which the validator would correctly reject, wasting a real call. So the floor
 * is raised well above what the JSON itself needs.
 */
const MIN_OUTPUT_TOKENS = 2000;

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  error?: { message?: string };
};

/**
 * Extracts the first complete JSON object from a response.
 *
 * `responseMimeType: application/json` usually returns bare JSON, so that is
 * tried first. When it does not — a stray trailing line, a second object, a code
 * fence — the fallback scans for the first BALANCED object rather than slicing
 * to the last `}` in the string. Slicing to the last brace is what broke here:
 * with any content after the object it produces text that is not valid JSON, and
 * the whole call is thrown away.
 */
function parseFirstJsonObject(
  text: string,
): { ok: true; data: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    /* fall through to the scan */
  }

  const start = text.indexOf("{");
  if (start === -1) return { ok: false, message: "Gemini returned no JSON object" };

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return { ok: true, data: JSON.parse(text.slice(start, i + 1)) };
        } catch (error) {
          return {
            ok: false,
            message: `Gemini JSON parse failed: ${String(error)}`,
          };
        }
      }
    }
  }

  return { ok: false, message: "Gemini returned an unterminated JSON object" };
}

export function createGeminiInterviewLLM(
  apiKey: string,
  model: string = DEFAULT_GEMINI_MODEL,
): InterviewLLM {
  return createJsonInterviewLLM({
    name: `gemini:${model}`,
    async askJson({ system, user, maxTokens }) {
      const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          // Gemini takes the system prompt in its own field rather than as a
          // leading turn, which keeps the instructions out of the transcript.
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: Math.max(maxTokens, MIN_OUTPUT_TOKENS),
            temperature: 0.2,
          },
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as GeminiResponse | null;
        return {
          ok: false,
          message: `Gemini HTTP ${res.status}${
            body?.error?.message ? `: ${body.error.message}` : ""
          }`,
          // 429 is a quota or rate-limit rejection. Retrying immediately cannot
          // succeed and spends another request against the same limit, so the
          // turn goes straight to the deterministic fallback instead.
          retryable: res.status !== 429,
        };
      }

      const json = (await res.json()) as GeminiResponse;
      const candidate = json.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text ?? "";

      if (text.length === 0) {
        return {
          ok: false,
          message: `Gemini returned no text (finishReason: ${
            candidate?.finishReason ?? "unknown"
          })`,
        };
      }

      const parsed = parseFirstJsonObject(text);
      if (!parsed.ok) return parsed;
      return { ok: true, data: parsed.data };
    },
  });
}
