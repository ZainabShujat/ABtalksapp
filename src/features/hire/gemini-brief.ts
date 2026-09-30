import "server-only";

/**
 * Recruiter free text → a grounded `JobSpec` patch, via Gemini.
 *
 * Two callers: the composer's debounced tick route (`/api/hire/brief`) and
 * `runScoutTurn`, which merges the same patch into the spec Search ranks on.
 * The in-process cache means the brief the recruiter typed and then sent is
 * usually parsed once, and an in-flight call is shared rather than repeated.
 *
 * Failure is never an error for the recruiter: the composer falls back to
 * `detectSpokenBrief` and the turn keeps the Scout agent's own spec.
 * The text is never logged; only status, reason and model.
 */
import { logger } from "@/lib/logger";
import type { JobSpec } from "@/lib/validations/hire";
import {
  briefFlags,
  geminiBriefSchema,
  toBriefPatch,
  type SpokenBriefFlags,
} from "@/features/hire/hire-brief";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Fast and cheap: this runs while the recruiter types. */
export const HIRE_BRIEF_DEFAULT_MODEL = "gemini-3.5-flash-lite";

const DEFAULT_TIMEOUT_MS = 4000;
const MAX_OUTPUT_TOKENS = 400;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 300;

const SYSTEM_PROMPT = `You read a recruiter's message on an Indian tech hiring platform and extract the hiring brief it states.
Return ONE JSON object and nothing else: no markdown, no code fences, no prose.

Keys: isHiringBrief, title, locationCity, workMode, minExperience, maxExperience, seniority, education, requiresDegree, mustHaveStack, employmentType, noticePeriodDays, salaryText.

Rules:
- Extract only what the text states. Anything not stated is null (mustHaveStack: []). Never guess, never use world knowledge, never fill defaults.
- isHiringBrief: true only if the text describes someone to hire or criteria for candidates. Trivia, greetings, or questions about the world ("who is PM of India") are false, with every other field null.
- title: the role as written, short ("AI engineer", "SDE-2", "Data analyst"). A specialty alone becomes a role ("backend" -> "Backend engineer", "devops" -> "DevOps engineer"). null if no role.
- locationCity: a city or metro region exactly as the recruiter wrote it ("Kochi", "Bangalore", "Delhi NCR"). Countries are not cities (null). Never put remote/hybrid/onsite here.
- workMode: REMOTE (remote, wfh, work from home), HYBRID, ONSITE (onsite, on-site, work from office), FLEXIBLE (any mode). null if not stated.
- minExperience / maxExperience: whole years as stated. "2 yoe" / "2+ years" -> min 2. "2-4 years" -> 2 and 4. "up to 3 years" -> max 3. "two years" -> 2.
- seniority: INTERN, JUNIOR (fresher, entry level, junior), MID, SENIOR, LEAD (lead, staff, principal). Only from a seniority word; never derive it from years.
- education: the degree or qualification words as written ("B.Tech", "BE", "MSc", "PhD", "IIT", "any graduate"), else null.
- requiresDegree: true if any degree or qualification is asked for; false only if the text says no degree is needed; else null.
- mustHaveStack: technologies and skills explicitly named, lowercase. Normalise aliases (JS -> javascript, TS -> typescript, Node.js -> node, ReactJS -> react, Postgres -> postgresql, K8s -> kubernetes). Keep "golang" as "golang" and the language Go as "go". Leave out anything negated ("no java"). Never add related skills that were not named.
- employmentType: FULL_TIME, PART_TIME, CONTRACT, INTERNSHIP, FREELANCE, only if stated.
- noticePeriodDays: whole days if stated ("immediate joiner" -> 0, "30 days notice" -> 30).
- salaryText: the budget or salary phrase copied verbatim ("12-18 LPA", "20k per month"). Never compute a number. null if none.`;

export type HireBriefFailure =
  | "unconfigured"
  | "empty"
  | "http"
  | "rate_limited"
  | "timeout"
  | "invalid";

export type HireBriefResult =
  | { ok: true; patch: JobSpec; flags: SpokenBriefFlags }
  | { ok: false; reason: HireBriefFailure };

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
};

/**
 * Shared platform Gemini key (`GEMINI_API_KEY`) — same as résumé, interview and
 * chatbot. Unset and the regex detector is used for /hire ticks and search.
 */
function apiKeyFromEnv(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null;
}

export function isHireBriefConfigured(): boolean {
  return apiKeyFromEnv() != null;
}

const cache = new Map<string, { at: number; result: HireBriefResult }>();
const inflight = new Map<string, Promise<HireBriefResult>>();

function cacheKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function readCache(key: string, now: number): HireBriefResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.result;
}

function writeCache(key: string, result: HireBriefResult, now: number) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: now, result });
}

/** JSON object out of the reply, tolerating a stray fence. */
function parseJsonObject(text: string): unknown {
  const stripped = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
}

export type ExtractHireBriefOptions = {
  timeoutMs?: number;
  /** Tests inject this; production uses global fetch. */
  fetchImpl?: typeof fetch;
  /** `null` forces "unconfigured"; omitted reads the environment. */
  apiKey?: string | null;
  model?: string;
  /** Tests turn the cache off so each case calls the fake. */
  useCache?: boolean;
};

async function callGemini(
  text: string,
  opts: ExtractHireBriefOptions,
  apiKey: string,
): Promise<HireBriefResult> {
  const model =
    opts.model || process.env.HIRE_BRIEF_GEMINI_MODEL?.trim() || HIRE_BRIEF_DEFAULT_MODEL;
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let json: GeminiResponse;
  try {
    const res = await doFetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [{ text: `Recruiter message:\n"""\n${text}\n"""` }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          temperature: 0,
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as GeminiResponse | null;
      logger.warn("[hire-brief] gemini request failed", {
        status: res.status,
        model,
        detail: body?.error?.message?.slice(0, 200) ?? null,
      });
      return { ok: false, reason: res.status === 429 ? "rate_limited" : "http" };
    }
    json = (await res.json()) as GeminiResponse;
  } catch (error) {
    const timedOut = controller.signal.aborted;
    logger.warn("[hire-brief] gemini request threw", {
      model,
      reason: timedOut ? "timeout" : "network",
      error: timedOut ? null : String(error).slice(0, 200),
    });
    return { ok: false, reason: timedOut ? "timeout" : "http" };
  } finally {
    clearTimeout(timer);
  }

  const reply = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const parsed = geminiBriefSchema.safeParse(parseJsonObject(reply));
  if (!parsed.success) {
    logger.warn("[hire-brief] gemini returned an unusable brief", { model });
    return { ok: false, reason: "invalid" };
  }
  const patch = toBriefPatch(parsed.data, text);
  return { ok: true, patch, flags: briefFlags(patch, text) };
}

/**
 * Parse one piece of recruiter text. Never throws.
 */
export async function extractHireBrief(
  raw: string,
  opts: ExtractHireBriefOptions = {},
): Promise<HireBriefResult> {
  const text = raw.trim().slice(0, 2000);
  if (!text) return { ok: false, reason: "empty" };
  const apiKey = opts.apiKey === undefined ? apiKeyFromEnv() : opts.apiKey;
  if (!apiKey) return { ok: false, reason: "unconfigured" };

  const useCache = opts.useCache ?? true;
  const key = cacheKey(text);
  if (useCache) {
    const hit = readCache(key, Date.now());
    if (hit) return hit;
    const pending = inflight.get(key);
    if (pending) return pending;
  }

  const run = callGemini(text, opts, apiKey)
    .catch((error): HireBriefResult => {
      logger.error("[hire-brief] extract failed", { error: String(error).slice(0, 200) });
      return { ok: false, reason: "invalid" };
    })
    .then((result) => {
      // Only successes are cached: a timeout now should not pin the fallback.
      if (useCache && result.ok) writeCache(key, result, Date.now());
      return result;
    })
    .finally(() => {
      if (useCache) inflight.delete(key);
    });
  if (useCache) inflight.set(key, run);
  return run;
}
