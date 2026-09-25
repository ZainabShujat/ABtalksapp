/**
 * Rate budget for the résumé import worker (plan 154). Pure — no I/O, clock and
 * randomness injected — so the limiter is unit-tested rather than trusted.
 *
 * Two layers, because either alone is wrong:
 *
 * 1. **Our own window.** A sliding 60 s window of reservations against a
 *    configured TPM and RPM that is deliberately BELOW the model's limit
 *    (default 100k of gpt-4.1-mini's 200k TPM). The rest is left for live
 *    /register parses and the chatbot, which share the same key and model.
 *    OpenAI charges `max_tokens` against TPM up front, so a reservation is
 *    input estimate + the whole output budget, then settled to actual usage.
 *
 * 2. **What OpenAI says.** Every response carries `x-ratelimit-remaining-*`.
 *    When that falls below a fraction of the limit — because someone ELSE is
 *    using the key — new work waits for the advertised reset. Our window cannot
 *    see other traffic; the headers can.
 *
 * Only one worker runs at a time (a lease), so one in-memory budget is global.
 */

import type { RateHeaders } from "@/features/resume/providers/openai";

export type RateBudgetConfig = {
  tpm: number;
  rpm: number;
  /** Pause when remaining/limit drops below this (0..1). */
  minRemainingRatio: number;
  now?: () => number;
};

const WINDOW_MS = 60_000;

/** Input estimate for one résumé; the output side is the whole max_tokens. */
export const RESUME_INPUT_TOKEN_ESTIMATE = 4_000;

export function estimateReservation(maxOutputTokens: number): number {
  return RESUME_INPUT_TOKEN_ESTIMATE + maxOutputTokens;
}

type Reservation = { id: number; at: number; tokens: number };

export type RateBudget = {
  /**
   * Try to reserve. Returns `{ id }` when granted now, or `{ waitMs }` — the
   * earliest moment it could be granted. Callers sleep and ask again.
   */
  tryReserve(tokens: number): { id: number } | { waitMs: number };
  /** Replace a reservation's estimate with what the call actually used. */
  settle(id: number, actualTokens: number): void;
  /** Feed the headers from a response (success or 429). */
  observe(rate: RateHeaders | null): void;
  /** Block everything until at least `untilMs` (e.g. after a 429). */
  pauseUntil(untilMs: number): void;
  snapshot(): { tokensInWindow: number; requestsInWindow: number; pausedUntil: number };
};

export function createRateBudget(config: RateBudgetConfig): RateBudget {
  const now = config.now ?? Date.now;
  const tpm = Math.max(1, config.tpm);
  const rpm = Math.max(1, config.rpm);
  let reservations: Reservation[] = [];
  let nextId = 1;
  let pausedUntil = 0;

  function prune(t: number) {
    reservations = reservations.filter((r) => t - r.at < WINDOW_MS);
  }

  return {
    tryReserve(tokens) {
      const t = now();
      if (t < pausedUntil) return { waitMs: pausedUntil - t };
      prune(t);

      const used = reservations.reduce((sum, r) => sum + r.tokens, 0);
      const requestsOk = reservations.length < rpm;
      // A single request bigger than the whole budget still has to run once the
      // window is empty, or it would wait forever.
      const tokensOk = used + tokens <= tpm || reservations.length === 0;
      if (requestsOk && tokensOk) {
        const id = nextId++;
        reservations.push({ id, at: t, tokens });
        return { id };
      }

      // Earliest time enough of the window expires. Oldest first.
      const sorted = [...reservations].sort((a, b) => a.at - b.at);
      let freed = 0;
      let count = reservations.length;
      for (const r of sorted) {
        freed += r.tokens;
        count -= 1;
        if (used - freed + tokens <= tpm && count < rpm) {
          return { waitMs: Math.max(1, r.at + WINDOW_MS - t) };
        }
      }
      return { waitMs: Math.max(1, (sorted[sorted.length - 1]?.at ?? t) + WINDOW_MS - t) };
    },

    settle(id, actualTokens) {
      const r = reservations.find((x) => x.id === id);
      if (r) r.tokens = Math.max(0, actualTokens);
    },

    observe(rate) {
      if (!rate) return;
      const t = now();
      const low = (remaining: number | null, limit: number | null) =>
        remaining !== null && limit !== null && limit > 0 && remaining / limit < config.minRemainingRatio;
      if (low(rate.remainingTokens, rate.limitTokens)) {
        pausedUntil = Math.max(pausedUntil, t + (rate.resetTokensMs ?? 1_000));
      }
      if (low(rate.remainingRequests, rate.limitRequests)) {
        pausedUntil = Math.max(pausedUntil, t + (rate.resetRequestsMs ?? 1_000));
      }
    },

    pauseUntil(untilMs) {
      pausedUntil = Math.max(pausedUntil, untilMs);
    },

    snapshot() {
      prune(now());
      return {
        tokensInWindow: reservations.reduce((sum, r) => sum + r.tokens, 0),
        requestsInWindow: reservations.length,
        pausedUntil,
      };
    },
  };
}

/**
 * "Full jitter" exponential backoff: uniform in [0, min(cap, base·2^(n-1))].
 * Spreads retries out so a burst of 429s does not come back as a burst.
 */
export function fullJitterBackoff(
  attempt: number,
  opts: { baseMs?: number; capMs?: number; random?: () => number } = {},
): number {
  const base = opts.baseMs ?? 2_000;
  const cap = opts.capMs ?? 60_000;
  const random = opts.random ?? Math.random;
  const ceiling = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * ceiling);
}

/** Never sooner than the server asked for. */
export function nextRetryDelayMs(
  attempt: number,
  retryAfterMs: number | null,
  random: () => number = Math.random,
): number {
  return Math.max(retryAfterMs ?? 0, fullJitterBackoff(attempt, { random }));
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function envRatio(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 && n < 1 ? n : fallback;
}

/** Worker configuration from env, with safe defaults (plan 154 Step 1). */
export function importConfigFromEnv() {
  return {
    concurrency: envInt("RESUME_IMPORT_CONCURRENCY", 4, 1, 16),
    tpm: envInt("RESUME_IMPORT_TPM_BUDGET", 100_000, 1_000, 10_000_000),
    rpm: envInt("RESUME_IMPORT_RPM_BUDGET", 200, 1, 10_000),
    maxAttempts: envInt("RESUME_IMPORT_MAX_ATTEMPTS", 6, 1, 20),
    minRemainingRatio: envRatio("RESUME_IMPORT_MIN_REMAINING_RATIO", 0.3),
  };
}
