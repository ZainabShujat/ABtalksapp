"use client";

import { motion } from "framer-motion";
import { EVENTS } from "@/components/workshop/events-data";
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
 * Read off the `register && registrationOpen` flags rather than today's date:
 * those are manual switches, so this resolves identically on the server and
 * the client and cannot produce a hydration mismatch or a swap-in flash.
 */
const activeTopics =
  EVENTS.find((e) => e.register && e.registrationOpen)?.topics ?? DEFAULT_TOPICS;

/** Solved once at module load — pure function of constant input. */
const PLACED = layoutTopics(activeTopics);

export default function TopicsSection() {
  const { ref: canvasRef, scale: canvasScale } = useCanvasScale(CANVAS_W);

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
              top: 47,
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
              top: 117,
              left: 0,
              width: CANVAS_W,
              margin: 0,
              textAlign: "center",
              fontSize: 32,
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
          whileInView="shown"
          viewport={{ once: true, amount: 0.25 }}
        >
          {PLACED.map((p) => (
            <motion.div
              key={p.text}
              variants={{
                hidden: { opacity: 0, y: DROP },
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
      <div className="px-4 py-14 lg:hidden">
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
          whileInView="shown"
          viewport={{ once: true, amount: 0.25 }}
        >
        {PLACED.map((p) => (
          <motion.span
            key={p.text}
            variants={{
              hidden: { opacity: 0, y: -24 },
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
