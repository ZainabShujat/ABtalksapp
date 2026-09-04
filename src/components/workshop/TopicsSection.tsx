"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { motion, useReducedMotion } from "framer-motion";
import { useCanvasScale } from "@/components/workshop/use-canvas-scale";
import {
  CANVAS_H,
  CANVAS_W,
  CAP_H,
  layoutTopics,
} from "@/components/workshop/topic-layout";

/**
 * The damped-spring curve Figma authored on the drop (node 1:169 y-track),
 * transcribed exactly. framer-motion accepts a raw easing function, so the
 * overshoot-and-settle matches the prototype rather than approximating it
 * with a stock spring.
 */
const SPRING = (t: number) =>
  1 - Math.exp(-t * 7.5258) * (Math.cos(t * 8.7987) + 0.8553 * Math.sin(t * 8.7987));

/** Drop distance, in the design's canvas units. */
const DROP = -900;

/**
 * The heading and subtitle's own entrance: a short slide down out of a fade.
 * A function so each can take its own place in the queue without repeating
 * the shape.
 */
const LEAD_VARIANTS = (delay: number) => ({
  parkedAbove: {
    opacity: 0,
    y: -26,
    transition: { duration: 0.3, delay: delay * 0.5, ease: "easeIn" as const },
  },
  parkedBelow: {
    opacity: 0,
    y: 26,
    transition: { duration: 0.3, delay: delay * 0.5, ease: "easeIn" as const },
  },
  shown: {
    opacity: 1,
    y: 0,
    transition: { duration: LEAD_MS, delay, ease: [0.22, 0.9, 0.28, 1] as const },
  },
});

/**
 * The sequence: the heading and subtitle lead, then the capsules cascade.
 *
 * Order is by HEIGHT, not by the Figma motion timeline. That timeline filled
 * the field from the middle outward, which is a fine effect but not one the
 * eye can read as falling — capsules landed above ones that had already
 * settled. Sorting by y means the topmost lands first and the rest follow it
 * down, which is what a cascade looks like.
 */
const LEAD_MS = 0.45;
const HEAD_STEP = 0.09;
/** The capsules start once the subtitle is on its way, not after it lands. */
const FIELD_LEAD = 0.26;
const FIELD_STEP = 0.075;

/**
 * When the drop is allowed to start.
 *
 * `amount: 0.25` alone was not a trigger at all here: the hero is a 1920×806
 * canvas scaled to fit, so on a 1440×900 window it ends 658px down and this
 * section starts right at the fold — 241 of its 525px were already on screen
 * at first paint, a ratio of 0.46. The observer fired during page load, the
 * capsules had finished dropping before anyone scrolled, and by the time the
 * reader arrived the animation was simply over.
 *
 * The negative bottom margin pulls the observation box up to the top 75% of the
 * window, so the strip of section that peeks above the fold does not count, and
 * 0.35 then asks for a real third of it. Measured, that means no window we care
 * about fires on load — 1440×900, 1280×800, 1536×864 and 1920×1080 all start
 * outside the box entirely — and each needs 150–300px of scroll, at which point
 * the heading is mid-screen and the capsule field is filling the lower half.
 *
 * On a window tall enough to show the whole section without scrolling it does
 * fire immediately, which is the right answer: the reader is already looking
 * at it.
 */
const REVEAL_MARGIN = "0px 0px -25% 0px";
/** Fraction of the section that must be inside the box before the drop starts. */
const REVEAL_IN = 0.35;
/**
 * …and the smaller fraction it has to fall below before the drop is undone.
 *
 * Two thresholds, not one. A single boundary sits at exactly one scroll
 * position, so a reader resting a trackpad there would flip the whole field in
 * and out on every stray pixel. Entering at 0.35 and leaving at 0.12 puts a
 * band between the two where nothing changes — a Schmitt trigger, and the
 * reason this is two observers rather than one.
 */
const REVEAL_OUT = 0.12;

/** Which side of the canvas the capsules wait on while hidden. */
type Park = "above" | "below";

interface Reveal {
  on: boolean;
  park: Park;
}

/**
 * Whether the capsules are in place — and, when they are not, which side they
 * are parked on.
 *
 * The `park` half is what makes the motion follow the reader rather than the
 * clock. Visibility alone gives one hidden position, 900 units ABOVE the
 * canvas, so every transition moves on that one axis: fine coming down the page
 * — the field falls into place, and lifts away when you scroll back up — but
 * wrong the moment you approach from underneath. Scrolling UP out of the
 * community section back into this one, the reader is travelling up while ten
 * capsules drop down past them.
 *
 * So the capsules park on the side the reader is coming FROM, read off the
 * section's own position at the instant the state flips:
 *
 *   section below the fold  → park above → it falls DOWN in, lifts UP out
 *   section above the fold  → park below → it rises UP in, sinks DOWN out
 *
 * Both cases move with the scroll rather than against it, and neither needs a
 * scroll listener or a remembered direction — the rect says which it is.
 *
 * `park` is only rewritten when `on` changes. Updating it while hidden would
 * teleport a parked field 1800 units across to the other side.
 */
function useRevealState(ref: React.RefObject<Element | null>): Reveal {
  const [state, setState] = useState<Reveal>({ on: false, park: "above" });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        // top >= 0: the section starts at or below the top of the box, so the
        // reader is above it. Below 0 it has already gone past overhead.
        const park: Park = entry.boundingClientRect.top >= 0 ? "above" : "below";
        const ratio = entry.intersectionRatio;
        setState((prev) => {
          if (!prev.on && ratio >= REVEAL_IN) return { on: true, park };
          if (prev.on && ratio <= REVEAL_OUT) return { on: false, park };
          return prev;
        });
      },
      {
        // Both thresholds plus the ends, so the callback fires on each crossing
        // rather than only when the ratio happens to be sampled in range.
        threshold: [0, REVEAL_OUT, REVEAL_IN, 1],
        rootMargin: REVEAL_MARGIN,
      },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref]);

  return state;
}

/**
 * Used when the promoted workshop carries no `topics` of its own, so this
 * section can never render empty mid-swap between weeks.
 */
const DEFAULT_TOPICS = [
  "Prompt Engineering Fundamentals",
  "Role, Context & Task",
  "Style, Constraints & Output",
  "AI Image Generation",
  "AI Video Generation",
  "AI Voice & Audio Creation",
  "AI Avatar & Digital Presenters",
  "Script → Avatar → Voice → Video",
  "AI + MCP Workflows",
  "Canva AI & Content Publishing",
];

/**
 * Passed in from the page, which resolves the current workshop on the server.
 * This used to be a module-scope `EVENTS.find(...)` on the static flags, so it
 * was computed once at import and stayed on a finished workshop forever.
 */


export default function TopicsSection({ topics }: { topics: string[] | null }) {
  const { ref: canvasRef, scale: canvasScale } = useCanvasScale(CANVAS_W);

  /**
   * The `prefers-reduced-motion` block in this file's <style> cannot reach
   * this animation: framer-motion writes the transform inline on every frame,
   * and `animation: none` only silences CSS keyframes. Starting from "shown"
   * is what actually honours the setting — the capsules are simply there.
   */
  const reduceMotion = useReducedMotion();

  const stackRef = useRef<HTMLDivElement>(null);
  const canvas = useRevealState(canvasRef);
  const stack = useRevealState(stackRef);
  // A hidden breakpoint's element never intersects, so only the rendered one
  // is ever on; reduced motion pins both shown and nothing ever moves.
  const variantFor = (r: Reveal) =>
    reduceMotion || r.on ? "shown" : r.park === "above" ? "parkedAbove" : "parkedBelow";
  const canvasState = variantFor(canvas);
  const stackState = variantFor(stack);

  // Was solved once at module load. It now depends on a prop, so it is memoised
  // per topic list instead — layoutTopics is a pure function of its input, and
  // the list only changes when the current workshop does.
  const PLACED = useMemo(() => layoutTopics(topics ?? DEFAULT_TOPICS), [topics]);

  /**
   * Each capsule's turn, keyed by its text.
   *
   * Derived from the settled layout rather than carried on it: `layoutTopics`
   * is a pure geometry solver and has no opinion about motion, and the y it
   * produces is exactly what the cascade needs to order by.
   */
  const fall = useMemo(() => {
    const order = new Map<string, number>();
    [...PLACED]
      .sort((a, b) => a.y - b.y)
      .forEach((p, i) => order.set(p.text, FIELD_LEAD + i * FIELD_STEP));
    return order;
  }, [PLACED]);

  // No section padding: the design stacks sections edge to edge (hero
  // 78→884, this 884→1584, community 1584→2402), with the breathing room
  // built into each canvas rather than added between them.
  return (
    /*
     * Pure white, not the page wash.
     *
     * `.wk-root` paints --wk-page-grad with background-attachment: fixed, so
     * every section inherits the same cream-to-peach ramp and none of them can
     * be lighter than it. This one lays white over its own box.
     *
     * The top 56px fade is what keeps that from drawing a line across the page:
     * the hero above sits on the cream, and white starting at full strength on
     * the section boundary would meet it as a hard edge. The community section
     * below opens with its own orange wash, which covers the other seam.
     */
    <section
      className="w-full"
      style={{
        background:
          "linear-gradient(180deg, rgba(255,255,255,0) 0px, #ffffff 56px, #ffffff 100%)",
      }}
    >
      <style>{`
        .wk-learn-canvas {
          position: absolute;
          top: 0;
          left: 0;
          width: ${CANVAS_W}px;
          height: ${CANVAS_H}px;
          transform-origin: top left;
          /* --wk-scale is a UNITLESS number set from a ResizeObserver below.
             It cannot be derived in CSS: scale() rejects a length, and
             calc(100cqw / 1920) divides a length by a number, which yields a
             length and silently invalidates the whole transform. */
          transform: scale(var(--wk-scale, 1));
        }
        @media (prefers-reduced-motion: reduce) {
          .wk-learn-canvas * { animation: none !important; transition: none !important; }
        }
      `}</style>

      {/* ---------- scattered field (lg and up) ----------
          Heading and subtitle live INSIDE the canvas, at the design's own
          y-offsets (47 and 117 of 700), so the whole section scales as one
          composition. Below lg the scale factor would render 24px type at
          ~5px, so the content reflows instead.
          `overflow-hidden` clips the capsules while they drop in from above. */}
      <div
        ref={canvasRef}
        className="relative mx-auto hidden w-full max-w-[1920px] overflow-hidden lg:block"
        style={
          {
            aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
            "--wk-scale": canvasScale,
          } as React.CSSProperties
        }
      >
        {/* The heading and subtitle lead the sequence — a short fade and a
            slide DOWN, the same direction the capsules then fall from, so the
            whole section reads as arriving rather than as two effects that
            happen to share a trigger. They reverse with everything else. */}
        <motion.div
          className="wk-learn-canvas"
          initial="parkedAbove"
          animate={canvasState}
        >
          {/* heading — node 1:168 */}
          <motion.h2
            variants={LEAD_VARIANTS(0)}
            style={{
              position: "absolute",
              // 47 in the design. The hero frame already leaves 29 units below
              // its card, so 47 on top of that was 76 units of nothing between
              // two sections that belong together.
              top: 16,
              left: 0,
              width: CANVAS_W,
              margin: 0,
              textAlign: "center",
              fontSize: 64,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: "-0.01em",
              color: "var(--wk-text)",
            }}
          >
            What You&apos;ll Learn
          </motion.h2>

          {/* subtitle — node 1:191 */}
          <motion.p
            variants={LEAD_VARIANTS(HEAD_STEP)}
            style={{
              position: "absolute",
              top: 84,
              left: 0,
              width: CANVAS_W,
              margin: 0,
              textAlign: "center",
              // 32 in the design, which at half the heading's 64 read as a
              // second heading rather than a caption under one.
              fontSize: 26,
              fontWeight: 500,
              lineHeight: 1.2,
              color: "var(--wk-text-faint)",
            }}
          >
            Practical AI skills through live, hands-on demonstrations and
            step-by-step builds.
          </motion.p>
        </motion.div>

        {/* The trigger lives on the canvas, not on each capsule: a capsule
            starts at y:-900, outside this box's `overflow-hidden`, and a
            clipped element never reports as intersecting — so a per-capsule
            `whileInView` can never fire and they would stay invisible. */}
        <motion.div
          className="wk-learn-canvas"
          initial="parkedAbove"
          animate={canvasState}
        >
          {PLACED.map((p) => {
            // Its turn in the cascade, and — leaving — the reverse of it, so
            // the field lifts away from the bottom up.
            const fallIn = fall.get(p.text) ?? FIELD_LEAD;
            const fallOut = (PLACED.length - 1) * FIELD_STEP - (fallIn - FIELD_LEAD);
            return (
            <motion.div
              key={p.text}
              variants={{
                // Two parked states, one above the canvas and one below it.
                // Which is used is decided by useRevealState, not by this
                // component — see the note there.
                //
                // The exit is eased the other way from the drop, and the fade
                // now runs nearly the whole length of the move rather than
                // finishing in a fifth of it: at 0.22s against a 0.4s travel
                // the capsules were invisible for most of the distance, so the
                // reverse could not be read as motion at all.
                parkedAbove: {
                  opacity: 0,
                  y: DROP,
                  transition: {
                    y: { duration: 0.5, delay: fallOut, ease: "easeIn" },
                    opacity: { duration: 0.42, delay: fallOut },
                  },
                },
                parkedBelow: {
                  opacity: 0,
                  y: -DROP,
                  transition: {
                    y: { duration: 0.5, delay: fallOut, ease: "easeIn" },
                    opacity: { duration: 0.42, delay: fallOut },
                  },
                },
                shown: {
                  opacity: 1,
                  y: 0,
                  transition: {
                    // SPRING is the damped curve Figma authored — it overshoots
                    // and settles, which is the "landing" this needs. The fade
                    // is quick and runs at the head of the fall so the capsule
                    // is solid on the way down rather than materialising.
                    y: { duration: 0.78, delay: fallIn, ease: SPRING },
                    opacity: { duration: 0.16, delay: fallIn, ease: "easeOut" },
                  },
                },
              }}
              style={{ position: "absolute", left: p.x, top: p.y, width: p.w }}
            >
              <div
                className="flex items-center justify-center rounded-[50px]"
                style={{
                  height: CAP_H,
                  background: p.bg,
                  color: p.fg,
                  transform: `rotate(${p.rot}deg) skewX(${p.skew}deg)`,
                  boxShadow: "0 4px 4px rgba(var(--wk-ink-a),0.25)",
                }}
              >
                <span className="whitespace-nowrap text-[24px] font-medium">
                  {p.text}
                </span>
              </div>
            </motion.div>
            );
          })}
        </motion.div>
      </div>

      {/* ---------- wrapped cluster (below lg) ---------- */}
      <div ref={stackRef} className="px-4 pb-14 pt-9 lg:hidden">
        <h2
          className="mb-4 text-center text-[34px] font-bold leading-[1.1] tracking-tight sm:text-[48px]"
          style={{ color: "var(--wk-text)" }}
        >
          What You&apos;ll Learn
        </h2>
        <p
          className="mx-auto mb-10 max-w-2xl text-center text-[16px] font-medium leading-snug sm:text-[20px]"
          style={{ color: "var(--wk-text-faint)" }}
        >
          Practical AI skills through live, hands-on demonstrations and
          step-by-step builds.
        </p>

        <motion.div
          className="mx-auto flex max-w-2xl flex-wrap justify-center gap-2.5"
          initial="parkedAbove"
          animate={stackState}
        >
        {PLACED.map((p, i) => (
          <motion.span
            key={p.text}
            // Wrapped flow here, so the cascade follows READING order — the
            // canvas's y-sort would look arbitrary against a layout the solver
            // no longer controls.
            variants={{
              parkedAbove: {
                opacity: 0,
                y: -24,
                transition: { duration: 0.34, delay: (PLACED.length - 1 - i) * 0.03, ease: "easeIn" },
              },
              parkedBelow: {
                opacity: 0,
                y: 24,
                transition: { duration: 0.34, delay: (PLACED.length - 1 - i) * 0.03, ease: "easeIn" },
              },
              shown: {
                opacity: 1,
                y: 0,
                transition: { duration: 0.5, delay: FIELD_LEAD + i * 0.05, ease: SPRING },
              },
            }}
            className="rounded-[50px] px-5 py-2.5 text-[14px] font-medium"
            style={{
              background: p.bg,
              color: p.fg,
              boxShadow: "0 4px 4px rgba(var(--wk-ink-a),0.12)",
            }}
          >
            {p.text}
          </motion.span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
