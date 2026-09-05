import type { EventCollector } from "@/features/interview/proctoring/collector";

/**
 * The deterministic browser signals.
 *
 * These are the only detectors that are REAL in v0.1. They observe events the
 * browser already fires; there is no inference, no model and no camera frame
 * involved, which is why they are the ones we are willing to record.
 *
 * Client-only module — every function here touches `document`/`window` — but
 * deliberately not marked `"use client"`: it exports no component, and the
 * directive belongs on the component that imports it. Every entry point still
 * guards on `typeof document`, so importing this from a Server Component would
 * be inert rather than a crash.
 */

type Cleanup = () => void;

const noop: Cleanup = () => {};

/**
 * Tab visibility and window focus.
 *
 * Both, not either. They are not the same event: switching to another
 * application blurs the window without hiding the tab, and switching browser
 * tabs does both. Recording only one would miss half of what happens on a
 * normal desktop. The 2s debounce in the collector is what stops the overlap
 * from being logged as two incidents.
 */
export function attachFocusListeners(collector: EventCollector): Cleanup {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return noop;
  }

  const onVisibility = () => {
    collector.push(document.hidden ? "tab_hidden" : "tab_visible");
  };
  const onBlur = () => collector.push("window_blur");
  const onFocus = () => collector.push("window_focus");

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
  };
}

/**
 * Full-screen EXIT only.
 *
 * v0.1 does not request full screen and does not enforce it. It records a
 * departure from full screen only when the page was actually in it — otherwise
 * every interview taken in a normal window would log a violation for a mode it
 * was never asked to enter.
 */
export function attachFullscreenListener(collector: EventCollector): Cleanup {
  if (typeof document === "undefined") return noop;

  let wasFullscreen = document.fullscreenElement !== null;

  const onChange = () => {
    const isFullscreen = document.fullscreenElement !== null;
    if (wasFullscreen && !isFullscreen) collector.push("fullscreen_exit");
    wasFullscreen = isFullscreen;
  };

  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

/** Both sets at once, with one cleanup. What the session actually calls. */
export function attachProctorListeners(collector: EventCollector): Cleanup {
  const detachFocus = attachFocusListeners(collector);
  const detachFullscreen = attachFullscreenListener(collector);
  return () => {
    detachFocus();
    detachFullscreen();
  };
}
