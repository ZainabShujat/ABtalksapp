/**
 * One place that records how long each leg of an interview turn took, what it
 * cost, and which provider served it.
 *
 * WHY THIS EXISTS. Before this module the only latency evidence in the codebase
 * was `[mock-interview] turn latency` — three numbers (llmMs, persistMs,
 * serverMs) covering the SERVER's share of a gap the candidate experiences as
 * one silence. It could not answer the only question that matters: after
 * someone stops talking, how long until they hear a voice, and which leg ate it.
 * Optimising against that number without measuring the parts is guesswork, and
 * the parts live in three processes (browser, route handler, Server Action).
 *
 * The design is deliberately boring: an in-memory map keyed by attempt, spans
 * pushed as they close, and one `logger.info` per span so the record survives
 * even on a serverless instance that is recycled before the interview ends.
 * No database, no new table, no cross-request state that anything depends on.
 * If the map is empty because a different lambda served the turn, the logs are
 * still complete — the map is a convenience for the local measurement harness,
 * not the source of truth.
 *
 * Pure with respect to the interview: nothing here can change what is asked,
 * what is scored, or what is said. It only observes.
 */

import { logger } from "@/lib/logger";

/**
 * The legs of one turn, named after the brief's T0-T6 so a report can be read
 * against the request that asked for it.
 *
 * `client_gap` is the only one the browser reports, and it is the one that
 * actually matters: T0 (candidate stopped) to T6 (first audio out of the
 * speaker). Every other span is a component of it, and they will not sum to it
 * exactly — network and browser scheduling live in the difference, which is
 * itself worth seeing rather than hiding.
 */
export type SpanName =
  /** T0 -> T1. Upload + transcription. */
  | "stt"
  /** T2 -> T3. The assessment call. */
  | "evaluator"
  /** Inside T3. Adaptive target selection. */
  | "planner"
  /** T4. The conversational phrasing call, when it runs. */
  | "phrasing"
  /** Classifying a barge-in utterance. */
  | "interrupt_classify"
  /** T5. Server-side: resolve the line, then upstream synthesis. */
  | "tts_resolve"
  /** T5 -> T6 server side: request sent to first synthesized byte. */
  | "tts_ttfb"
  /** Whole synthesis, first byte to last. */
  | "tts_total"
  /** Database read/write legs, so a slow turn can be blamed correctly. */
  | "db_load"
  | "db_save"
  /** The whole server turn, for reconciliation against its parts. */
  | "turn_server"
  /** Reported by the browser: candidate stopped speaking -> first audio. */
  | "client_gap";

export type Span = {
  attemptId: string;
  name: SpanName;
  ms: number;
  /** Which vendor/model served this leg, when one did. */
  provider?: string;
  model?: string;
  /** Upstream retries spent on this leg. */
  retries?: number;
  /** True when the leg fell back to a degraded path (heuristics, browser TTS). */
  degraded?: boolean;
  /** Why it degraded. Never swallowed — 429, timeout, truncation, bad JSON. */
  failureReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  /** Seconds of audio, for speech legs billed per minute. */
  audioSeconds?: number;
  /** Characters synthesized, for speech legs billed per character. */
  characters?: number;
  /** USD, computed at record time from the table below. */
  costUsd?: number;
  /** For an interruption span: how it was classified. */
  interruptionKind?: string;
  at: number;
};

/* --------------------------------------------------------------- pricing */

/**
 * USD per 1M tokens, per minute of audio, or per 1k characters.
 *
 * Stated as data rather than buried in arithmetic so a price change is a
 * one-line edit and so a cost report can name exactly what it charged. These
 * are published list prices; they are the softest numbers in any report this
 * module produces and are printed alongside the result for that reason.
 */
export const PRICING = {
  llm: {
    "gpt-4o": { inPerM: 2.5, cachedInPerM: 1.25, outPerM: 10 },
    "gpt-4o-mini": { inPerM: 0.15, cachedInPerM: 0.075, outPerM: 0.6 },
    "gpt-4.1": { inPerM: 2.0, cachedInPerM: 0.5, outPerM: 8 },
    "gpt-4.1-mini": { inPerM: 0.4, cachedInPerM: 0.1, outPerM: 1.6 },
  } as Record<string, { inPerM: number; cachedInPerM: number; outPerM: number }>,
  /** Per minute of audio transcribed. */
  stt: {
    "whisper-1": 0.006,
    "whisper-large-v3": 0.00185,
    "nova-3": 0.0043,
  } as Record<string, number>,
  /** TTS: per 1k characters for Deepgram, per minute of output for OpenAI. */
  ttsPerKChar: {
    "aura-2": 0.03,
  } as Record<string, number>,
  ttsPerMinute: {
    "gpt-4o-mini-tts": 0.015,
  } as Record<string, number>,
} as const;

export function llmCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
  cachedPromptTokens = 0,
): number {
  const p = PRICING.llm[model];
  if (!p) return 0;
  const fresh = Math.max(0, promptTokens - cachedPromptTokens);
  return (
    (fresh / 1_000_000) * p.inPerM +
    (cachedPromptTokens / 1_000_000) * p.cachedInPerM +
    (completionTokens / 1_000_000) * p.outPerM
  );
}

export function sttCostUsd(model: string, audioSeconds: number): number {
  const perMinute = PRICING.stt[model];
  if (!perMinute) return 0;
  return (audioSeconds / 60) * perMinute;
}

export function ttsCostUsd(model: string, characters: number): number {
  // Deepgram bills per character, which is exact. OpenAI bills per minute of
  // OUTPUT audio, which we do not know without decoding the mp3 — so estimate
  // from characters at a conversational 14 chars/second. Stated here rather
  // than hidden: the OpenAI TTS figure in any report is an estimate.
  for (const [key, perK] of Object.entries(PRICING.ttsPerKChar)) {
    if (model.includes(key)) return (characters / 1000) * perK;
  }
  for (const [key, perMin] of Object.entries(PRICING.ttsPerMinute)) {
    if (model.includes(key)) return (characters / 14 / 60) * perMin;
  }
  return 0;
}

/* ----------------------------------------------------------------- store */

/**
 * Bounded on purpose. A long-lived dev server would otherwise accumulate every
 * span of every interview it has ever served; the measurement harness only ever
 * reads back the attempt it just ran.
 */
const MAX_ATTEMPTS = 50;
const spans = new Map<string, Span[]>();

export function recordSpan(span: Omit<Span, "at">): void {
  const full: Span = { ...span, at: Date.now() };

  const existing = spans.get(span.attemptId);
  if (existing) {
    existing.push(full);
  } else {
    if (spans.size >= MAX_ATTEMPTS) {
      const oldest = spans.keys().next().value;
      if (oldest) spans.delete(oldest);
    }
    spans.set(span.attemptId, [full]);
  }

  // Logged as well as stored, so the record survives a recycled instance and so
  // a production interview is diagnosable without any of this being read back.
  logger.info("[interview/span]", {
    attemptId: span.attemptId,
    span: span.name,
    ms: span.ms,
    ...(span.provider ? { provider: span.provider } : {}),
    ...(span.model ? { model: span.model } : {}),
    ...(span.retries ? { retries: span.retries } : {}),
    ...(span.degraded ? { degraded: true } : {}),
    // NEVER collapsed into a generic message. The brief is explicit: a 429, a
    // timeout, a truncation and invalid JSON need different fixes and must not
    // arrive as the same line.
    ...(span.failureReason ? { failureReason: span.failureReason } : {}),
    ...(span.promptTokens ? { promptTokens: span.promptTokens } : {}),
    ...(span.completionTokens ? { completionTokens: span.completionTokens } : {}),
    ...(span.audioSeconds ? { audioSeconds: Number(span.audioSeconds.toFixed(2)) } : {}),
    ...(span.characters ? { characters: span.characters } : {}),
    ...(span.costUsd ? { costUsd: Number(span.costUsd.toFixed(6)) } : {}),
    ...(span.interruptionKind ? { interruptionKind: span.interruptionKind } : {}),
  });
}

/** Times a promise and records the span, whatever the promise does. */
export async function timed<T>(
  attemptId: string,
  name: SpanName,
  fn: () => Promise<T>,
  meta: Partial<Omit<Span, "attemptId" | "name" | "ms" | "at">> = {},
): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    recordSpan({ attemptId, name, ms: Date.now() - started, ...meta });
  }
}

export function readSpans(attemptId: string): Span[] {
  return spans.get(attemptId) ?? [];
}

export function clearSpans(attemptId?: string): void {
  if (attemptId) spans.delete(attemptId);
  else spans.clear();
}

/* --------------------------------------------------------------- reports */

export type Percentiles = { n: number; p50: number; p90: number; max: number };

/**
 * Nearest-rank percentile.
 *
 * Deliberately not interpolated: with the handful of samples one interview
 * produces, an interpolated p90 invents a number that no turn actually took.
 * The rank method always reports a real observation.
 */
export function percentiles(values: number[]): Percentiles {
  if (values.length === 0) return { n: 0, p50: 0, p90: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
  return { n: sorted.length, p50: at(0.5), p90: at(0.9), max: sorted[sorted.length - 1]! };
}

export type TurnReport = {
  attemptId: string;
  bySpan: Partial<Record<SpanName, Percentiles>>;
  totalCostUsd: number;
  llmCalls: number;
  degradedSpans: number;
  failures: { span: SpanName; reason: string }[];
};

export function summarize(attemptId: string): TurnReport {
  const all = readSpans(attemptId);
  const byName = new Map<SpanName, number[]>();
  for (const s of all) {
    const list = byName.get(s.name) ?? [];
    list.push(s.ms);
    byName.set(s.name, list);
  }

  const bySpan: Partial<Record<SpanName, Percentiles>> = {};
  for (const [name, values] of byName) bySpan[name] = percentiles(values);

  return {
    attemptId,
    bySpan,
    totalCostUsd: all.reduce((sum, s) => sum + (s.costUsd ?? 0), 0),
    llmCalls: all.filter(
      (s) =>
        s.name === "evaluator" ||
        s.name === "phrasing" ||
        s.name === "interrupt_classify",
    ).length,
    degradedSpans: all.filter((s) => s.degraded).length,
    failures: all
      .filter((s) => s.failureReason)
      .map((s) => ({ span: s.name, reason: s.failureReason! })),
  };
}
