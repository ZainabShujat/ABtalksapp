import "server-only";
import fs from "node:fs";
import path from "node:path";
import { logger } from "@/lib/logger";
import {
  embedTexts,
  type EmbeddingArtifact,
} from "@/lib/chatbot/openai-embeddings";

/**
 * Semantic half of the hybrid retriever.
 *
 * Chunk vectors are built OFFLINE by `npm run kb:embed` and committed as an
 * artifact. At request time the only OpenAI call is a single query embedding —
 * that is what keeps this inside a ~$4/month budget. Re-embedding 200 chunks
 * per request would burn the month's credit in an afternoon.
 *
 * Every failure path here degrades to lexical-only retrieval rather than
 * throwing. A missing artifact, an unset key, a rate-limited request and a
 * corpus that has drifted since the last embed run must all leave a working
 * (if slightly blunter) chatbot, because BM25 alone still answers most
 * questions in this corpus.
 */

const ARTIFACT_PATH = path.join(process.cwd(), "knowledge", "embeddings.json");

// The request itself and the artifact shape live in `openai-embeddings.ts`,
// which carries no `server-only` fence so the offline builder and the
// regression suite can reuse the exact same call.
export {
  EMBEDDING_MODEL,
  embedTexts,
  type EmbeddingArtifact,
} from "@/lib/chatbot/openai-embeddings";

let artifact: EmbeddingArtifact | null = null;
let artifactMissingLogged = false;

export function loadEmbeddingArtifact(): EmbeddingArtifact | null {
  if (artifact) return artifact;
  try {
    const parsed = JSON.parse(
      fs.readFileSync(ARTIFACT_PATH, "utf-8"),
    ) as EmbeddingArtifact;
    if (!parsed.vectors || typeof parsed.vectors !== "object") return null;
    artifact = parsed;
    return artifact;
  } catch {
    if (!artifactMissingLogged) {
      artifactMissingLogged = true;
      logger.warn(
        "Chatbot embedding artifact unavailable — falling back to lexical-only retrieval",
        { path: ARTIFACT_PATH },
      );
    }
    return null;
  }
}

export function resetEmbeddingCache(): void {
  artifact = null;
  artifactMissingLogged = false;
}

export function isSemanticSearchAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && loadEmbeddingArtifact() !== null;
}

/** In-process cache of query vectors — repeated/suggested questions are common. */
const queryCache = new Map<string, number[]>();
const QUERY_CACHE_LIMIT = 200;

// `normalise` and `cosine` live in chunking.ts: they are pure maths, and the
// regression suite needs them without pulling in this server-only module.
export { cosine, normalise } from "@/lib/chatbot/chunking";

/** Returns null whenever semantic search cannot run — never throws. */
export async function embedQuery(query: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const key = query.trim().toLowerCase();
  const hit = queryCache.get(key);
  if (hit) return hit;

  const result = await embedTexts([query], apiKey);
  if (!result.ok) {
    logger.warn("Chatbot query embedding failed — this request is lexical-only", {
      reason: result.reason,
    });
    return null;
  }
  const vectors = result.vectors;

  if (queryCache.size >= QUERY_CACHE_LIMIT) {
    const oldest = queryCache.keys().next().value;
    if (oldest !== undefined) queryCache.delete(oldest);
  }
  queryCache.set(key, vectors[0]);
  return vectors[0];
}
