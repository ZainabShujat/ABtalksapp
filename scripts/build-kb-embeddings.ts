/**
 * Builds the chatbot's semantic search artifact.
 *
 *   npm run kb:embed              # embed chunks that changed
 *   npm run kb:embed -- --force   # re-embed everything
 *   npm run kb:embed -- --dry-run # report cost, call nothing
 *
 * Run this after editing anything under `knowledge/`. It is deliberately NOT
 * part of `next build`: embedding is a paid call, and a build hook would spend
 * the month's OpenAI budget on every deploy and every preview.
 *
 * Incremental by default. Chunk text is hashed, and a chunk whose hash is
 * unchanged keeps its existing vector — so a typo fix in one file costs one
 * embedding, not two hundred.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { buildChunks } from "../src/lib/chatbot/chunking";
import { readKnowledgeFiles } from "../src/lib/chatbot/read-knowledge";
import {
  EMBEDDING_MODEL,
  embedTexts,
} from "../src/lib/chatbot/openai-embeddings";

config({ path: ".env.local" });
config();

const ARTIFACT = path.join(process.cwd(), "knowledge", "embeddings.json");
/** text-embedding-3-small, per 1M tokens, USD. Used for the estimate only. */
const USD_PER_MILLION_TOKENS = 0.02;
const BATCH_SIZE = 96;

type Artifact = {
  model: string;
  createdAt: string;
  hashes: Record<string, string>;
  vectors: Record<string, number[]>;
};

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function readArtifact(): Artifact | null {
  try {
    return JSON.parse(readFileSync(ARTIFACT, "utf-8")) as Artifact;
  } catch {
    return null;
  }
}

async function main() {
  const force = process.argv.includes("--force");
  const dryRun = process.argv.includes("--dry-run");

  const chunks = buildChunks(readKnowledgeFiles());
  if (chunks.length === 0) {
    console.error("No chunks found — is knowledge/processed populated?");
    process.exit(1);
  }

  const existing = force ? null : readArtifact();
  const reusable =
    existing && existing.model === EMBEDDING_MODEL ? existing : null;

  const hashes: Record<string, string> = {};
  const vectors: Record<string, number[]> = {};
  const todo: { id: string; text: string }[] = [];

  for (const chunk of chunks) {
    const digest = hash(chunk.text);
    hashes[chunk.id] = digest;
    const cachedVector = reusable?.vectors[chunk.id];
    if (cachedVector && reusable?.hashes[chunk.id] === digest) {
      vectors[chunk.id] = cachedVector;
    } else {
      todo.push({ id: chunk.id, text: chunk.text });
    }
  }

  const characters = todo.reduce((sum, t) => sum + t.text.length, 0);
  const approxTokens = Math.ceil(characters / 4);
  const estimate = (approxTokens / 1_000_000) * USD_PER_MILLION_TOKENS;

  console.log(`corpus     : ${chunks.length} chunks`);
  console.log(`reused     : ${Object.keys(vectors).length}`);
  console.log(`to embed   : ${todo.length}`);
  console.log(
    `est. cost  : ~$${estimate.toFixed(4)} (${approxTokens.toLocaleString()} tokens)`,
  );

  if (dryRun) {
    console.log("\n--dry-run: no API calls made.");
    return;
  }
  if (todo.length === 0) {
    console.log("\nNothing to embed — artifact is already current.");
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("\nOPENAI_API_KEY is not set. Aborting without writing.");
    process.exit(1);
  }

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    process.stdout.write(
      `embedding ${i + 1}-${i + batch.length} of ${todo.length}... `,
    );
    const embedded = await embedTexts(
      batch.map((b) => b.text),
      apiKey,
    );
    if (!embedded.ok) {
      // Partial artifacts are worse than none: retrieval would silently rank
      // against a half-populated field. Fail without writing.
      console.error(
        `\nEmbedding batch failed (${embedded.reason}). Artifact NOT written.`,
      );
      process.exit(1);
    }
    batch.forEach((item, index) => {
      vectors[item.id] = embedded.vectors[index];
    });
    console.log("ok");
  }

  const artifact: Artifact = {
    model: EMBEDDING_MODEL,
    createdAt: new Date().toISOString(),
    hashes,
    vectors,
  };
  writeFileSync(ARTIFACT, JSON.stringify(artifact));
  console.log(
    `\nWrote ${ARTIFACT} — ${Object.keys(vectors).length} vectors, ${EMBEDDING_MODEL}.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
