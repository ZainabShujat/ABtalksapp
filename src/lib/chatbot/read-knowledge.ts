import fs from "node:fs";
import path from "node:path";
import type { ChunkOrigin } from "@/lib/chatbot/chunking";

/**
 * Reads the knowledge directories off disk.
 *
 * Uses `fs`, but carries no `server-only` fence: reading files is a plain Node
 * capability, and three callers need it — the Next server (`corpus.ts`), the
 * offline embedding builder, and the retrieval regression suite. Fencing it
 * would force the two scripts to reimplement corpus assembly, which is exactly
 * how a test starts describing something other than production.
 *
 * `knowledge/archive/` is deliberately absent. It holds documents kept for
 * human reference that must never reach an end user.
 */

export const PROCESSED_DIR = path.join(process.cwd(), "knowledge", "processed");
export const GENERATED_DIR = path.join(process.cwd(), "knowledge", "generated");
export const EMBEDDINGS_PATH = path.join(
  process.cwd(),
  "knowledge",
  "embeddings.json",
);

export type KnowledgeFile = {
  name: string;
  content: string;
  origin: ChunkOrigin;
};

function readDir(dir: string, origin: ChunkOrigin): KnowledgeFile[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((name) => ({
        name,
        content: fs.readFileSync(path.join(dir, name), "utf-8"),
        origin,
      }));
  } catch {
    // A missing generated/ directory is normal before the first ingest run.
    return [];
  }
}

/**
 * Curated first, then site — the order the chunk ids in the embedding artifact
 * were generated in. Ids embed the origin and filename, so ordering does not
 * affect correctness, but keeping it stable keeps artifact diffs readable.
 */
export function readKnowledgeFiles(): KnowledgeFile[] {
  return [
    ...readDir(PROCESSED_DIR, "curated"),
    ...readDir(GENERATED_DIR, "site"),
  ];
}
