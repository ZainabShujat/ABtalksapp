import {
  labelOf,
  PROCTOR_CATEGORIES,
  PROCTOR_SEVERITIES,
  type ProctorEvent,
  type ProctorEventCategory,
  type ProctorEventKind,
  type ProctorKindTally,
  type ProctorSeverity,
  type ProctorSummary,
  type ProctorTimelineEntry,
} from "@/features/interview/proctoring/types";

/**
 * Rolls an attempt's events up into what the report renders.
 *
 * Pure function, no I/O, no `server-only` — it runs in the report's Server
 * Component today and would run unchanged in a test or a client preview.
 *
 * It counts and it orders. It does not judge: there is no score here, no
 * threshold, and no derived claim about the candidate. Adding one would mean
 * asserting that N tab switches mean something, which is exactly the assertion
 * v0.1 has no evidence for.
 */

/** Longest timeline the report will render. Older entries are dropped. */
const MAX_TIMELINE_ENTRIES = 60;

/** A day of camera uptime is nonsense; anything above it is bad metadata. */
const MAX_CAMERA_SECONDS = 86_400;

const CAMERA_FAILURE_KINDS: readonly ProctorEventKind[] = [
  "camera_denied",
  "camera_error",
  "camera_lost",
];

function zeroBySeverity(): Record<ProctorSeverity, number> {
  return { info: 0, warning: 0, critical: 0 };
}

function zeroByCategory(): Record<ProctorEventCategory, number> {
  return { focus: 0, camera: 0, vision: 0, audio: 0 };
}

/** An empty summary. What a clean attempt gets, and what "no data" gets. */
export function emptyProctorSummary(): ProctorSummary {
  return {
    totalEvents: 0,
    bySeverity: zeroBySeverity(),
    byCategory: zeroByCategory(),
    byKind: [],
    timeline: [],
    cameraActiveSeconds: 0,
    cameraErrors: 0,
    cameraEverActive: false,
  };
}

function cameraSecondsFrom(event: ProctorEvent): number {
  const raw = event.meta?.activeSeconds;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(Math.round(raw), MAX_CAMERA_SECONDS);
}

/**
 * Builds the summary.
 *
 * `totalEvents` counts OBSERVATIONS, not rows: an event that coalesced four
 * alt-tabs contributes four. The alternative would let the debounce window
 * quietly change what the report says happened.
 */
export function summariseProctorEvents(
  events: readonly ProctorEvent[],
): ProctorSummary {
  if (events.length === 0) return emptyProctorSummary();

  const ordered = [...events].sort((a, b) => a.at - b.at);

  const bySeverity = zeroBySeverity();
  const byCategory = zeroByCategory();
  const tallies = new Map<ProctorEventKind, ProctorKindTally>();
  const timeline: ProctorTimelineEntry[] = [];

  let totalEvents = 0;
  let cameraActiveSeconds = 0;
  let cameraErrors = 0;
  let cameraEverActive = false;

  for (const event of ordered) {
    const count = Number.isFinite(event.count) ? Math.max(1, event.count) : 1;
    totalEvents += count;
    bySeverity[event.severity] += count;
    byCategory[event.category] += count;

    if (event.kind === "camera_active") {
      cameraEverActive = true;
      cameraActiveSeconds = Math.max(
        cameraActiveSeconds,
        cameraSecondsFrom(event),
      );
    }
    if (CAMERA_FAILURE_KINDS.includes(event.kind)) cameraErrors += count;

    const existing = tallies.get(event.kind);
    if (existing) {
      existing.count += count;
      existing.firstAt = Math.min(existing.firstAt, event.at);
      existing.lastAt = Math.max(existing.lastAt, event.lastAt || event.at);
    } else {
      tallies.set(event.kind, {
        kind: event.kind,
        label: labelOf(event.kind),
        severity: event.severity,
        category: event.category,
        count,
        firstAt: event.at,
        lastAt: event.lastAt || event.at,
      });
    }

    // The timeline is the notable moments only. Returning to the tab and a
    // camera heartbeat are worth counting and not worth a line each.
    if (event.severity !== "info") {
      timeline.push({
        kind: event.kind,
        label: labelOf(event.kind),
        severity: event.severity,
        at: event.at,
        count,
        ...(event.detail ? { detail: event.detail } : {}),
      });
    }
  }

  const byKind = [...tallies.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );

  return {
    totalEvents,
    bySeverity,
    byCategory,
    byKind,
    timeline: timeline.slice(-MAX_TIMELINE_ENTRIES),
    cameraActiveSeconds,
    cameraErrors,
    cameraEverActive,
  };
}

/** True when there is nothing at all to show — used to skip the report card. */
export function isEmptyProctorSummary(summary: ProctorSummary): boolean {
  return summary.totalEvents === 0;
}

const SEVERITY_ORDER: readonly ProctorSeverity[] = PROCTOR_SEVERITIES;
const CATEGORY_ORDER: readonly ProctorEventCategory[] = PROCTOR_CATEGORIES;

/** Stable display order for the report's count rows. */
export function severityOrder(): readonly ProctorSeverity[] {
  return SEVERITY_ORDER;
}

export function categoryOrder(): readonly ProctorEventCategory[] {
  return CATEGORY_ORDER;
}
