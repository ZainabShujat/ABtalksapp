"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Fits a fixed-size design canvas into whatever width its container has.
 *
 * Several `/workshop` sections are authored as absolutely-positioned
 * compositions on a fixed Figma canvas (the hero at 1920×806, the
 * "What You'll Learn" scatter at 1920×700). Re-laying them out with flexbox
 * loses the exact positions — and in the hero's case the intentional clipping
 * of the poster by the card's bottom edge. Scaling the whole canvas keeps the
 * composition byte-for-byte and only changes its size.
 *
 * Measured with a ResizeObserver rather than computed in CSS: `scale()`
 * rejects a length, and `calc(100cqw / 1920)` divides a length by a number,
 * which yields a length and silently invalidates the entire transform.
 *
 * Returns a unitless factor — assign it to a custom property and use
 * `transform: scale(var(--wk-scale, 1))`.
 */
export function useCanvasScale(canvasWidth: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  /**
   * The container's own height, reported alongside the scale.
   *
   * A caller that lets the container grow past the scaled canvas — to match a
   * neighbouring column, say — needs this to centre the canvas inside it.
   * Without it the drawing pins to the top and the slack collects as a blank
   * strip along the bottom, which reads as an unfinished box.
   *
   * Measuring here is safe: the observer already runs on this element, and the
   * value is only ever read, never fed back into the element's own height.
   */
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? 0;
      const h = entry?.contentRect.height ?? 0;
      if (w > 0) setScale(w / canvasWidth);
      if (h > 0) setHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasWidth]);

  return { ref, scale, height };
}
