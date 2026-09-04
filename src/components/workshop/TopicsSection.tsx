"use client";

import { useMemo, useRef, useState } from "react";

import { motion, useInView, useReducedMotion } from "framer-motion";
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

/**
 * `on` — whether the capsules should be in place, in BOTH directions.
 *
 * Not `whileInView` with `once`: that is a one-way switch, so scrolling back up
 * left the field frozen in its landed state. Driving `animate` from a boolean
 * means leaving the section replays the entrance backwards — up and out, the
 * same 900 units it dropped through.
 */
function useRevealState(ref: React.RefObject<Element | null>): boolean {
  const entered = useInView(ref, { amount: REVEAL_IN, margin: REVEAL_MARGIN });
  const present = useInView(ref, { amount: REVEAL_OUT, margin: REVEAL_MARGIN });

  // Adjusted during render rather than in an effect. Both inputs are state
  // inside useInView, so the render that changes one of them is the render that
  // can settle this; an effect would commit, then set state, then render again
  // just to catch up. React re-runs this component immediately on a set during
  // its own render, before anything reaches the DOM.
  //
  // Inside the hysteresis band `next` evaluates to the current value, so the
  // set is skipped and there is no loop.
  const [on, setOn] = useState(false);
  const next = entered ? true : present ? on : false;
  if (next !== on) setOn(next);
  return next;
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
  const canvasOn = useRevealState(canvasRef);
  const stackOn = useRevealState(stackRef);
  // A hidden breakpoint's element never intersects, so only the rendered one
  // is ever true; reduced motion pins both on and nothing ever moves.
  const canvasState = reduceMotion || canvasOn ? "shown" : "hidden";
  const stackState = reduceMotion || stackOn ? "shown" : "hidden";

  // Was solved once at module load. It now depends on a prop, so it is memoised
  // per topic list instead — layoutTopics is a pure function of its input, and
  // the list only changes when the current workshop does.
  const PLACED = useMemo(() => layoutTopics(topics ?? DEFAULT_TOPICS), [topics]);

  // No section padding: the design stacks sections edge to edge (hero
  // 78→884, this 884→1584, community 1584→2402), with the breathing room
  // built into each canvas rather than added between them.
  return (
    <section className="w-full">
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
        <div className="wk-learn-canvas">
          {/* heading — node 1:168 */}
          <h2
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
          </h2>

          {/* subtitle — node 1:191 */}
          <p
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
          </p>
        </div>

        {/* The trigger lives on the canvas, not on each capsule: a capsule
            starts at y:-900, outside this box's `overflow-hidden`, and a
            clipped element never reports as intersecting — so a per-capsule
            `whileInView` can never fire and they would stay invisible. */}
        <motion.div
          className="wk-learn-canvas"
          initial="hidden"
          animate={canvasState}
        >
          {PLACED.map((p) => (
            <motion.div
              key={p.text}
              variants={{
                hidden: {
                  opacity: 0,
                  y: DROP,
                  // The way back out. Quicker than the drop and eased the other
                  // way, so leaving reads as the field lifting away rather than
                  // as a second, slower entrance played in reverse.
                  transition: {
                    y: { duration: 0.4, delay: p.delay * 0.35, ease: "easeIn" },
                    opacity: { duration: 0.22, delay: p.delay * 0.35 },
                  },
                },
                shown: {
                  opacity: 1,
                  y: 0,
                  transition: {
                    y: { duration: 0.7, delay: p.delay, ease: SPRING },
                    opacity: { duration: 0.15, delay: p.delay, ease: "easeOut" },
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
          ))}
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
          initial="hidden"
          animate={stackState}
        >
        {PLACED.map((p) => (
          <motion.span
            key={p.text}
            variants={{
              hidden: {
                opacity: 0,
                y: -24,
                transition: { duration: 0.3, delay: p.delay * 0.25, ease: "easeIn" },
              },
              shown: {
                opacity: 1,
                y: 0,
                transition: { duration: 0.5, delay: p.delay * 0.5, ease: SPRING },
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
