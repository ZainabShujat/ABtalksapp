import "server-only";
import { logger } from "@/lib/logger";
import { normalizeParsedResume } from "@/features/resume/normalize";
import { nextRetryDelayMs } from "@/features/resume/import/rate-budget";
import {
  callOpenAiResumeParser,
  resumeOpenAiKey,
  resumeOpenAiModel,
  type ProviderCall,
  type ProviderFailureKind,
  type ProviderUsage,
  type RateHeaders,
} from "@/features/resume/providers/openai";
import { recordParseUsage, type ParseContext } from "@/features/resume/usage";
import type { ParsedResume } from "@/features/resume/types";

/**
 * The Résumé Parser Agent, re-hosted.
 *
 * `agent packages/AI-Agents/Résumé Parser Agent/resume_agent.py` is Python and
 * depends on `pdfplumber` + `google-generativeai`; neither can run on this
 * Next.js/Vercel deployment. This file is that agent ported to the runtime we
 * actually ship: same model vendor, same output schema, same normaliser
 * (`normalize.ts`). It is the ONLY place a model sees a résumé — do not add a
 * second parser.
 *
 * One deliberate difference from the Python original: the agent extracted
 * name / email / phone / links with local regex over `pdfplumber` text and asked
 * the model only for the semantic fields. Here the PDF goes to Gemini directly
 * as `inlineData`, which is what removes the need for a `pdfplumber` equivalent
 * — so the model is asked for the mechanical fields too, and the schema below
 * is the agent's schema with those keys added back in.
 *
 * Plan 154: the model is now OpenAI by default (`providers/openai.ts`), with
 * Gemini kept as a configured fallback. Only the transport differs — both get
 * these prompts, go through `parseFirstJsonObject` and `normalizeParsedResume`,
 * and produce the same `ParsedResume`.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Document understanding needs the full Flash model. `-lite` (the interview
 * agent's default, chosen for per-turn latency) is noticeably weaker at reading
 * a multi-column résumé layout, and this call runs once per upload rather than
 * once per conversational turn, so the latency trade does not apply.
 */
export const RESUME_DEFAULT_MODEL = "gemini-3.5-flash";

/** Gemini bills its internal reasoning against this budget — see gemini-provider.ts. */
const MAX_OUTPUT_TOKENS = 8192;

export const RESUME_SYSTEM_PROMPT = `You are Résumé Intelligence Agent. You read a résumé document and extract structured information from it.

Rules:
- Extract ONLY what the document actually contains. Never invent, infer or embellish a fact that is not there.
- If a field is absent, return null for it, or an empty array for a list. Do not guess.
- Links & URLs: Extract full web URLs for linkedin, github, portfolio, and website from headers, contact blocks, icons, or hyperlinks. For projects, extract repository URLs (into "github") and live demo/deployment URLs (into "demo") whether they appear as dedicated fields, inline in text (e.g. inside parentheses, after "Repo:", "Live:", "Link:"), or as hyperlinks. Expand shorthand links (e.g. 'github.com/user' -> 'https://github.com/user', 'linkedin.com/in/user' -> 'https://linkedin.com/in/user'). Never return generic label text (like 'GitHub', 'LinkedIn', 'Link', 'Demo') as the URL value.
- Write descriptive content as points. "responsibilities", "achievements" and project "contributions" are arrays with ONE point per item — never several points joined into one string. A project "description" is a single short sentence saying what the project is; its details go in "contributions". An internship "summary" puts each point on its own line.
- Copy achievement and responsibility bullets close to the candidate's own wording. Do not rewrite them to sound better, and do not add numbers that are not in the document.
- "estimated_experience_years" is total professional working years, excluding time spent studying. Return 0 when the candidate has no professional experience.
- Return a single JSON object and nothing else.`;

export const RESUME_SCHEMA_PROMPT = `Extract this résumé into JSON matching exactly this schema:
{
  "candidate_name": "", "headline": "", "email": "", "phone": "", "location": "",
  "linkedin": "https://linkedin.com/in/...", "github": "https://github.com/...", "portfolio": "https://...", "website": "https://...",
  "summary": "", "career_level": "", "primary_domain": "", "estimated_experience_years": 0.0,
  "skills": [], "technical_skills": [], "soft_skills": [], "programming_languages": [],
  "frameworks": [], "databases": [], "cloud_platforms": [], "tools": [],
  "projects": [{"title": "", "description": "", "technologies": [], "github": "https://github.com/...", "demo": "https://...", "contributions": []}],
  "experience": [{"title": "", "company": "", "employment_type": "", "duration": "", "responsibilities": [], "achievements": [], "technologies": []}],
  "education": [{"degree": "", "branch": "", "institution": "", "year": "", "cgpa": ""}],
  "certifications": [],
  "internships": [{"company": "", "role": "", "duration": "", "summary": ""}],
  "achievements": [], "languages": []
}`;

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
};

export type ParseResult =
  | { ok: true; data: ParsedResume }
  | { ok: false; message: string };

/**
 * Extracts the first BALANCED JSON object. Same reasoning as
 * `features/interview/agent/llm/gemini-provider.ts`: slicing to the last `}`
 * breaks whenever anything follows the object.
 */
function parseFirstJsonObject(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    /* fall through to the scan */
  }

  const start = text.indexOf("{");
  if (start === -1) return null;

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
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/* ─── Provider selection (plan 154) ─────────────────────────────────────── */

/**
 * `RESUME_PARSER_PROVIDER` = `openai` (default) | `gemini`.
 *
 * OpenAI is the default since plan 154: Gemini's quota ran out whenever many
 * students registered at once. Gemini stays as a configured fallback only. The
 * prompts, the JSON extraction and the normaliser are the same for both — the
 * provider is only the transport, so this is still one parser.
 */
export type ResumeParserProvider = "openai" | "gemini";

export function resumeParserProvider(): ResumeParserProvider {
  return (process.env.RESUME_PARSER_PROVIDER ?? "").trim().toLowerCase() === "gemini"
    ? "gemini"
    : "openai";
}

export function isParserConfigured(): boolean {
  return resumeParserProvider() === "gemini"
    ? Boolean(process.env.GEMINI_API_KEY)
    : Boolean(resumeOpenAiKey());
}

/* ─── User-facing messages ───────────────────────────────────────────────── */

const UNAVAILABLE_MESSAGE =
  "Résumé analysis is temporarily unavailable. Please try again later.";
const BUSY_MESSAGE =
  "Résumé analysis is busy right now. Please try again in a few minutes.";
const NOT_ANALYSED_MESSAGE = "We could not analyse this résumé. Please try again.";
const UNREADABLE_MESSAGE =
  "We could not read this document. Make sure it is a text-based PDF rather than a scan or photo.";

export type ParseFailureKind = ProviderFailureKind | "not_configured";

function messageFor(kind: ParseFailureKind): string {
  switch (kind) {
    case "rate_limited":
      return BUSY_MESSAGE;
    case "not_configured":
    case "quota":
      return UNAVAILABLE_MESSAGE;
    case "empty":
      return UNREADABLE_MESSAGE;
    case "unavailable":
    case "truncated":
    case "bad_output":
      return NOT_ANALYSED_MESSAGE;
  }
}

/* ─── The detailed parse ─────────────────────────────────────────────────── */

export type DetailedParseResult =
  | {
      ok: true;
      data: ParsedResume;
      /** Every email the model listed (`all_emails`), read before normalising. */
      emails: string[];
      model: string;
      /** Summed over every HTTP attempt of this parse. */
      usage: ProviderUsage;
      costMicroUsd: number;
      rate: RateHeaders | null;
    }
  | {
      ok: false;
      kind: ParseFailureKind;
      /** User-facing: no vendor names, no status codes. */
      message: string;
      retryAfterMs: number | null;
      model: string;
      usage: ProviderUsage;
      costMicroUsd: number;
      rate: RateHeaders | null;
    };

/** Interactive path (/register, /profile): the candidate is waiting. */
const INTERACTIVE_MAX_RETRIES = 2;
const INTERACTIVE_MAX_WAIT_MS = 8_000;
const INTERACTIVE_TOTAL_WAIT_MS = 20_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function emailsFrom(raw: unknown): string[] {
  if (raw === null || typeof raw !== "object") return [];
  const list = (raw as { all_emails?: unknown }).all_emails;
  return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Parse a résumé into the canonical structure, with everything a caller needs
 * to schedule, retry and account for the call.
 *
 * `retry429`: on a rate limit, wait (honouring `retry-after`, with full jitter)
 * and try again, up to 2 more times and 20 s in total — sized for a 60 s
 * request the candidate is watching. The import worker passes `false` and
 * schedules its own retry instead of holding a slot.
 *
 * Every HTTP attempt writes one `ResumeParseUsage` row.
 */
export async function parseResumeDocumentDetailed(
  input: { bytes: Uint8Array; mimeType: string; fileName: string | null },
  opts: { ctx: ParseContext; retry429: boolean },
): Promise<DetailedParseResult> {
  const provider = resumeParserProvider();
  const usage: ProviderUsage = { prompt: 0, completion: 0 };
  let cost = 0;

  if (!isParserConfigured()) {
    logger.error("[resume] parser is not configured", { provider });
    return {
      ok: false,
      kind: "not_configured",
      message: messageFor("not_configured"),
      retryAfterMs: null,
      model: provider === "gemini" ? geminiModel() : resumeOpenAiModel(),
      usage,
      costMicroUsd: 0,
      rate: null,
    };
  }

  const user = input.fileName
    ? `${RESUME_SCHEMA_PROMPT}\n\nOriginal filename: ${input.fileName}`
    : RESUME_SCHEMA_PROMPT;

  let waited = 0;
  for (let attempt = 1; ; attempt++) {
    const call =
      provider === "gemini"
        ? await callGemini({ bytes: input.bytes, mimeType: input.mimeType, user })
        : await callOpenAiResumeParser({
            bytes: input.bytes,
            fileName: input.fileName,
            system: RESUME_SYSTEM_PROMPT,
            user,
          });

    usage.prompt += call.usage.prompt;
    usage.completion += call.usage.completion;

    let raw: unknown | null = null;
    let outcome: string = call.ok ? "ok" : call.kind;
    if (call.ok) {
      raw = parseFirstJsonObject(call.text);
      if (raw === null) outcome = "bad_output";
    }

    cost += await recordParseUsage({
      ctx: opts.ctx,
      provider,
      model: call.model,
      outcome,
      promptTokens: call.usage.prompt,
      completionTokens: call.usage.completion,
      latencyMs: call.latencyMs,
    });

    if (call.ok && raw !== null) {
      return {
        ok: true,
        data: normalizeParsedResume(raw),
        emails: emailsFrom(raw),
        model: call.model,
        usage,
        costMicroUsd: cost,
        rate: call.rate,
      };
    }

    const kind: ParseFailureKind = call.ok ? "bad_output" : call.kind;
    const retryAfter = call.ok ? null : call.retryAfterMs;
    logger.error("[resume] parse attempt failed", {
      provider,
      model: call.model,
      kind,
      attempt,
      detail: call.ok ? "unusable JSON" : call.detail,
    });

    if (opts.retry429 && kind === "rate_limited" && attempt <= INTERACTIVE_MAX_RETRIES) {
      const delay = Math.min(INTERACTIVE_MAX_WAIT_MS, nextRetryDelayMs(attempt, retryAfter));
      if (waited + delay <= INTERACTIVE_TOTAL_WAIT_MS) {
        waited += delay;
        await sleep(delay);
        continue;
      }
    }

    return {
      ok: false,
      kind,
      message: messageFor(kind),
      retryAfterMs: retryAfter,
      model: call.model,
      usage,
      costMicroUsd: cost,
      rate: call.rate,
    };
  }
}

/**
 * Parse a résumé document into the canonical structure.
 *
 * Messages returned on failure are user-facing: no vendor names, no status
 * codes, no stack traces. The technical detail goes to the logger.
 */
export async function parseResumeDocument(
  input: { bytes: Uint8Array; mimeType: string; fileName: string | null },
  ctx: ParseContext = { source: "PROFILE" },
): Promise<ParseResult> {
  const result = await parseResumeDocumentDetailed(input, { ctx, retry429: true });
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, message: result.message };
}

/* ─── Gemini transport (fallback provider) ───────────────────────────────── */

function geminiModel(): string {
  return process.env.RESUME_GEMINI_MODEL ?? process.env.GEMINI_MODEL ?? RESUME_DEFAULT_MODEL;
}

/** The original Gemini request, unchanged, returning the shared transport shape. */
async function callGemini({
  bytes,
  mimeType,
  user,
}: {
  bytes: Uint8Array;
  mimeType: string;
  user: string;
}): Promise<ProviderCall> {
  const apiKey = process.env.GEMINI_API_KEY ?? "";
  const model = geminiModel();
  const started = Date.now();
  const none: ProviderUsage = { prompt: 0, completion: 0 };

  let json: GeminiResponse;
  try {
    const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: RESUME_SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: Buffer.from(bytes).toString("base64"),
                },
              },
              { text: user },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          // Extraction, not writing. Nothing here benefits from sampling.
          temperature: 0,
        },
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as GeminiResponse | null;
      return {
        ok: false,
        kind: res.status === 429 ? "rate_limited" : "unavailable",
        retryAfterMs: null,
        usage: none,
        rate: null,
        latencyMs: Date.now() - started,
        model,
        detail: `HTTP ${res.status} ${body?.error?.message ?? ""}`.trim(),
      };
    }

    json = (await res.json()) as GeminiResponse;
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

  const usage: ProviderUsage = {
    prompt: json.usageMetadata?.promptTokenCount ?? 0,
    completion: json.usageMetadata?.candidatesTokenCount ?? 0,
  };
  const candidate = json.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text ?? "";
  if (text.length === 0) {
    return {
      ok: false,
      kind: "empty",
      retryAfterMs: null,
      usage,
      rate: null,
      latencyMs: Date.now() - started,
      model,
      detail: `finishReason=${candidate?.finishReason ?? "unknown"}`,
    };
  }

  return { ok: true, text, usage, rate: null, latencyMs: Date.now() - started, model };
}
