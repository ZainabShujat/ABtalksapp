"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Anil Sir peeks up from behind the Scout search bar while it has focus.
 *
 * Rendered inside `.scout-field`. The same form node serves the green hero and
 * the white results screen, so one instance covers both search bars.
 *
 * Layout never moves: `.scout-peek` is an absolutely positioned clip box whose
 * bottom edge is the field's top edge. The stage inside slides up out of it on
 * focus and back down on blur (CSS, ~300ms); this component only picks WHICH
 * frame is showing.
 *
 *   focus            → rising, then peeking
 *   typing           → thinking; back to peeking once typing pauses
 *   focused & quiet  → looking
 *   blur / submit    → retracting while it slides down, then hidden
 *
 * Every frame is mounted and stacked, so all of them load up front and a swap
 * never flashes.
 */

type Frame = "hidden" | "rising" | "peeking" | "typing" | "looking" | "retracting";

/**
 * The sprites share one drawing scale but not one canvas. Each is anchored on
 * the centre of the hands (`cx`) and the true bottom of the drawing (`gap` is
 * the transparent margin under it), so the hands land on the bar in every frame.
 * Values are source pixels, measured from the PNGs in /public/hire/scout-peek.
 *
 * `typing` uses expr_think, a head-and-shoulders crop drawn smaller than the
 * peek frames: `k` scales it up to the same head size, and its `cx` is the
 * point that puts his head where it sits in the peeking frames.
 */
const FRAMES: Record<
  Frame,
  { src: string; w: number; cx: number; gap: number; k?: number }
> = {
  hidden: { src: "/hire/scout-peek/01_hidden.png", w: 215, cx: 110, gap: 10 },
  rising: { src: "/hire/scout-peek/02_rising.png", w: 280, cx: 146, gap: 11 },
  peeking: { src: "/hire/scout-peek/03_peeking.png", w: 305, cx: 158, gap: 12 },
  typing: { src: "/hire/scout-peek/expr_think.png", w: 165, cx: 94, gap: 0, k: 1.3 },
  looking: { src: "/hire/scout-peek/05_looking.png", w: 280, cx: 138, gap: 12 },
  retracting: { src: "/hire/scout-peek/07_retracting.png", w: 274, cx: 141, gap: 11 },
};

const ORDER = Object.keys(FRAMES) as Frame[];

/** How long the rising / retracting frames show — the length of the slide. */
const SLIDE_MS = 260;
/** A pause this long after a keystroke ends the thinking pose. */
const TYPING_IDLE_MS = 1200;
/** Focused but untouched this long, he glances sideways. */
const LOOKING_MS = 4000;

export function ScoutPeek() {
  const rootRef = useRef<HTMLSpanElement>(null);
  const [up, setUp] = useState(false);
  const [frame, setFrame] = useState<Frame>("hidden");

  useEffect(() => {
    const field = rootRef.current?.parentElement;
    if (!field) return;

    let slideTimer: number | undefined;
    let idleTimer: number | undefined;
    let lookTimer: number | undefined;
    const clear = () => {
      window.clearTimeout(slideTimer);
      window.clearTimeout(idleTimer);
      window.clearTimeout(lookTimer);
    };
    const settle = () => {
      setFrame("peeking");
      window.clearTimeout(lookTimer);
      lookTimer = window.setTimeout(() => setFrame("looking"), LOOKING_MS);
    };

    const onFocus = () => {
      clear();
      setUp(true);
      setFrame("rising");
      slideTimer = window.setTimeout(settle, SLIDE_MS);
    };
    const retract = () => {
      clear();
      setUp(false);
      setFrame("retracting");
      slideTimer = window.setTimeout(() => setFrame("hidden"), SLIDE_MS);
    };
    const onBlur = (e: FocusEvent) => {
      // Focus moving between elements inside the field is not a blur of it.
      if (e.relatedTarget instanceof Node && field.contains(e.relatedTarget)) return;
      retract();
    };
    const onInput = () => {
      window.clearTimeout(slideTimer);
      window.clearTimeout(idleTimer);
      window.clearTimeout(lookTimer);
      setFrame("typing");
      idleTimer = window.setTimeout(settle, TYPING_IDLE_MS);
    };

    field.addEventListener("focusin", onFocus);
    field.addEventListener("focusout", onBlur);
    field.addEventListener("input", onInput);
    // Submitting disables the input while Scout searches, and Chrome fires no
    // blur when a focused control is disabled — so watch for it directly.
    const input = field.querySelector("textarea, input");
    const disabledWatch = new MutationObserver(() => {
      if (input && (input as HTMLTextAreaElement).disabled) retract();
    });
    if (input) disabledWatch.observe(input, { attributes: true, attributeFilter: ["disabled"] });
    // Already focused when this mounts (autofocus, or a remount mid-typing).
    if (field.contains(document.activeElement)) onFocus();

    return () => {
      clear();
      disabledWatch.disconnect();
      field.removeEventListener("focusin", onFocus);
      field.removeEventListener("focusout", onBlur);
      field.removeEventListener("input", onInput);
    };
  }, []);

  return (
    <span ref={rootRef} className="scout-peek" aria-hidden="true">
      <span className={cn("scout-peek__stage", up && "is-up")}>
        {ORDER.map((key) => {
          const f = FRAMES[key];
          return (
            // eslint-disable-next-line @next/next/no-img-element -- small static sprites swapped by opacity; next/image adds wrappers and lazy-loading that would flash on swap
            <img
              key={key}
              src={f.src}
              alt=""
              draggable={false}
              className={cn("scout-peek__img", frame === key && "is-on")}
              style={
                {
                  "--w": f.w,
                  "--cx": f.cx,
                  "--gap": f.gap,
                  "--k": f.k ?? 1,
                } as React.CSSProperties
              }
            />
          );
        })}
      </span>
    </span>
  );
}
