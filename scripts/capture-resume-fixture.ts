/**
 * Records the model's RAW response for the fixture PDF.
 *
 * The e2e test must be deterministic and runnable without an API key, but its
 * input has to be something the real model actually produced — a hand-written
 * "raw" fixture would test the normaliser against a shape nobody has ever
 * received. So this script makes the one live call, saves the raw JSON verbatim,
 * and the test replays it.
 *
 * Re-record only when the prompt or the model changes, and read the diff: the
 * recorded file is evidence, not configuration.
 *
 * Run: npm run build:resume-fixture:record   (needs GEMINI_API_KEY)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

// Same order as scripts/measure-interview-cost.ts: .env.local wins.
config({ path: ".env.local" });
config();

const DIR = join(process.cwd(), "src", "features", "resume", "fixtures");
const PDF = join(DIR, "sample-resume.pdf");
const OUT = join(DIR, "sample-resume.raw.json");

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  // The real prompt, imported rather than copied: a duplicated prompt in a
  // recorder drifts from the one production sends, and then the recording is
  // evidence of nothing.
  const { RESUME_SYSTEM_PROMPT, RESUME_SCHEMA_PROMPT, RESUME_DEFAULT_MODEL } =
    await import("@/features/resume/parse");

  const model =
    process.env.RESUME_GEMINI_MODEL ??
    process.env.GEMINI_MODEL ??
    RESUME_DEFAULT_MODEL;

  const bytes = readFileSync(PDF);
  const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: RESUME_SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [
            {
              inline_data: {
                mime_type: "application/pdf",
                data: bytes.toString("base64"),
              },
            },
            { text: `${RESUME_SCHEMA_PROMPT}\n\nOriginal filename: sample-resume.pdf` },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
        temperature: 0,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 400)}`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) {
    throw new Error(
      `no text (finishReason: ${json.candidates?.[0]?.finishReason ?? "unknown"})`,
    );
  }

  // Stored exactly as the model returned it, only re-indented so a re-record
  // produces a readable diff rather than one enormous line.
  const raw: unknown = JSON.parse(text);
  writeFileSync(OUT, `${JSON.stringify(raw, null, 2)}\n`);
  console.log(`Recorded ${OUT} using model ${model}`);
}

void main();
