import { readFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "@/lib/logger";

/**
 * The interviewer's knowledge of what was actually TAUGHT.
 *
 * `knowledge/ai-cohort-interview/core-concepts.md` is an authored, per-day
 * knowledge base: the concept, what a candidate should understand, the common
 * misconceptions, and the follow-ups worth asking. Until now none of it reached
 * the interviewer, which is why the conversation felt rigid — the model knew the
 * question but not the subject, so it could not tell a wrong answer from an
 * unusual one, could not simplify without losing the point, and could not
 * follow up on anything the bank had not pre-written.
 *
 * It is CONTEXT, never content. Nothing here becomes a question, an evidence
 * item or a score: the bank still owns what is assessed. This only lets the
 * model conduct the conversation around it competently.
 *
 * No `server-only` import: it would break the offline verifier scripts, and
 * the `node:fs/promises` import already makes this impossible to bundle for the
 * browser, which is the protection that actually matters.
 *
 * Read once and cached for the life of the process — it is a static file, and
 * re-reading it per turn would put disk I/O on the interview's critical path.
 */

const KB_PATH = path.join(
  process.cwd(),
  "knowledge",
  "ai-cohort-interview",
  "core-concepts.md",
);

/** Characters of curriculum context passed for one question. */
const MAX_DAY_CHARS = 1_400;

let cache: Map<number, string> | null = null;

/**
 * Splits the document on its `# DAY n` headings.
 *
 * Tolerant by design: a missing file or a heading that stops matching yields an
 * empty map rather than an exception. The interview must still run when its
 * curriculum notes are unavailable — it simply loses the extra context.
 */
function parseDays(markdown: string): Map<number, string> {
  const days = new Map<number, string>();
  const heading = /^# DAY (\d+)\b.*$/gm;

  const marks: { day: number; start: number }[] = [];
  for (const m of markdown.matchAll(heading)) {
    marks.push({ day: Number(m[1]), start: m.index ?? 0 });
  }

  for (let i = 0; i < marks.length; i++) {
    const { day, start } = marks[i]!;
    const end = marks[i + 1]?.start ?? markdown.length;
    days.set(day, markdown.slice(start, end).trim());
  }
  return days;
}

async function load(): Promise<Map<number, string>> {
  if (cache) return cache;
  try {
    const raw = await readFile(KB_PATH, "utf8");
    cache = parseDays(raw);
    logger.info("[interview] curriculum knowledge base loaded", {
      days: cache.size,
    });
  } catch (err) {
    logger.warn("[interview] curriculum knowledge base unavailable", {
      error: err instanceof Error ? err.message : String(err),
    });
    cache = new Map();
  }
  return cache;
}

/**
 * What was taught on the days a question draws on.
 *
 * Capped hard. A question can cite several days, the whole document is over
 * 1,500 lines, and prompt size is charged against a tokens-per-minute budget
 * that a long interview can already exhaust — an interviewer that runs out of
 * quota mid-session degrades to keyword heuristics, which is far worse than one
 * with slightly less context.
 */
export async function curriculumFor(sourceDays: readonly number[]): Promise<string> {
  if (sourceDays.length === 0) return "";
  const days = await load();
  if (days.size === 0) return "";

  const budget = Math.max(1, Math.floor(MAX_DAY_CHARS / sourceDays.length));
  const parts: string[] = [];

  for (const day of sourceDays) {
    const text = days.get(day);
    if (!text) continue;
    parts.push(text.length > budget ? `${text.slice(0, budget)}…` : text);
  }

  return parts.join("\n\n");
}
