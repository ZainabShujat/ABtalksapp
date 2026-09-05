import {
  categoryOf,
  severityOf,
  type ProctorEvent,
  type ProctorEventKind,
  type ProctorEventMeta,
} from "@/features/interview/proctoring/types";

/**
 * The client-side proctoring event buffer.
 *
 * Plain TypeScript on purpose — no React, no browser API, no module-level
 * state. Everything that varies (the clock, the debounce window, the cap) is a
 * constructor option, which is what makes the whole thing testable from a
 * `tsx` script with no DOM.
 *
 * HOW EVENTS REACH THE SERVER. They do not have a channel of their own. The
 * session drains this buffer as it submits an answer and attaches the result to
 * the existing `submitMockAnswerAction` payload, which already writes
 * `MockInterviewTurn.clientEvents`. No new endpoint, no polling, and nothing
 * that can fail independently of the turn it belongs to: if the answer lands,
 * its events land with it.
 *
 * CONSEQUENCE, ACCEPTED. Events observed after the final answer — during
 * scoring, or on the "interview complete" screen — are never persisted, because
 * no turn follows them to carry them. That is the right trade for v0.1: the
 * alternative is a second write path that can half-fail, to record moments
 * after the interview is effectively over.
 */

/**
 * Consecutive observations of the SAME kind inside this window fold into one
 * event rather than becoming two.
 *
 * Without it, one alt-tab produces `window_blur` and `tab_hidden` twice over in
 * some browsers, and an intermittent detector produces a burst per second. The
 * report would then say "14 events" about something a person did once.
 */
export const DEBOUNCE_WINDOW_MS = 2_000;

/**
 * Hard cap on buffered events between drains.
 *
 * Matches the `max(200)` on the wire schema, so the client cannot build a
 * payload the server is bound to reject. On overflow the OLDEST event is
 * dropped: a buffer this full means something is firing continuously, and the
 * recent history is the part that still describes it.
 */
export const MAX_BUFFERED_EVENTS = 200;

export type PushOptions = {
  /** Detector confidence, 0-1. Defaults to 1 for deterministic signals. */
  confidence?: number;
  /** Short technical note, e.g. a DOMException name. */
  detail?: string;
  meta?: ProctorEventMeta;
  /** Overrides the clock. Tests only. */
  at?: number;
};

export type EventCollector = {
  /**
   * Records one observation. Returns the event when it opened a NEW entry, and
   * `null` when it was folded into the previous one — which is exactly the
   * signal the UI needs to avoid showing the same toast four times.
   */
  push: (kind: ProctorEventKind, options?: PushOptions) => ProctorEvent | null;
  /** Returns everything buffered and clears the buffer. */
  drain: () => ProctorEvent[];
  /** Returns everything buffered WITHOUT clearing it. */
  snapshot: () => ProctorEvent[];
  /** Every event pushed since creation, drained or not. Capped, dev panel only. */
  history: () => ProctorEvent[];
  size: () => number;
  destroy: () => void;
};

export type CollectorOptions = {
  debounceMs?: number;
  maxBuffered?: number;
  /** Injectable clock. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Called for each NEW event (never for a coalesced one). This is how the
   * session raises a candidate warning and how the development panel logs.
   * Throwing here must not break collection, so it is called defensively.
   */
  onEvent?: (event: ProctorEvent) => void;
};

const clamp01 = (n: number): number =>
  Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;

export function createEventCollector(
  options: CollectorOptions = {},
): EventCollector {
  const debounceMs = options.debounceMs ?? DEBOUNCE_WINDOW_MS;
  const maxBuffered = options.maxBuffered ?? MAX_BUFFERED_EVENTS;
  const now = options.now ?? (() => Date.now());

  let buffer: ProctorEvent[] = [];
  let log: ProctorEvent[] = [];
  let destroyed = false;

  /**
   * The last STILL-BUFFERED event of each kind — the fold target.
   *
   * Cleared on drain, and that is the important part. Folding works by mutating
   * an existing event in place, so folding into an event that has already been
   * sent would increment a counter nobody will ever read and lose the
   * observation. After a drain the next observation opens a fresh event
   * instead: a burst straddling an answer submission is then recorded as two
   * events whose counts still add up, rather than as one event that quietly
   * undercounts.
   */
  const lastByKind = new Map<ProctorEventKind, ProctorEvent>();

  return {
    push(kind, pushOptions = {}) {
      if (destroyed) return null;

      const at = pushOptions.at ?? now();
      const previous = lastByKind.get(kind);

      if (previous && at - previous.lastAt <= debounceMs) {
        // Fold. The event keeps its original timestamp — when the thing STARTED
        // is the useful fact — and grows its count and its trailing edge.
        previous.count += 1;
        previous.lastAt = at;
        return null;
      }

      const event: ProctorEvent = {
        kind,
        severity: severityOf(kind),
        category: categoryOf(kind),
        at,
        lastAt: at,
        count: 1,
        confidence: clamp01(pushOptions.confidence ?? 1),
        ...(pushOptions.detail ? { detail: pushOptions.detail } : {}),
        ...(pushOptions.meta ? { meta: pushOptions.meta } : {}),
      };

      buffer.push(event);
      log.push(event);
      lastByKind.set(kind, event);

      if (buffer.length > maxBuffered) {
        buffer = buffer.slice(-maxBuffered);
        // Anything evicted must stop being a fold target, or a later
        // observation would mutate an event that is no longer going anywhere.
        for (const [k, e] of lastByKind) {
          if (!buffer.includes(e)) lastByKind.delete(k);
        }
      }
      if (log.length > maxBuffered * 2) log = log.slice(-maxBuffered);

      try {
        options.onEvent?.(event);
      } catch {
        // A failing listener is a UI problem. It must not cost us the event.
      }

      return event;
    },

    drain() {
      const drained = buffer;
      buffer = [];
      lastByKind.clear();
      return drained;
    },

    snapshot() {
      return buffer.slice();
    },

    history() {
      return log.slice();
    },

    size() {
      return buffer.length;
    },

    destroy() {
      destroyed = true;
      buffer = [];
      log = [];
      lastByKind.clear();
    },
  };
}
