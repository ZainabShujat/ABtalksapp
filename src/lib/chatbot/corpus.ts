import "server-only";
import fs from "node:fs";
import path from "node:path";
import { logger } from "@/lib/logger";
import { buildChunks, type Chunk, type ChunkOrigin } from "@/lib/chatbot/chunking";

/**
 * Reads the knowledge corpus off disk.
 *
 * This module is `server-only` because it is the part that genuinely touches
 * the filesystem — and only that part. The chunker, the types and the
 * precedence weights live in `chunking.ts`, which any Node process may import.
 *
 * TWO directories, deliberately not merged into one:
 *
 *   knowledge/processed/  curated, hand-verified       -> origin "curated"
 *   knowledge/generated/  ingested from the public site -> origin "site"
 *
 * `knowledge/archive/` is never read. It holds documents kept for human
 * reference that must not reach an end user — most importantly the assistant's
 * own implementation plan, which used to sit in `processed/` and was therefore
 * retrievable by anyone who asked the bot how it worked.
 */

export const PROCESSED_DIR = path.join(process.cwd(), "knowledge", "processed");
export const GENERATED_DIR = path.join(process.cwd(), "knowledge", "generated");

export {
  ORIGIN_WEIGHT,
  contextLabel,
  type Chunk,
  type ChunkOrigin,
} from "@/lib/chatbot/chunking";

function readDir(
  dir: string,
  origin: ChunkOrigin,
): { name: string; content: string; origin: ChunkOrigin }[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((name) => ({
        name,
        content: fs.readFileSync(path.join(dir, name), "utf-8"),
        origin,
      }));
  } catch {
    // A missing generated/ directory is normal before the first ingest run.
    logger.warn("Chatbot corpus directory unavailable", { dir, origin });
    return [];
  }
}

let cached: Chunk[] | null = null;
let cachedFingerprint = "";

/**
 * Cheap change-detector: filenames plus modification times.
 *
 * The corpus used to be cached for the whole process lifetime, which meant
 * `npm run ingest:site` had no effect on a running server until someone
 * restarted it — the one moment you most want the new content live. Stat-ing
 * ~35 files is microseconds and happens once per request, against a retrieval
 * step that already does an OpenAI round trip.
 */
function fingerprint(): string {
  const parts: string[] = [];
  for (const dir of [PROCESSED_DIR, GENERATED_DIR]) {
    try {
      for (const name of fs.readdirSync(dir).sort()) {
        if (!name.endsWith(".md")) continue;
        parts.push(`${name}:${fs.statSync(path.join(dir, name)).mtimeMs}`);
      }
    } catch {
      // Directory missing is itself part of the fingerprint.
      parts.push(`${dir}:absent`);
    }
  }
  return parts.join("|");
}

export function loadCorpus(): Chunk[] {
  const current = fingerprint();
  if (cached && current === cachedFingerprint) return cached;
  if (cached) {
    logger.info("Chatbot corpus changed on disk — rebuilding index");
  }
  const chunks = buildChunks([
    ...readDir(PROCESSED_DIR, "curated"),
    ...readDir(GENERATED_DIR, "site"),
  ]);
  logger.info("Chatbot corpus loaded", {
    chunks: chunks.length,
    curated: chunks.filter((c) => c.origin === "curated").length,
    site: chunks.filter((c) => c.origin === "site").length,
    legacy: chunks.filter((c) => c.origin === "legacy").length,
  });
  cached = chunks;
  cachedFingerprint = current;
  return cached;
}

/** Test hook — rebuilds the index between fixtures. */
export function resetCorpusCache(): void {
  cached = null;
  cachedFingerprint = "";
}
