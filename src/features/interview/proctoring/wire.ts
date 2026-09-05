import { z } from "zod";
import {
  categoryOf,
  isProctorEventKind,
  PROCTOR_EVENT_KINDS,
  severityOf,
  type ProctorEvent,
  type ProctorEventMeta,
} from "@/features/interview/proctoring/types";

/**
 * The proctoring wire boundary: what a browser is allowed to say, and what the
 * server makes of it.
 *
 * THE POSTURE. These events are ADVISORY TELEMETRY. They arrive on the answer
 * submission payload, which means they arrive from a browser, which means a
 * determined candidate can send whatever they like — omit their own tab
 * switches, or invent a hundred. Nothing downstream may treat them as proof:
 * they are not used to gate scoring, to alter an interview, or to make any
 * decision about a person. They are a record of what the client reported.
 *
 * Given that, the schema's job is narrow and worth stating: keep the column
 * well-formed and bounded. It does that three ways.
 *
 *   1. A client sends a KIND, never a severity or a category. Both are
 *      recomputed here from the kind alone, so "critical" cannot be asserted
 *      into the report by a payload.
 *   2. Free text is not accepted. `detail` is sanitised to a short technical
 *      token; there is no field a client can write a sentence into.
 *   3. Everything is bounded — event count, meta size, string length, and
 *      timestamps, which are rejected in favour of the server clock when they
 *      are not plausible.
 */

/** Wire cap per submission. Mirrored by `MAX_BUFFERED_EVENTS` on the client. */
export const MAX_EVENTS_PER_SUBMISSION = 200;

/** Anything before this is a broken clock, not a timestamp. */
const EARLIEST_PLAUSIBLE_MS = Date.UTC(2020, 0, 1);

/** Tolerance for a client clock running ahead of ours. */
const FUTURE_TOLERANCE_MS = 60 * 60 * 1000;

/**
 * What the browser may send for one observation.
 *
 * Note what is absent: `severity`, `category` and any free-text message.
 */
export const proctorEventWireSchema = z.object({
  kind: z.enum(PROCTOR_EVENT_KINDS),
  /** Epoch ms from the client clock. Validated against ours on normalisation. */
  at: z.number().int().min(0).max(4_102_444_800_000),
  lastAt: z.number().int().min(0).max(4_102_444_800_000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  count: z.number().int().min(1).max(10_000).optional(),
  detail: z.string().max(200).optional(),
  meta: z
    .record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()]))
    .optional(),
});

export type ProctorEventWire = z.infer<typeof proctorEventWireSchema>;

export const proctorEventsWireSchema = z
  .array(proctorEventWireSchema)
  .max(MAX_EVENTS_PER_SUBMISSION);

/** Meta keys we will store. An unrecognised key is dropped, not kept "just in case". */
const ALLOWED_META_KEYS = new Set(["activeSeconds"]);

/**
 * Reduces `detail` to a technical token.
 *
 * The field exists to carry things like `NotAllowedError` and `TrackEnded`.
 * Restricting the charset means it cannot become a channel for arbitrary text
 * that later gets rendered somewhere as though we wrote it.
 */
function sanitiseDetail(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  const cleaned = detail.replace(/[^A-Za-z0-9 ._-]/g, "").trim().slice(0, 60);
  return cleaned.length > 0 ? cleaned : undefined;
}

function sanitiseMeta(
  meta: ProctorEventWire["meta"],
): ProctorEventMeta | undefined {
  if (!meta) return undefined;
  const out: ProctorEventMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!ALLOWED_META_KEYS.has(key)) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    out[key] = typeof value === "string" ? sanitiseDetail(value) ?? "" : value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Turns validated wire events into storable ones.
 *
 * Severity and category come from the kind. Implausible client timestamps are
 * replaced with the server's receive time rather than dropped: knowing THAT
 * something happened is worth more than knowing exactly when, and a report that
 * silently discards events from a machine with a wrong clock is worse than one
 * that clusters them at the moment they arrived.
 */
export function normaliseProctorEvents(
  wire: readonly ProctorEventWire[],
  receivedAtMs: number = Date.now(),
): ProctorEvent[] {
  const latestPlausible = receivedAtMs + FUTURE_TOLERANCE_MS;

  return wire.slice(0, MAX_EVENTS_PER_SUBMISSION).map((event) => {
    const plausible = (ms: number): boolean =>
      ms >= EARLIEST_PLAUSIBLE_MS && ms <= latestPlausible;

    const at = plausible(event.at) ? event.at : receivedAtMs;
    const lastAt =
      event.lastAt !== undefined && plausible(event.lastAt) && event.lastAt >= at
        ? event.lastAt
        : at;

    const detail = sanitiseDetail(event.detail);
    const meta = sanitiseMeta(event.meta);

    return {
      kind: event.kind,
      severity: severityOf(event.kind),
      category: categoryOf(event.kind),
      at,
      lastAt,
      count: event.count ?? 1,
      confidence: event.confidence ?? 1,
      ...(detail ? { detail } : {}),
      ...(meta ? { meta } : {}),
    };
  });
}

/**
 * Reads events back out of the `clientEvents` column.
 *
 * The column outlives any single deploy and holds whatever shape was current
 * when the turn was written, so this is deliberately forgiving: a row it cannot
 * make sense of contributes nothing rather than breaking the report. Severity
 * and category are recomputed here too — a stored value is not trusted any more
 * than a submitted one.
 */
export function parseStoredProctorEvents(stored: unknown): ProctorEvent[] {
  if (!Array.isArray(stored)) return [];

  const events: ProctorEvent[] = [];
  for (const raw of stored) {
    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as Record<string, unknown>;
    if (!isProctorEventKind(record.kind)) continue;

    const at = typeof record.at === "number" ? record.at : 0;
    const lastAtValue = record.lastAt;
    const count = typeof record.count === "number" ? record.count : 1;
    const confidence =
      typeof record.confidence === "number" ? record.confidence : 1;
    const meta =
      typeof record.meta === "object" && record.meta !== null
        ? sanitiseMeta(record.meta as ProctorEventWire["meta"])
        : undefined;

    events.push({
      kind: record.kind,
      severity: severityOf(record.kind),
      category: categoryOf(record.kind),
      at,
      lastAt:
        typeof lastAtValue === "number" && lastAtValue >= at ? lastAtValue : at,
      count: Number.isFinite(count) ? Math.max(1, Math.round(count)) : 1,
      confidence: Number.isFinite(confidence)
        ? Math.min(1, Math.max(0, confidence))
        : 1,
      ...(typeof record.detail === "string" && record.detail
        ? { detail: record.detail.slice(0, 60) }
        : {}),
      ...(meta ? { meta } : {}),
    });
  }
  return events;
}
