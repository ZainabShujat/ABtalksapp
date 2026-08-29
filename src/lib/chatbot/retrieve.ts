import "server-only";
import { logger } from "@/lib/logger";
import { contextLabel, loadCorpus } from "@/lib/chatbot/corpus";
import { cosine, type Chunk } from "@/lib/chatbot/chunking";
import { buildLexicalIndex, type LexicalIndex } from "@/lib/chatbot/lexical";
import {
  rankAndGate,
  type RetrievalResult,
  type ScoredChunk,
} from "@/lib/chatbot/engine";
import {
  embedQuery,
  isSemanticSearchAvailable,
  loadEmbeddingArtifact,
} from "@/lib/chatbot/embeddings";

/**
 * Server wrapper around the retrieval engine.
 *
 * It does the two things the engine deliberately cannot: read the corpus from
 * disk, and ask OpenAI for the query's embedding. All ranking and every gating
 * decision belong to `engine.ts`, so the regression suite can exercise the real
 * behaviour without a Next.js runtime — and so a test result describes
 * production rather than a parallel implementation of it.
 */

export type {
  RetrievalResult,
  RetrievalVerdict,
  ScoredChunk,
} from "@/lib/chatbot/engine";

let index: LexicalIndex | null = null;

function getIndex(): LexicalIndex {
  if (!index) index = buildLexicalIndex(loadCorpus());
  return index;
}

export function resetRetrievalCache(): void {
  index = null;
}

export async function retrieve(query: string): Promise<RetrievalResult> {
  const lexicalIndex = getIndex();

  // The semantic input is assembled here and handed in whole, so the engine
  // never has to know whether a vector came from a file, a cache or a network
  // call — only how to score with one.
  let semantic: { similarityFor: (chunk: Chunk) => number | null } | null = null;
  if (isSemanticSearchAvailable()) {
    const queryVector = await embedQuery(query);
    const artifact = loadEmbeddingArtifact();
    if (queryVector && artifact) {
      semantic = {
        similarityFor: (chunk) => {
          const vector = artifact.vectors[chunk.id];
          return vector ? cosine(queryVector, vector) : null;
        },
      };
    }
  }

  const result = rankAndGate(lexicalIndex, query, semantic);

  if (process.env.CHATBOT_DEBUG === "true") {
    logger.info("Chatbot retrieval", {
      query,
      verdict: result.verdict,
      confidence: Number(result.topScore.toFixed(3)),
      lexicalOnly: result.lexicalOnly,
      top: result.results[0]?.chunk.source ?? null,
    });
  }

  return result;
}

/** Renders retrieved chunks into the block handed to the generation provider. */
export function buildContext(results: ScoredChunk[]): string {
  return results
    .map((r) => `${contextLabel(r.chunk)}\n${r.chunk.text}`)
    .join("\n\n---\n\n");
}
