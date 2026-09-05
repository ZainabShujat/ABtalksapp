/**
 * The proctoring event vocabulary (Proctoring v0.1).
 *
 * Pure module: no React, no Prisma, no `server-only`, no browser API. Imported
 * by the client collector, by the Zod boundary, by the summary function and by
 * the report card, so it must stay loadable everywhere.
 *
 * WHAT THESE EVENTS ARE. Observations. A `tab_hidden` event says the browser
 * fired `visibilitychange` — nothing more. It does not say the candidate did
 * anything wrong, and nothing in this module or downstream of it decides that
 * they did. There is deliberately no integrity score, no pass/fail threshold and
 * no vocabulary of misconduct anywhere in the proctoring feature: we do not yet
 * have detection evidence that would justify one, and a number invented before
 * the evidence exists is a number nobody can defend.
 *
 * WHAT IS DERIVED, NOT SENT. `severity` and `category` are functions of `kind`
 * (the two maps below) and are recomputed on the server from the kind alone.
 * The client's opinion of how serious its own event is never reaches storage.
 */

/* -------------------------------------------------------------- vocabulary */

/**
 * Every observation the system can record.
 *
 * The first nine are deterministic browser signals and are REAL as of v0.1. The
 * last four come from detectors that do not exist yet — the stubs in
 * `detection-stubs.ts` never emit them outside the development simulator. They
 * are named now so that a real detector is a new implementation of an existing
 * interface rather than a change to the event model, the wire schema, the
 * column and the report in one commit.
 */
export const PROCTOR_EVENT_KINDS = [
  // Focus — real.
  "tab_hidden",
  "tab_visible",
  "window_blur",
  "window_focus",
  "fullscreen_exit",
  // Camera lifecycle — real.
  "camera_active",
  "camera_denied",
  "camera_error",
  "camera_lost",
  // Vision / audio — STUBS ONLY in v0.1. See `detection-stubs.ts`.
  "face_not_detected",
  "multiple_faces",
  "low_lighting",
  "multiple_speakers",
] as const;

export type ProctorEventKind = (typeof PROCTOR_EVENT_KINDS)[number];

export const PROCTOR_SEVERITIES = ["info", "warning", "critical"] as const;
export type ProctorSeverity = (typeof PROCTOR_SEVERITIES)[number];

export const PROCTOR_CATEGORIES = [
  "focus",
  "camera",
  "vision",
  "audio",
] as const;
export type ProctorEventCategory = (typeof PROCTOR_CATEGORIES)[number];

/**
 * Extra numeric/flag detail for one event.
 *
 * Advisory only, and never read by anything that gates behaviour. The one field
 * the summary actually consults is `activeSeconds` on a `camera_active`
 * heartbeat, and it is clamped there rather than trusted.
 */
export type ProctorEventMeta = Record<string, string | number | boolean>;

/** One recorded observation. */
export type ProctorEvent = {
  kind: ProctorEventKind;
  /** Derived from `kind`. Never accepted from a client payload. */
  severity: ProctorSeverity;
  /** Derived from `kind`. Never accepted from a client payload. */
  category: ProctorEventCategory;
  /** Epoch milliseconds when the observation was first made. */
  at: number;
  /**
   * How sure the detector is, 0-1. Deterministic browser signals are 1: the
   * event fired or it did not. Future detectors report their own confidence,
   * which is why the field exists before any detector needs it.
   */
  confidence: number;
  /**
   * How many identical consecutive observations were coalesced into this one.
   * Always at least 1. See the debounce window in `collector.ts`.
   */
  count: number;
  /** Epoch ms of the LAST observation folded into this event. */
  lastAt: number;
  /** Short technical note (e.g. a DOMException name). Sanitised server-side. */
  detail?: string;
  meta?: ProctorEventMeta;
};

/* ------------------------------------------------------------------- maps */

const SEVERITY_BY_KIND: Record<ProctorEventKind, ProctorSeverity> = {
  tab_hidden: "warning",
  tab_visible: "info",
  window_blur: "warning",
  window_focus: "info",
  fullscreen_exit: "warning",
  camera_active: "info",
  camera_denied: "warning",
  camera_error: "warning",
  camera_lost: "warning",
  face_not_detected: "warning",
  multiple_faces: "critical",
  low_lighting: "info",
  multiple_speakers: "critical",
};

const CATEGORY_BY_KIND: Record<ProctorEventKind, ProctorEventCategory> = {
  tab_hidden: "focus",
  tab_visible: "focus",
  window_blur: "focus",
  window_focus: "focus",
  fullscreen_exit: "focus",
  camera_active: "camera",
  camera_denied: "camera",
  camera_error: "camera",
  camera_lost: "camera",
  face_not_detected: "vision",
  multiple_faces: "vision",
  low_lighting: "vision",
  multiple_speakers: "audio",
};

/**
 * Neutral descriptions, used in the report and in the development simulator.
 *
 * Phrased as what was observed, never as what it means. "Left the interview
 * tab" is a fact; "switched away to look something up" is a story, and the
 * report is not entitled to tell one.
 */
const LABEL_BY_KIND: Record<ProctorEventKind, string> = {
  tab_hidden: "Left the interview tab",
  tab_visible: "Returned to the interview tab",
  window_blur: "Interview window lost focus",
  window_focus: "Interview window regained focus",
  fullscreen_exit: "Exited full screen",
  camera_active: "Camera running",
  camera_denied: "Camera permission blocked",
  camera_error: "Camera could not start",
  camera_lost: "Camera stopped during the interview",
  face_not_detected: "No face in the camera view",
  multiple_faces: "More than one face in the camera view",
  low_lighting: "Low light in the camera view",
  multiple_speakers: "More than one voice picked up",
};

/**
 * What the CANDIDATE is told, live, when this happens.
 *
 * `null` means no toast: an event worth recording is not automatically an event
 * worth interrupting someone mid-sentence about. Returning to the tab is the
 * clearest case — it is logged, and telling them about it would be noise.
 */
const CANDIDATE_MESSAGE_BY_KIND: Record<ProctorEventKind, string | null> = {
  tab_hidden: "You left the interview tab. Please stay on this page.",
  tab_visible: null,
  window_blur: "The interview window lost focus.",
  window_focus: null,
  fullscreen_exit: "You exited full screen.",
  camera_active: null,
  camera_denied:
    "Camera access is blocked. Your interview continues without video.",
  camera_error:
    "Your camera could not start. Your interview continues without video.",
  camera_lost: "Your camera stopped. Your interview continues without video.",
  face_not_detected: "We cannot see you in the camera view.",
  multiple_faces: "More than one person is visible in the camera view.",
  low_lighting: "Your camera view looks dark.",
  multiple_speakers: "More than one voice was picked up.",
};

export function severityOf(kind: ProctorEventKind): ProctorSeverity {
  return SEVERITY_BY_KIND[kind];
}

export function categoryOf(kind: ProctorEventKind): ProctorEventCategory {
  return CATEGORY_BY_KIND[kind];
}

export function labelOf(kind: ProctorEventKind): string {
  return LABEL_BY_KIND[kind];
}

export function candidateMessageOf(kind: ProctorEventKind): string | null {
  return CANDIDATE_MESSAGE_BY_KIND[kind];
}

export function isProctorEventKind(value: unknown): value is ProctorEventKind {
  return (
    typeof value === "string" &&
    (PROCTOR_EVENT_KINDS as readonly string[]).includes(value)
  );
}

/* ---------------------------------------------------------------- summary */

/** One kind, rolled up across an attempt. */
export type ProctorKindTally = {
  kind: ProctorEventKind;
  label: string;
  severity: ProctorSeverity;
  category: ProctorEventCategory;
  /** Total observations, i.e. the sum of every coalesced `count`. */
  count: number;
  firstAt: number;
  lastAt: number;
};

/** One notable moment, in order, for the report's timeline. */
export type ProctorTimelineEntry = {
  kind: ProctorEventKind;
  label: string;
  severity: ProctorSeverity;
  at: number;
  count: number;
  detail?: string;
};

/**
 * What the report renders.
 *
 * Counts and a timeline. No score, no verdict, no threshold — deliberately, and
 * see the note at the top of this file.
 */
export type ProctorSummary = {
  totalEvents: number;
  bySeverity: Record<ProctorSeverity, number>;
  byCategory: Record<ProctorEventCategory, number>;
  byKind: ProctorKindTally[];
  timeline: ProctorTimelineEntry[];
  /** Best known camera uptime, from heartbeat metadata. 0 when never started. */
  cameraActiveSeconds: number;
  /** Denials, failures and mid-interview drops, summed. */
  cameraErrors: number;
  /** True when a camera heartbeat was ever recorded for this attempt. */
  cameraEverActive: boolean;
};
