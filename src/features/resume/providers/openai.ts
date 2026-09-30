import "server-only";
import { logger } from "@/lib/logger";

/**
 * The OpenAI transport for the résumé parser (plan 154).
 *
 * Transport only: the prompts, the JSON extraction and the normaliser all stay
 * in `parse.ts`, so there is still exactly one parser — this file decides how
 * the PDF reaches a model and what came back, nothing about what a résumé is.
 *
 * Deliberately separate from `features/interview/agent/llm/openai-provider.ts`.
 * Same key, different model, different failure policy: an interview turn must
 * never wait long, a résumé job can wait minutes. OpenAI rate limits are per
 * model, so a résumé model other than the interview judge's `gpt-4o` never
 * spends the interview's budget.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/**
 * The ONLY model literal for résumé parsing. Chosen by evaluation (plan 154
 * §2d): the one model with zero failures on the e2e invariants, deterministic
 * at temperature 0, ≈ $4.6 per 1,000 résumés. Override with RESUME_OPENAI_MODEL.
 */
export const RESUME_OPENAI_DEFAULT_MODEL = "gpt-4.1-mini";

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const REQUEST_TIMEOUT_MS = 45_000;

export function resumeOpenAiModel(): string {
  const configured = process.env.RESUME_OPENAI_MODEL?.trim();
  return configured && configured.length > 0 ? configured : RESUME_OPENAI_DEFAULT_MODEL;
}

/** A dedicated key/project if one is ever set; otherwise the shared key. */
export function resumeOpenAiKey(): string | undefined {
  const dedicated = process.env.RESUME_OPENAI_API_KEY?.trim();
  if (dedicated) return dedicated;
  const shared = process.env.OPENAI_API_KEY?.trim();
  return shared && shared.length > 0 ? shared : undefined;
}

export function resumeMaxOutputTokens(): number {
  const n = Number(process.env.RESUME_OPENAI_MAX_OUTPUT_TOKENS);
  return Number.isInteger(n) && n >= 1024 && n <= 32_768 ? n : DEFAULT_MAX_OUTPUT_TOKENS;
}

/* ─── Cost ───────────────────────────────────────────────────────────────── */

/** USD per 1M tokens. List prices at the time of writing (plan 154 §2d). */
export const RESUME_MODEL_PRICES: Readonly<Record<string, { inPerM: number; outPerM: number }>> = {
  "gpt-4.1-mini": { inPerM: 0.4, outPerM: 1.6 },
  "gpt-4.1-nano": { inPerM: 0.1, outPerM: 0.4 },
  "gpt-4.1": { inPerM: 2.0, outPerM: 8.0 },
  "gpt-4o-mini": { inPerM: 0.15, outPerM: 0.6 },
  "gpt-4o": { inPerM: 2.5, outPerM: 10.0 },
  "gpt-5-mini": { inPerM: 0.25, outPerM: 2.0 },
  "gpt-5-nano": { inPerM: 0.05, outPerM: 0.4 },
};

let warnedUnpricedModel: string | null = null;

export function priceFor(model: string): { inPerM: number; outPerM: number } {
  const known = RESUME_MODEL_PRICES[model];
  if (known) return known;
  const inPerM = Number(process.env.RESUME_OPENAI_PRICE_IN);
  const outPerM = Number(process.env.RESUME_OPENAI_PRICE_OUT);
  if (Number.isFinite(inPerM) && Number.isFinite(outPerM) && inPerM >= 0 && outPerM >= 0) {
    return { inPerM, outPerM };
  }
  if (warnedUnpricedModel !== model) {
    warnedUnpricedModel = model;
    logger.warn("[resume] no price for model — cost recorded as 0", { model });
  }
  return { inPerM: 0, outPerM: 0 };
}

/** Price per 1M tokens in USD is exactly micro-USD per token. */
export function costMicroUsd(model: string, promptTokens: number, completionTokens: number): number {
  const { inPerM, outPerM } = priceFor(model);
  return Math.round(promptTokens * inPerM + completionTokens * outPerM);
}

/* ─── Structured output ─────────────────────────────────────────────────── */

const str = { type: ["string", "null"] } as const;
const strList = { type: "array", items: { type: "string" } } as const;

function strictObject(properties: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

/**
 * The raw shape `RESUME_SCHEMA_PROMPT` asks for, as a strict JSON Schema, plus
 * one import-only key: `all_emails`, every email address in the document. It
 * is how a résumé with two addresses is detected instead of silently picking
 * one. `normalizeParsedResume` ignores keys it does not know, so `ParsedResume`
 * is unchanged.
 */
export const RESUME_JSON_SCHEMA = strictObject({
  candidate_name: str,
  headline: str,
  email: str,
  all_emails: strList,
  phone: str,
  location: str,
  linkedin: str,
  github: str,
  portfolio: str,
  website: str,
  summary: str,
  career_level: str,
  primary_domain: str,
  estimated_experience_years: { type: ["number", "null"] },
  skills: strList,
  technical_skills: strList,
  soft_skills: strList,
  programming_languages: strList,
  frameworks: strList,
  databases: strList,
  cloud_platforms: strList,
  tools: strList,
  projects: {
    type: "array",
    items: strictObject({
      title: str,
      description: str,
      technologies: strList,
      github: str,
      demo: str,
      contributions: strList,
    }),
  },
  experience: {
    type: "array",
    items: strictObject({
      title: str,
      company: str,
      employment_type: str,
      duration: str,
      responsibilities: strList,
      achievements: strList,
      technologies: strList,
    }),
  },
  education: {
    type: "array",
    items: strictObject({
      degree: str,
      branch: str,
      institution: str,
      year: str,
      cgpa: str,
    }),
  },
  certifications: strList,
  internships: {
    type: "array",
    items: strictObject({
      company: str,
      role: str,
      duration: str,
      summary: str,
    }),
  },
  achievements: strList,
  languages: strList,
});

/* ─── Rate-limit headers ─────────────────────────────────────────────────── */

export type RateHeaders = {
  limitTokens: number | null;
  remainingTokens: number | null;
  resetTokensMs: number | null;
  limitRequests: number | null;
  remainingRequests: number | null;
  resetRequestsMs: number | null;
};

/** `6ms`, `8.64s`, `1m2s`, `1h0m3s` → milliseconds. */
export function parseResetDuration(value: string | null): number | null {
  if (!value) return null;
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let total = 0;
  let matched = false;
  for (const m of value.matchAll(re)) {
    matched = true;
    const n = Number(m[1]);
    const unit = m[2];
    total += unit === "ms" ? n : unit === "s" ? n * 1000 : unit === "m" ? n * 60_000 : n * 3_600_000;
  }
  return matched ? Math.ceil(total) : null;
}

function num(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function readRateHeaders(headers: Headers): RateHeaders {
  return {
    limitTokens: num(headers.get("x-ratelimit-limit-tokens")),
    remainingTokens: num(headers.get("x-ratelimit-remaining-tokens")),
    resetTokensMs: parseResetDuration(headers.get("x-ratelimit-reset-tokens")),
    limitRequests: num(headers.get("x-ratelimit-limit-requests")),
    remainingRequests: num(headers.get("x-ratelimit-remaining-requests")),
    resetRequestsMs: parseResetDuration(headers.get("x-ratelimit-reset-requests")),
  };
}

/** `retry-after` is seconds; `retry-after-ms` wins when present. */
export function retryAfterMs(headers: Headers): number | null {
  const ms = num(headers.get("retry-after-ms"));
  if (ms !== null) return ms;
  const seconds = num(headers.get("retry-after"));
  return seconds !== null ? seconds * 1000 : null;
}

/* ─── The call ──────────────────────────────────────────────────────────── */

/**
 * Why a call failed, in the terms a caller acts on:
 * - `rate_limited` — 429 on RPM/TPM. Waiting helps.
 * - `quota`        — 429 insufficient_quota. Waiting does not; a human tops up.
 * - `unavailable`  — no key, 5xx, network, timeout. Retrying later can help.
 * - `truncated`    — hit the output budget mid-JSON.
 * - `bad_output`   — a reply with no usable JSON.
 * - `empty`        — nothing readable came back (a scan, a photo).
 */
export type ProviderFailureKind =
  | "rate_limited"
  | "quota"
  | "unavailable"
  | "truncated"
  | "bad_output"
  | "empty";

export type ProviderUsage = { prompt: number; completion: number };

export type ProviderCall =
  | {
      ok: true;
      /** The model's JSON text. Parsed by the caller. */
      text: string;
      usage: ProviderUsage;
      rate: RateHeaders | null;
      latencyMs: number;
      model: string;
    }
  | {
      ok: false;
      kind: ProviderFailureKind;
      retryAfterMs: number | null;
      usage: ProviderUsage;
      rate: RateHeaders | null;
      latencyMs: number;
      model: string;
      /** For the logger only. Never shown to a user. */
      detail: string;
    };

type ChatCompletion = {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: string; type?: string };
};

export type OpenAiResumeRequest = {
  bytes: Uint8Array;
  fileName: string | null;
  system: string;
  user: string;
  model?: string;
  fetchImpl?: typeof fetch;
};

/** The request body. Exported so the shape is unit-tested without a network. */
export function buildResumeRequestBody(input: {
  model: string;
  bytes: Uint8Array;
  fileName: string | null;
  system: string;
  user: string;
  maxOutputTokens: number;
}): Record<string, unknown> {
  // gpt-5 family: reasoning models. No temperature, and their output budget
  // is `max_completion_tokens`. "minimal" effort: this is extraction.
  const reasoning = input.model.startsWith("gpt-5") || /^o\d/.test(input.model);
  return {
    model: input.model,
    ...(reasoning
      ? { max_completion_tokens: input.maxOutputTokens, reasoning_effort: "minimal" }
      : { max_tokens: input.maxOutputTokens, temperature: 0 }),
    response_format: {
      type: "json_schema",
      json_schema: { name: "parsed_resume", strict: true, schema: RESUME_JSON_SCHEMA },
    },
    messages: [
      { role: "system", content: input.system },
      {
        role: "user",
        content: [
          {
            type: "file",
            file: {
              filename: input.fileName ?? "resume.pdf",
              file_data: `data:application/pdf;base64,${Buffer.from(input.bytes).toString("base64")}`,
            },
          },
          { type: "text", text: input.user },
        ],
      },
    ],
  };
}

export async function callOpenAiResumeParser(req: OpenAiResumeRequest): Promise<ProviderCall> {
  const model = req.model ?? resumeOpenAiModel();
  const started = Date.now();
  const none: ProviderUsage = { prompt: 0, completion: 0 };
  const apiKey = resumeOpenAiKey();

  if (!apiKey) {
    return {
      ok: false,
      kind: "unavailable",
      retryAfterMs: null,
      usage: none,
      rate: null,
      latencyMs: 0,
      model,
      detail: "no RESUME_OPENAI_API_KEY / OPENAI_API_KEY",
    };
  }

  const doFetch = req.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(
        buildResumeRequestBody({
          model,
          bytes: req.bytes,
          fileName: req.fileName,
          system: req.system,
          user: req.user,
          maxOutputTokens: resumeMaxOutputTokens(),
        }),
      ),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      kind: "unavailable",
      retryAfterMs: null,
      usage: none,
      rate: null,
      latencyMs: Date.now() - started,
      model,
      detail: `request threw: ${String(error)}`,
    };
  }

  const rate = readRateHeaders(res.headers);
  const latencyMs = Date.now() - started;
  const json = (await res.json().catch(() => null)) as ChatCompletion | null;
  const usage: ProviderUsage = {
    prompt: json?.usage?.prompt_tokens ?? 0,
    completion: json?.usage?.completion_tokens ?? 0,
  };

  if (!res.ok) {
    const code = json?.error?.code ?? json?.error?.type ?? "";
    const kind: ProviderFailureKind =
      res.status === 429
        ? code === "insufficient_quota"
          ? "quota"
          : "rate_limited"
        : "unavailable";
    return {
      ok: false,
      kind,
      retryAfterMs: retryAfterMs(res.headers),
      usage,
      rate,
      latencyMs,
      model,
      detail: `HTTP ${res.status} ${code} ${(json?.error?.message ?? "").slice(0, 200)}`.trim(),
    };
  }

  const choice = json?.choices?.[0];
  if (choice?.finish_reason === "length") {
    return { ok: false, kind: "truncated", retryAfterMs: null, usage, rate, latencyMs, model, detail: "finish_reason=length" };
  }
  const text = choice?.message?.content ?? "";
  if (text.length === 0) {
    return {
      ok: false,
      kind: "empty",
      retryAfterMs: null,
      usage,
      rate,
      latencyMs,
      model,
      detail: choice?.message?.refusal ? "refusal" : `finish_reason=${choice?.finish_reason ?? "unknown"}`,
    };
  }
  return { ok: true, text, usage, rate, latencyMs, model };
}
