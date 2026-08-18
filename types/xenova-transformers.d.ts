/**
 * `@xenova/transformers` ships no type declarations, so `scripts/generate-kb-embeddings.ts`
 * failed the build's typecheck (TS7016) — and Vercel runs that typecheck via
 * `build:deploy`, so the deploy failed with it.
 *
 * Declared narrowly rather than as a blanket `any` module, to keep strict mode
 * meaningful: this covers exactly the feature-extraction pipeline the script uses.
 * Widen it if another script starts using more of the library.
 */
declare module "@xenova/transformers" {
  export interface FeatureExtractionOutput {
    /** Float32Array of embedding values. */
    data: Float32Array;
  }

  export interface FeatureExtractionOptions {
    pooling?: "none" | "mean" | "cls";
    normalize?: boolean;
  }

  export type FeatureExtractor = (
    text: string,
    options?: FeatureExtractionOptions,
  ) => Promise<FeatureExtractionOutput>;

  export function pipeline(
    task: "feature-extraction",
    model?: string,
    options?: Record<string, unknown>,
  ): Promise<FeatureExtractor>;
}
