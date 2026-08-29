/**
 * Corpus TYPES and the chunker — pure, and deliberately free of `server-only`.
 *
 * Split out of `corpus.ts` so that "what a chunk is and how markdown becomes
 * chunks" can be imported by a plain Node process. `corpus.ts` keeps the parts
 * that genuinely touch the filesystem and therefore genuinely belong to the
 * server; nothing here reads a file, so nothing here needs to be fenced off.
 *
 * The point is that the retrieval regression suite exercises THIS chunker, not
 * a reimplementation of it. A test that chunks differently from production is
 * testing a different system.
 */

export type ChunkOrigin = "curated" | "site" | "legacy";

export type Chunk = {
  /** Stable id: `<origin>:<file>#<index>`. Used by the embedding artifact. */
  id: string;
  text: string;
  source: string;
  origin: ChunkOrigin;
  /** Public route this content came from. Site chunks only. */
  route: string | null;
  /** ISO timestamp from the ingest run. Site chunks only. */
  ingestedAt: string | null;
};

/**
 * Score multipliers by origin.
 *
 * `curated` at 1.15 is enough to win a tie or a near-tie without letting a
 * weakly-matching curated chunk displace a site chunk that genuinely answers
 * the question.
 *
 * `legacy` exists because one curated file — the August site snapshot — is
 * both the largest document in the corpus and the most out of date. Sheer
 * length made it outrank purpose-written topic files on general questions,
 * which is how a superseded pricing line kept resurfacing. It still holds real
 * material, so it is demoted rather than deleted.
 */
export const ORIGIN_WEIGHT: Record<ChunkOrigin, number> = {
  curated: 1.15,
  site: 1,
  legacy: 0.8,
};

/**
 * A curated file opts into demotion by declaring it in its own banner. Keeping
 * the marker in the document means the precedence rule is visible to whoever
 * edits the knowledge, not buried in a hard-coded filename list here.
 */
export const LEGACY_MARKER = "LOWEST PRECEDENCE";

type FrontMatter = { route: string | null; ingestedAt: string | null; body: string };

/**
 * Ingested files carry YAML front matter (route, url, title, source_type,
 * ingested_at). Parsed by hand rather than with a YAML dependency: the shape is
 * fixed, written by our own ingest script, and only two fields are read.
 */
export function parseFrontMatter(raw: string): FrontMatter {
  if (!raw.startsWith("---")) return { route: null, ingestedAt: null, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { route: null, ingestedAt: null, body: raw };

  const header = raw.slice(3, end);
  const body = raw.slice(end + 4);
  const read = (key: string): string | null => {
    const match = header.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return match ? match[1].trim() : null;
  };
  return { route: read("route"), ingestedAt: read("ingested_at"), body };
}

/**
 * Splits markdown on `##`–`####` headings, carrying the heading into each
 * chunk so a retrieved fragment still says what it is about. Oversized chunks
 * are re-split on blank lines.
 */
export function chunkMarkdown(
  text: string,
  meta: Omit<Chunk, "id" | "text">,
): Chunk[] {
  const pieces: string[] = [];
  let current = "";
  let heading = "";

  for (const line of text.split("\n")) {
    if (/^#{2,4}\s/.test(line)) {
      if (current.trim().length > 20) {
        pieces.push((heading ? `${heading}\n` : "") + current.trim());
      }
      heading = line.trim();
      current = "";
    } else {
      current += `${line}\n`;
    }
  }
  if (current.trim().length > 20) {
    pieces.push((heading ? `${heading}\n` : "") + current.trim());
  }

  const refined: string[] = [];
  for (const piece of pieces) {
    if (piece.length <= 1000) {
      refined.push(piece);
      continue;
    }
    let sub = "";
    for (const para of piece.split("\n\n")) {
      if (sub.length + para.length > 1000 && sub.trim()) {
        refined.push(sub.trim());
        sub = "";
      }
      sub += `${para}\n\n`;
    }
    if (sub.trim()) refined.push(sub.trim());
  }

  return refined.map((body, index) => ({
    ...meta,
    id: `${meta.origin}:${meta.source}#${index}`,
    text: body,
  }));
}

/**
 * Turns raw files into chunks. The caller supplies the bytes, so this works
 * identically whether they came from `fs` on the server or from a test harness.
 */
export function buildChunks(
  files: { name: string; content: string; origin: ChunkOrigin }[],
): Chunk[] {
  const chunks: Chunk[] = [];
  for (const file of files) {
    // README files document the directory for humans; they are not knowledge.
    if (file.name.toLowerCase() === "readme.md") continue;
    const { route, ingestedAt, body } = parseFrontMatter(file.content);
    // Only curated files can self-declare as legacy; a scraped page has no
    // business demoting itself.
    const origin: ChunkOrigin =
      file.origin === "curated" && body.slice(0, 1500).includes(LEGACY_MARKER)
        ? "legacy"
        : file.origin;
    chunks.push(
      ...chunkMarkdown(body, { source: file.name, origin, route, ingestedAt }),
    );
  }
  return chunks;
}

/**
 * The attribution line prepended to each chunk in the model's context. Naming
 * the origin lets the prompt's precedence rule ("curated wins") be something
 * the model can actually apply, and the ingest date lets it avoid presenting
 * a stale scrape as current.
 */
export function contextLabel(chunk: Chunk): string {
  if (chunk.origin === "curated") return `[verified: ${chunk.source}]`;
  if (chunk.origin === "legacy") {
    return `[older snapshot, superseded by any verified source: ${chunk.source}]`;
  }
  const route = chunk.route ? ` ${chunk.route}` : "";
  const when = chunk.ingestedAt ? `, captured ${chunk.ingestedAt.slice(0, 10)}` : "";
  return `[live site${route}${when}]`;
}

/** Unit-normalises a vector so a dot product is the cosine similarity. */
export function normalise(vector: number[]): number[] {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const magnitude = Math.sqrt(sum);
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}

/**
 * Both sides are stored unit-normalised, so the dot product IS the cosine
 * similarity and the per-comparison square roots disappear.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}
