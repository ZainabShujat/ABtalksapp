import type { Chunk } from "@/lib/chatbot/corpus";
import { expandQuery, expansionsFor, tokenize } from "@/lib/chatbot/text";

/**
 * BM25 lexical retrieval.
 *
 * Kept alongside the embedding search rather than replaced by it. Embeddings
 * are good at "what can a second-year student do" and bad at the things this
 * corpus is full of: exact event titles, `ABT-CC-XXXXX` certificate ids,
 * `@abtalksonai`, route paths, dates. Those are precisely the tokens a lexical
 * index nails and a 1536-dimension average blurs away.
 */

const K1 = 1.5;
const B = 0.75;
/** Expanded synonyms count for less than what the user actually typed. */
const EXPANSION_WEIGHT = 0.6;

export type LexicalIndex = {
  chunks: Chunk[];
  tokensPerChunk: string[][];
  termFrequencies: Record<string, number>[];
  /** Tokens of the chunk's heading plus its filename — its topic label. */
  topicTokens: Set<string>[];
  idf: Record<string, number>;
  averageLength: number;
};

/**
 * A chunk's topic label: its markdown heading and the filename it came from.
 *
 * Term frequency alone cannot tell "the document ABOUT hiring" from "a
 * document that says hiring a lot" — and in a corpus where every file mentions
 * programs, interviews and profiles, that distinction is most of the ranking
 * problem. A heading is the author stating the subject outright, so matching it
 * is qualitatively better evidence than matching body prose.
 */
function topicTokensFor(chunk: Chunk): Set<string> {
  const heading = chunk.text.split("\n", 1)[0] ?? "";
  const filename = chunk.source.replace(/\.md$/, "").replace(/[-_]/g, " ");
  return new Set([...tokenize(heading), ...tokenize(filename)]);
}

export function buildLexicalIndex(chunks: Chunk[]): LexicalIndex {
  const tokensPerChunk: string[][] = [];
  const termFrequencies: Record<string, number>[] = [];
  const topicTokens: Set<string>[] = [];
  const documentFrequency: Record<string, number> = {};

  for (const chunk of chunks) {
    const tokens = tokenize(chunk.text);
    const tf: Record<string, number> = {};
    for (const token of tokens) tf[token] = (tf[token] ?? 0) + 1;
    for (const token of new Set(tokens)) {
      documentFrequency[token] = (documentFrequency[token] ?? 0) + 1;
    }
    tokensPerChunk.push(tokens);
    termFrequencies.push(tf);
    topicTokens.push(topicTokensFor(chunk));
  }

  const n = chunks.length;
  const idf: Record<string, number> = {};
  for (const [term, df] of Object.entries(documentFrequency)) {
    idf[term] = Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  // Measured, not guessed. The previous implementation hard-coded 150, which
  // mis-normalises every chunk once the corpus grows or the chunker changes.
  const totalLength = tokensPerChunk.reduce((sum, t) => sum + t.length, 0);
  const averageLength = n > 0 ? totalLength / n : 1;

  return {
    chunks,
    tokensPerChunk,
    termFrequencies,
    topicTokens,
    idf,
    averageLength,
  };
}

function scoreTerms(
  index: LexicalIndex,
  chunkIndex: number,
  terms: string[],
  weight: number,
): number {
  const tf = index.termFrequencies[chunkIndex];
  const length = index.tokensPerChunk[chunkIndex].length;
  let score = 0;
  for (const term of terms) {
    const frequency = tf[term];
    if (!frequency) continue;
    const termIdf = index.idf[term] ?? Math.log(1.5);
    const numerator = frequency * (K1 + 1);
    const denominator =
      frequency + K1 * (1 - B + B * (length / index.averageLength));
    score += termIdf * (numerator / denominator);
  }
  return score * weight;
}

/**
 * Raw BM25 scores for every chunk, index-aligned with `index.chunks`.
 * Normalisation is the caller's job — fusing raw BM25 with cosine similarity
 * would let an unbounded scale dominate a bounded one.
 */
export function lexicalScores(index: LexicalIndex, query: string): number[] {
  const literal = tokenize(query);
  const expanded = expandQuery(literal);
  const unique = [...new Set(literal)];

  return index.chunks.map((_, i) => {
    const base = scoreTerms(index, i, literal, 1);
    const extra = expanded.length
      ? scoreTerms(index, i, expanded, EXPANSION_WEIGHT)
      : 0;

    // Multiplicative, not additive: a topic match should lift a chunk that
    // already matched the words, never drag in one that did not.
    const topics = index.topicTokens[i];
    const hits = unique.filter((t) => topics.has(t)).length;
    const topicBoost = hits === 0 ? 1 : 1 + Math.min(0.6, hits * 0.25);

    return (base + extra) * topicBoost;
  });
}

/** IDF assigned to a term the corpus has never seen — maximally surprising. */
function unseenIdf(index: LexicalIndex): number {
  const n = index.chunks.length;
  return Math.log(1 + (n + 0.5) / 0.5);
}

/**
 * Compresses IDF for the coverage calculation.
 *
 * Raw IDF says rare means important, which holds for content words and fails
 * badly for rare QUALIFIERS. "What is the LATEST hackathon" and "how LONG is
 * the interview" both carry an uncommon adjective worth ~3x the IDF of the
 * noun the question is actually about, so an uncovered adjective was sinking
 * questions the corpus answers thoroughly. Square-rooting keeps rare terms
 * ahead of common ones while stopping any single word from deciding the
 * verdict on its own.
 */
function coverageWeight(idf: number): number {
  return Math.sqrt(idf);
}

/**
 * How much of the question a chunk actually accounts for, weighted by IDF.
 *
 * This is the signal the confidence gate runs on, and it is deliberately NOT
 * the BM25 score. BM25 answers "which chunk is most like this query", which
 * always has a winner — even for "what's the weather", where the winner is
 * simply the least-irrelevant paragraph in the corpus. Coverage answers a
 * different and much more useful question: "did we account for what the user
 * actually asked about?"
 *
 * Terms absent from the corpus entirely ("weather", "hostel") are charged the
 * maximum IDF, so a question built around unknown words cannot score well no
 * matter how strongly its filler words match. Common words are cheap, so a
 * short question made of known terms ("What is ABTalks?") still scores high.
 */
export function termCoverage(
  index: LexicalIndex,
  query: string,
  chunkIndexes: number[],
): number {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return 0;

  const unseen = unseenIdf(index);

  let matchedWeight = 0;
  let totalWeight = 0;
  for (const term of terms) {
    const known = index.idf[term] !== undefined;
    const weight = coverageWeight(known ? index.idf[term] : unseen);
    totalWeight += weight;
    // Measured across the retrieved set, not one chunk: the model is handed
    // all of them, and the heading-based chunker routinely splits a single
    // answer across neighbours. Judging one chunk in isolation failed
    // questions the context as a whole answers completely.
    //
    // A term also counts as covered when one of its SYNONYMS is present. The
    // ranker already bridges vocabulary that way; the gate ignoring that bridge
    // meant a user who typed "retry" or "insta" was refused for using a word
    // the corpus happens to spell differently, which is precisely the gap
    // expansion exists to close.
    const forms = [term, ...expansionsFor(term)];
    if (chunkIndexes.some((i) => forms.some((f) => index.termFrequencies[i][f]))) {
      matchedWeight += weight;
    }
  }

  return totalWeight === 0 ? 0 : matchedWeight / totalWeight;
}

/**
 * Coverage measured against the whole corpus rather than one chunk: the share
 * of the question's weight that ANY document could speak to. Separates "we
 * have this subject but the best chunk is partial" from "nothing here knows
 * these words at all", which is the difference between asking a clarifying
 * question and refusing outright.
 */
export function corpusCoverage(index: LexicalIndex, query: string): number {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return 0;

  const unseen = unseenIdf(index);
  let matchedWeight = 0;
  let totalWeight = 0;
  for (const term of terms) {
    const known = index.idf[term] !== undefined;
    const weight = coverageWeight(known ? index.idf[term] : unseen);
    totalWeight += weight;
    // Known via a synonym counts: the question is expressible in this corpus
    // even if the user's exact word is not in it.
    const reachable =
      known || expansionsFor(term).some((f) => index.idf[f] !== undefined);
    if (reachable) matchedWeight += weight;
  }
  return totalWeight === 0 ? 0 : matchedWeight / totalWeight;
}
