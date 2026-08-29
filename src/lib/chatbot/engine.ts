/**
 * The retrieval algorithm and the confidence gate — pure, no I/O.
 *
 * Everything that decides WHAT gets retrieved and WHETHER the question is
 * answerable lives here. The server wrapper (`retrieve.ts`) is responsible only
 * for fetching two things this module cannot fetch for itself: the corpus off
 * disk, and the query's embedding from OpenAI. It then hands both in.
 *
 * That split is what makes the behaviour testable. The regression suite runs
 * this exact function against the real corpus and the real embedding artifact,
 * so a test result describes production and not a parallel implementation of it.
 */
import { ORIGIN_WEIGHT, type Chunk } from "@/lib/chatbot/chunking";
import {
  corpusCoverage,
  lexicalScores,
  termCoverage,
  type LexicalIndex,
} from "@/lib/chatbot/lexical";
import { tokenize } from "@/lib/chatbot/text";

const MAX_CONTEXT_CHUNKS = 8;
/** Below this a chunk is noise and never enters the context window. */
const FLOOR = 0.08;
/** At or above this the corpus is judged able to answer. */
export const CONFIDENCE_THRESHOLD = 0.34;
/**
 * A score in this band is a weak-but-real signal: the corpus has something
 * adjacent, but not enough to answer confidently. The right move is to ask
 * what the user means, not to guess and not to hard-refuse.
 */
export const CLARIFY_THRESHOLD = 0.24;

/** Relative weights when both retrieval signals are available. */
const HYBRID_LEXICAL_WEIGHT = 0.45;
const HYBRID_SEMANTIC_WEIGHT = 0.55;

/**
 * A corpus edited since the last embed run leaves chunks with no vector.
 * Ranking on a half-populated semantic field silently scores those chunks 0,
 * which is worse than not using the field at all — so below this coverage the
 * semantic side is dropped entirely.
 */
const MIN_VECTOR_COVERAGE = 0.6;

export type RetrievalVerdict = "answer" | "clarify" | "fallback";

export type ScoredChunk = {
  chunk: Chunk;
  score: number;
  lexical: number;
  semantic: number;
};

export type RetrievalResult = {
  verdict: RetrievalVerdict;
  /** The gate's score. Not a probability — see `confidenceFor`. */
  topScore: number;
  results: ScoredChunk[];
  /** True when the ranking used BM25 alone. */
  lexicalOnly: boolean;
  /** Distinct non-site source files among the results, for clarify prompts. */
  topics: string[];
  coverage: { retrieved: number; vocabulary: number };
  /**
   * Highest raw cosine similarity in the corpus, before normalisation.
   * Null in lexical-only mode. Bounded and absolute, unlike the ranking score.
   */
  topSimilarity: number | null;
};

/**
 * Scales a raw score array into 0..1 against its own maximum.
 *
 * BM25 is unbounded and cosine similarity is not, so fusing them raw would let
 * the lexical side dominate purely through scale. The consequence — worth
 * being explicit about — is that these are RELATIVE scores: the best chunk for
 * any query normalises to 1.0, which is exactly why the gate below cannot read
 * the ranking score.
 */
function normaliseScores(scores: number[]): number[] {
  let max = 0;
  for (const score of scores) if (score > max) max = score;
  if (max <= 0) return scores.map(() => 0);
  return scores.map((score) => score / max);
}

/**
 * THE GATE.
 *
 * Ranking always produces a winner, so it cannot decide answerability — it only
 * decides which chunk is least bad. "What is the weather" has a best chunk too;
 * it is simply the least irrelevant paragraph in the corpus. So the gate scores
 * COVERAGE instead: how much of what the user asked about the retrieved context
 * actually accounts for, multiplied by how much of their vocabulary the corpus
 * knows at all.
 */
/**
 * Vocabulary at or above this is treated as "the corpus speaks this language"
 * and applies no penalty. Below it the score is scaled down proportionally,
 * reaching zero when the corpus knows none of the question's words.
 */
const VOCABULARY_FULL_CREDIT = 0.5;

/**
 * Absolute cosine bounds for the semantic half of the gate.
 *
 * Ranking normalises similarity per query, which throws away the one bounded,
 * absolute signal in the whole pipeline: for `text-embedding-3-small` on this
 * corpus, a genuinely on-topic chunk lands around 0.40-0.70 and an unrelated
 * one around 0.13-0.27. Measured across the audit suite, not guessed.
 *
 * It is a second OPINION, not a veto — "can i retry it" (0.28) sits below
 * "is there any stipend" (0.32), so similarity alone would refuse a real
 * question and admit an imaginary one. Lexical coverage separates those two
 * cleanly. Each signal covers the other's blind spot, which is the entire
 * reason both are consulted.
 */
const SIMILARITY_FLOOR = 0.2;
const SIMILARITY_CEILING = 0.45;
/**
 * How much of the confidence a question can keep on lexical coverage alone.
 * A question whose words the corpus knows, but which nothing in the corpus is
 * actually ABOUT, keeps this fraction and no more.
 */
const SEMANTIC_FLOOR_SHARE = 0.25;

/** Raw cosine mapped into 0..1 across the measured relevant/irrelevant band. */
function similarityFactor(topSimilarity: number): number {
  const scaled =
    (topSimilarity - SIMILARITY_FLOOR) / (SIMILARITY_CEILING - SIMILARITY_FLOOR);
  return Math.max(0, Math.min(1, scaled));
}

/** True when stop-word removal leaves the query with nothing to score. */
function hasNoContentTerms(query: string): boolean {
  return tokenize(query).length === 0;
}

export function confidenceFor(
  index: LexicalIndex,
  query: string,
  retrievedIndexes: number[],
  topSimilarity: number | null,
): { confidence: number; retrieved: number; vocabulary: number } {
  const retrieved = termCoverage(index, query, retrievedIndexes);
  const vocabulary = corpusCoverage(index, query);

  // Some real questions are built entirely from function words — "what do you
  // guys actually do" has no content token left after stop-word removal. The
  // lexical side has no opinion there, and scoring that as zero coverage
  // refused a perfectly ordinary question about what ABTalks is. When there is
  // nothing to measure lexically, the semantic signal decides alone.
  if (hasNoContentTerms(query)) {
    const semanticOnly = topSimilarity === null ? 0 : similarityFactor(topSimilarity);
    return { confidence: semanticOnly, retrieved, vocabulary };
  }

  // The two metrics answer different questions — "did the context cover the
  // question" and "could this corpus speak to it at all" — but they collapse to
  // the same number whenever retrieval succeeds, because a chunk can only cover
  // a term the corpus contains. Multiplying them therefore squared a single
  // unknown word: one uncommon verb ("how are winners DECIDED") took a
  // thoroughly answerable question from 0.43 to 0.18 and refused it.
  //
  // So each is used for its own job. Retrieved coverage is the score;
  // vocabulary is a veto that only bites when the corpus genuinely does not
  // know what is being asked about.
  const vocabularyFactor = Math.min(1, vocabulary / VOCABULARY_FULL_CREDIT);

  // Semantic agreement. Absent (lexical-only) means no opinion, so no penalty —
  // otherwise disabling embeddings would silently start refusing real questions.
  const semanticFactor =
    topSimilarity === null
      ? 1
      : SEMANTIC_FLOOR_SHARE +
        (1 - SEMANTIC_FLOOR_SHARE) * similarityFactor(topSimilarity);

  return {
    confidence: retrieved * vocabularyFactor * semanticFactor,
    retrieved,
    vocabulary,
  };
}

export type SemanticInput = {
  /** Chunk id -> unit-normalised vector, from the embedding artifact. */
  similarityFor: (chunk: Chunk) => number | null;
};

/**
 * Ranks the corpus and gates the result.
 *
 * `semantic` is optional: when it is absent (no OpenAI key, no artifact, or an
 * artifact that no longer covers the corpus) retrieval degrades to lexical-only
 * rather than failing. That degradation is reported in `lexicalOnly` so callers
 * — and the test suite — can tell which path actually ran instead of guessing.
 */
export function rankAndGate(
  index: LexicalIndex,
  query: string,
  semantic: SemanticInput | null,
): RetrievalResult {
  const chunks = index.chunks;
  if (chunks.length === 0) {
    return {
      verdict: "fallback",
      topScore: 0,
      results: [],
      lexicalOnly: true,
      topics: [],
      coverage: { retrieved: 0, vocabulary: 0 },
      topSimilarity: null,
    };
  }

  const normalisedLexical = normaliseScores(lexicalScores(index, query));

  let normalisedSemantic: number[] = chunks.map(() => 0);
  let lexicalOnly = true;
  let topSimilarity: number | null = null;

  if (semantic) {
    const raw = chunks.map((chunk) => semantic.similarityFor(chunk) ?? 0);
    const covered = raw.filter((value) => value !== 0).length;
    if (covered >= chunks.length * MIN_VECTOR_COVERAGE) {
      topSimilarity = Math.max(...raw);
      normalisedSemantic = normaliseScores(raw.map((v) => Math.max(0, v)));
      lexicalOnly = false;
    }
  }

  const lexicalWeight = lexicalOnly ? 1 : HYBRID_LEXICAL_WEIGHT;
  const semanticWeight = lexicalOnly ? 0 : HYBRID_SEMANTIC_WEIGHT;

  const scored: ScoredChunk[] = chunks.map((chunk, i) => {
    const fused =
      normalisedLexical[i] * lexicalWeight + normalisedSemantic[i] * semanticWeight;
    return {
      chunk,
      score: fused * ORIGIN_WEIGHT[chunk.origin],
      lexical: normalisedLexical[i],
      semantic: normalisedSemantic[i],
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const results = scored
    .filter((r) => r.score > FLOOR)
    .slice(0, MAX_CONTEXT_CHUNKS);

  const positionOf = new Map(chunks.map((chunk, i) => [chunk.id, i]));
  const retrievedIndexes = results
    .map((r) => positionOf.get(r.chunk.id))
    .filter((i): i is number => i !== undefined);

  const { confidence, retrieved, vocabulary } = confidenceFor(
    index,
    query,
    retrievedIndexes,
    topSimilarity,
  );

  const verdict: RetrievalVerdict =
    confidence >= CONFIDENCE_THRESHOLD
      ? "answer"
      : confidence >= CLARIFY_THRESHOLD
        ? "clarify"
        : "fallback";

  const topics = [
    ...new Set(
      results
        .filter((r) => r.chunk.origin !== "site")
        .map((r) => r.chunk.source.replace(/\.md$/, "")),
    ),
  ].slice(0, 3);

  return {
    verdict,
    topScore: confidence,
    // A refused question hands back no context: the caller must not be able to
    // send chunks to a model on the strength of a result the gate rejected.
    results: verdict === "fallback" ? [] : results,
    lexicalOnly,
    topics,
    coverage: { retrieved, vocabulary },
    topSimilarity,
  };
}
