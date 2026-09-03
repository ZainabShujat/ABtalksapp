import "server-only";
import { logger } from "@/lib/logger";
import { normalizeParsedResume } from "@/features/resume/normalize";
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
 * The API key is read here and nowhere else.
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
- Copy achievement and responsibility bullets close to the candidate's own wording. Do not rewrite them to sound better, and do not add numbers that are not in the document.
- "estimated_experience_years" is total professional working years, excluding time spent studying. Return 0 when the candidate has no professional experience.
- Certifications: MUST strictly be formal licenses, credentials, or course certificates issued by an accredited authority, cloud provider, or recognized education vendor (e.g., 'AWS Certified Solutions Architect', 'CompTIA Security+', 'Meta Front-End Developer Certificate').
  STRICTLY FORBIDDEN IN "certifications": Open source contributions, GitHub PRs/repositories, hackathon wins or participations, coding competition ratings (e.g. LeetCode, Codeforces, CodeChef), academic coursework/subjects, extracurricular/club leadership, scholarships, and research publications. NEVER place these into "certifications".
- Projects & Open Source: Extract all software projects, open source contributions, repositories, apps, and tools created or contributed to into "projects". For open-source contributions (e.g., bug fixes, features, or PRs to open-source libraries), record them as entries in "projects" with the repository or project name as "title", contribution summary in "description", specific PRs/work in "contributions", tech stack in "technologies", and repository link in "github".
- Achievements: Competitions, hackathons, awards, scholarships, academic honors, and competitive coding milestones (e.g. LeetCode rating, Codeforces rank, Hackathon Winner). These belong strictly in "achievements", never in "certifications".
- Experience & Internships: Professional employment, contracted roles, and internships. Extracurricular roles, student clubs, or volunteering belong in "experience" with appropriate employment_type (or in "achievements"), never in "certifications".
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

export function isParserConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Parse a résumé document into the canonical structure.
 *
 * Messages returned on failure are user-facing: no vendor names, no status
 * codes, no stack traces. The technical detail goes to the logger.
 */
export async function parseResumeDocument({
  bytes,
  mimeType,
  fileName,
}: {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string | null;
}): Promise<ParseResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.error("[resume] GEMINI_API_KEY is not set");
    return {
      ok: false,
      message: "Résumé analysis is temporarily unavailable. Please try again later.",
    };
  }

  const model =
    process.env.RESUME_GEMINI_MODEL ?? process.env.GEMINI_MODEL ?? RESUME_DEFAULT_MODEL;

  const user = fileName
    ? `${RESUME_SCHEMA_PROMPT}\n\nOriginal filename: ${fileName}`
    : RESUME_SCHEMA_PROMPT;

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
      logger.error("[resume] parser request failed", {
        status: res.status,
        detail: body?.error?.message ?? null,
      });
      return {
        ok: false,
        message:
          res.status === 429
            ? "Résumé analysis is busy right now. Please try again in a few minutes."
            : "We could not analyse this résumé. Please try again.",
      };
    }

    json = (await res.json()) as GeminiResponse;
  } catch (error) {
    logger.error("[resume] parser request threw", { error: String(error) });
    return { ok: false, message: "We could not analyse this résumé. Please try again." };
  }

  const candidate = json.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text ?? "";
  if (text.length === 0) {
    logger.error("[resume] parser returned no text", {
      finishReason: candidate?.finishReason ?? "unknown",
    });
    return {
      ok: false,
      message:
        "We could not read this document. Make sure it is a text-based PDF rather than a scan or photo.",
    };
  }

  const raw = parseFirstJsonObject(text);
  if (raw === null) {
    logger.error("[resume] parser returned unusable JSON");
    return { ok: false, message: "We could not analyse this résumé. Please try again." };
  }

  return { ok: true, data: normalizeParsedResume(raw) };
}
