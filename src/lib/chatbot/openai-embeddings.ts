import { normalise } from "@/lib/chatbot/chunking";

/**
 * The OpenAI embeddings call.
 *
 * Pure in the sense that matters here: it needs a network and an API key, but
 * nothing about it is Next-server-specific, so it carries no `server-only`
 * fence. That lets the offline embedding builder and the retrieval regression
 * suite — both plain Node scripts — use the SAME request the server uses,
 * rather than each hand-rolling its own and drifting from it.
 *
 * The key is always passed in, never read from `process.env` in here, so no
 * caller can accidentally make this reachable from a bundle that ships to a
 * browser.
 */

const OPENAI_URL = "https://api.openai.com/v1/embeddings";

export const EMBEDDING_MODEL = "text-embedding-3-small";

export type EmbeddingArtifact = {
  model: string;
  createdAt: string;
  /** Chunk id -> unit-normalised vector. */
  vectors: Record<string, number[]>;
};

export type EmbedResult =
  | { ok: true; vectors: number[][] }
  | { ok: false; reason: string };

/**
 * Returns a result rather than throwing, and never returns a partial batch:
 * a half-populated vector set would silently rank some chunks at zero, which
 * looks like a retrieval quality problem rather than a missing embedding.
 */
export async function embedTexts(
  texts: string[],
  apiKey: string,
): Promise<EmbedResult> {
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
    });
    if (!response.ok) {
      return { ok: false, reason: `OpenAI embeddings HTTP ${response.status}` };
    }
    const json = (await response.json()) as {
      data?: { embedding: number[]; index: number }[];
    };
    if (!json.data || json.data.length !== texts.length) {
      return { ok: false, reason: "OpenAI embeddings returned an incomplete batch" };
    }
    const ordered = [...json.data].sort((a, b) => a.index - b.index);
    return { ok: true, vectors: ordered.map((row) => normalise(row.embedding)) };
  } catch (error) {
    return { ok: false, reason: `OpenAI embeddings request threw: ${String(error)}` };
  }
}
