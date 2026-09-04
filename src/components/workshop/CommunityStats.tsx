"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { useCanvasScale } from "@/components/workshop/use-canvas-scale";

/**
 * Community section — Figma node 1:311, an absolutely-positioned composition
 * on a 1920×818 frame, rendered on that canvas and scaled to fit.
 *
 * Below `lg` the canvas would be illegibly small, so the same content reflows
 * into a stacked layout.
 */

const FRAME_W = 1920;
/**
 * 818 in the design. The whole composition moved up 37 units — the heading sat
 * at 111, which on top of the topic canvas's own bottom margin left this
 * section floating away from the content above it. Everything inside kept its
 * spacing; only the block's top padding and the frame it lives on lost the 37.
 */
const FRAME_H = 781;

/** How often the counters replay while the section is on screen. */
const COUNT_REPEAT_MS = 5000;
/** One count-up, and the delay between the collage tiles fading in. 0.18 read
 *  as one movement rather than three; at 0.32 each tile lands on its own. */
const COUNT_MS = 1800;
const TILE_STAGGER = 0.32;

/**
 * When this section counts as being looked at.
 *
 * 0.15 with a -10% margin fired while the section was barely peeking over the
 * fold: a seventh of a 586px canvas is 88px, so the collage had begun fading in
 * — and the counters had begun counting — before any of it was really on
 * screen. 0.4 into the top 80% of the window means roughly the lower half of
 * the viewport is this section before anything starts.
 */
const ON_SCREEN_AMOUNT = 0.4;
const ON_SCREEN_MARGIN = "0px 0px -20% 0px";

/** Nodes 1:319-1:324. `x` is the number's left edge, `cx` the label's centre. */
const STATS = [
  { value: 11000, suffix: "+", label: "AI Learners", sub: "From 25+ Countries", x: 123, cx: 227 },
  { value: 550, suffix: "+", label: "Institutions", sub: "Students enrolled", x: 453, cx: 519.5 },
  { value: 300, suffix: "+", label: "Organizations", sub: "Working professionals", x: 747, cx: 810.5 },
] as const;

/**
 * The figures use the page font, like everything else on /workshop.
 *
 * They were the one exception: Gemunu Libre, which the Figma file specifies for
 * these numerals (nodes 1:319-1:321). It was also the ONLY non-Instrument-Sans
 * text on the route — 12 text nodes against 230 — and a condensed display face
 * beside the body font is what made the page read as typographically mixed.
 *
 * Size and weight are untouched, so the figures keep their prominence; only the
 * family is unified. Restore the Gemunu stack here if the Figma spec is meant
 * to win over route-wide consistency.
 */
const NUM_FONT = "inherit";

/**
 * Whether `ref` is on screen — reported continuously, not latched.
 *
 * It used to `disconnect()` on the first intersection, which is why the
 * counters ran once for the life of the page. The timer below needs to know
 * when the section LEAVES as well, so nothing keeps ticking behind the
 * reader's back further down the page.
 *
 * The element for each breakpoint is `display: none` at the other one, and a
 * `display: none` element never intersects, so only the rendered block ever
 * reports true.
 */
function useOnScreen(
  ref: React.RefObject<HTMLElement | null>,
  threshold = ON_SCREEN_AMOUNT,
): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry?.isIntersecting)),
      { threshold, rootMargin: ON_SCREEN_MARGIN },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref, threshold]);
  return visible;
}

/**
 * A counter that advances every `period` ms, but only while `active`.
 *
 * One interval, owned by one effect, torn down by that effect's cleanup — so
 * leaving the section stops it, returning starts a fresh one, and unmounting
 * cannot leave a timer running. Nothing here schedules a second timer, so the
 * counts cannot stack however often the reader scrolls past.
 */
function useRepeat(active: boolean, period: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setN((prev) => prev + 1), period);
    return () => clearInterval(id);
  }, [active, period]);
  return n;
}

function CountUp({
  target,
  run,
  runKey = 0,
  instant = false,
  duration = COUNT_MS,
}: {
  target: number;
  run: boolean;
  /** Bump to replay the same count from zero — see useRepeat. */
  runKey?: number;
  /** Reduced motion: show the figure, never animate to it. */
  instant?: boolean;
  duration?: number;
}) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (instant || !run) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setVal(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Cancelling on re-run is what keeps two counts from driving the same
    // figure at once when the interval fires.
    return () => cancelAnimationFrame(raf);
  }, [run, runKey, target, duration, instant]);
  // Reduced motion renders the figure straight out rather than storing it —
  // there is no animation to hold state for.
  return <>{(instant ? target : val).toLocaleString()}</>;
}

function BodyCopy() {
  return (
    <>
      <p style={{ margin: 0 }}>
        ABTalks is where ambitious learners master AI together — through live
        workshops, hands-on challenges, and a community that ships.
      </p>
      <p style={{ margin: 0 }}>&nbsp;</p>
      <p style={{ margin: 0 }}>
        Take on the{" "}
        <Link
          href="/"
          style={{ color: "var(--wk-a1)", fontWeight: 700, textDecoration: "underline" }}
        >
          60-Day Claude AI Challenge
        </Link>
        , build in public, and get discovered by recruiters.
      </p>
    </>
  );
}

export default function CommunityStats() {
  const { ref: canvasRef, scale } = useCanvasScale(FRAME_W);
  const stackRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion() ?? false;

  const canvasOn = useOnScreen(canvasRef);
  const stackOn = useOnScreen(stackRef);
  const onScreen = canvasOn || stackOn;

  // Reduced motion gets the figures, not a counter looping at them.
  const tick = useRepeat(onScreen && !reduceMotion, COUNT_REPEAT_MS);

  // Sticky: the numbers and the collage fade in once and stay. Only the count
  // replays — having the whole block fade out every time it left the viewport
  // would be a second, unasked-for animation.
  //
  // Latched during render, not in an effect: `onScreen` is already state, so the
  // render that flips it is the render that can latch this, with no second pass.
  // The guard makes the set fire exactly once.
  //
  // Sticky on purpose, and only the FIGURES use it. Having the numbers fade out
  // every time the section left the viewport would be a second animation nobody
  // asked for. The collage reads `onScreen` directly, because there the reverse
  // IS the ask.
  const [seen, setSeen] = useState(false);
  if (onScreen && !seen) setSeen(true);

  // `run` is the sticky flag, not the live one. Gating the animation itself on
  // visibility froze the figures wherever the count had got to when the reader
  // scrolled off — and the observer's -10% margin means the section can still
  // be a sliver on screen when it reports as gone, so a half-counted "6,273+"
  // was visible. Started counts now always finish; it is the REPEAT that stops,
  // because `tick` only advances while the section is on screen.
  const counter = (value: number) => (
    <CountUp target={value} run={seen} runKey={tick} instant={reduceMotion} />
  );

  return (
    <>
      {/* ================= exact canvas (lg and up) ================= */}
      <div
        ref={canvasRef}
        className="relative mx-auto hidden w-full overflow-hidden lg:block"
        style={
          {
            maxWidth: FRAME_W,
            aspectRatio: `${FRAME_W} / ${FRAME_H}`,
            "--wk-scale": scale,
          } as React.CSSProperties
        }
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: FRAME_W,
            height: FRAME_H,
            transformOrigin: "top left",
            transform: "scale(var(--wk-scale, 1))",
          }}
        >
          {/* Blurred glow (node 1:312) — the wash across the top of this
              section, and what separates it from the section above. The SVG is
              2519×746 and sits 300px outside its 1919×146 box on every side:
              that overhang IS the blur, so it must not be squashed to the box.
              Recoloured from the Figma blue to the palette's #E05226 and held
              at ~1/3 opacity — orange is far denser than the pale blue was, and
              at full strength it reads as a solid band rather than a wash.

              Shortened from 746 to 470 and dropped from -289 to -150. Two
              things wrong with the original: it reached 457 of an 818 frame, so
              it was still colouring the section past the statistics; and its
              glow peaked at 84, close enough to the top that `overflow: hidden`
              cut it near full strength and drew a hard line along the seam with
              the section above. Peaking at 85 with a longer tail above the clip
              keeps the top edge soft, and the wash is spent by 320 — the top
              40% — which is where the overlay below takes it to white. */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: -296,
              top: -150,
              width: 2519,
              height: 470,
              opacity: 0.3,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/workshop/community/band.svg"
              alt=""
              style={{ display: "block", width: "100%", height: "100%" }}
            />
          </div>

          {/* …and this takes the rest of the section to clean white.

              The peach under the lower half is the PAGE wash — .wk-root paints
              --wk-page-grad with background-attachment: fixed, so every screenful
              carries the same cream-to-peach ramp and no section can be lighter
              than it. Rather than re-cut that gradient for the whole route, this
              lays white over just this canvas.

              It now reaches solid white by 46% and HOLDS it to the bottom edge,
              which it could not do while the events section below was a solid
              --wk-bg-alt peach — white against that was a step. That section is
              --wk-bg now, two shades off white, so the seam is invisible and the
              lower half of this one can be properly clean.

              The ramp is long (10% to 46%) so the wash above dissolves into it
              rather than meeting it at a line. */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(180deg, rgba(255,255,255,0) 10%, rgba(255,255,255,0.5) 28%, rgba(255,255,255,0.88) 40%, #ffffff 52%, #ffffff 100%)",
            }}
          />

          {/* heading — node 1:317 */}
          <h2
            style={{
              position: "absolute",
              left: 123,
              top: 74,
              width: 682,
              margin: 0,
              fontSize: 64,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: "-0.01em",
              color: "var(--wk-text)",
            }}
          >
            The ABTalks AI Learners Community
          </h2>

          {/* subhead — node 1:314 */}
          <p
            style={{
              position: "absolute",
              left: 130,
              top: 240,
              width: 681,
              margin: 0,
              // 36 in the design — nine-sixteenths of the 64px heading above it,
              // which made the two read as a pair of headings. At 28 it sits
              // between the heading and the 20px body, which is the order the
              // section is meant to be read in.
              fontSize: 28,
              fontWeight: 600,
              lineHeight: 1.1,
              color: "var(--wk-text-dim)",
            }}
          >
            You&apos;re joining a fast-growing movement of builders learning AI
            together.
          </p>

          {/* body — node 1:318 */}
          <div
            style={{
              position: "absolute",
              left: 123,
              top: 352,
              width: 693,
              fontSize: 20,
              fontWeight: 500,
              lineHeight: 1.1,
              color: "var(--wk-text-faint)",
            }}
          >
            <BodyCopy />
          </div>

          {/* stats — nodes 1:319-1:324 */}
          <div style={{ position: "absolute", inset: 0 }}>
            {STATS.map((s, i) => (
              <div key={s.label}>
                <div
                  style={{
                    position: "absolute",
                    left: s.x,
                    top: 543,
                    fontFamily: NUM_FONT,
                    fontSize: 64,
                    fontWeight: 700,
                    lineHeight: 1.1,
                    whiteSpace: "nowrap",
                    color: "var(--wk-text)",
                    opacity: seen ? 1 : 0,
                    transition: `opacity 0.6s ease ${i * 0.12}s`,
                  }}
                >
                  {counter(s.value)}
                  {s.suffix}
                </div>

                <div
                  style={{
                    position: "absolute",
                    left: s.cx,
                    top: 624,
                    transform: "translateX(-50%)",
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    color: "var(--wk-a1-deep)",
                    lineHeight: 1.3,
                    opacity: seen ? 1 : 0,
                    transition: `opacity 0.6s ease ${i * 0.12}s`,
                  }}
                >
                  <span style={{ fontSize: 28, fontWeight: 700 }}>{s.label}</span>
                  <br />
                  <span style={{ fontSize: 24, fontWeight: 500 }}>{s.sub}</span>
                </div>
              </div>
            ))}
          </div>

          {/* images — nodes 1:315 / 1:316 / 1:313. Three tiles, not four: the
              tall one on the right spans both rows of the left column.

              They arrive one after the other rather than together — the stagger
              lives on this parent so the order is declared once, and the tiles
              only carry the two states. `animate` is driven by the observer, so
              nothing moves until the section is actually on screen. */}
          <motion.div
            style={{ position: "absolute", inset: 0 }}
            initial="hidden"
            animate={reduceMotion || onScreen ? "shown" : "hidden"}
            variants={COLLAGE_VARIANTS}
          >
            <CanvasImage src="/workshop/community/2.jpg" x={1065} y={74} w={395} h={242} />
            <CanvasImage src="/workshop/community/3.jpg" x={1065} y={330} w={395} h={394} />
            <CanvasImage src="/workshop/community/1.jpg" x={1479} y={74} w={373} h={650} />
          </motion.div>
        </div>
      </div>

      {/* ================= stacked fallback (below lg) ================= */}
      <section
        ref={stackRef}
        className="relative w-full overflow-hidden px-4 pb-14 pt-10 lg:hidden"
      >
        <h2
          className="text-[34px] font-bold leading-[1.1] tracking-tight sm:text-[48px]"
          style={{ color: "var(--wk-text)" }}
        >
          The ABTalks AI Learners Community
        </h2>

        <p
          className="mt-5 text-[18px] font-semibold leading-[1.15] sm:text-[24px]"
          style={{ color: "var(--wk-text-dim)" }}
        >
          You&apos;re joining a fast-growing movement of builders learning AI
          together.
        </p>

        <div
          className="mt-6 space-y-3 text-[16px] font-medium leading-[1.25] sm:text-[20px]"
          style={{ color: "var(--wk-text-faint)" }}
        >
          <BodyCopy />
        </div>

        {/* Centred only while stacked in one column; once the three sit
            side by side at `sm` they go back to left-aligned, matching the
            design's own alignment. */}
        <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-3">
          {STATS.map((s) => (
            <div key={s.label} className="min-w-0 text-center sm:text-left">
              <div
                className="font-bold leading-[1.1]"
                style={{
                  fontFamily: NUM_FONT,
                  fontSize: "clamp(34px, 8vw, 64px)",
                  color: "var(--wk-text)",
                }}
              >
                {counter(s.value)}
                {s.suffix}
              </div>
              <div
                className="mt-1 text-[20px] font-bold leading-[1.3]"
                style={{ color: "var(--wk-a1-deep)" }}
              >
                {s.label}
              </div>
              <div
                className="text-[17px] font-medium leading-[1.3]"
                style={{ color: "var(--wk-a1-deep)" }}
              >
                {s.sub}
              </div>
            </div>
          ))}
        </div>

        {/* Same staggered reveal as the canvas collage, same observer. */}
        <motion.div
          className="mt-10 grid grid-cols-2 gap-4"
          initial="hidden"
          animate={reduceMotion || onScreen ? "shown" : "hidden"}
          variants={COLLAGE_VARIANTS}
        >
          <motion.div
            variants={TILE_VARIANTS}
            className="relative aspect-395/242 overflow-hidden rounded-[25px]"
          >
            <Image src="/workshop/community/2.jpg" alt="" fill sizes="45vw" className="object-cover" />
          </motion.div>
          <motion.div
            variants={TILE_VARIANTS}
            className="relative row-span-2 aspect-373/650 overflow-hidden rounded-[25px]"
          >
            <Image src="/workshop/community/1.jpg" alt="" fill sizes="45vw" className="object-cover" />
          </motion.div>
          <motion.div
            variants={TILE_VARIANTS}
            className="relative aspect-395/394 overflow-hidden rounded-[25px]"
          >
            <Image src="/workshop/community/3.jpg" alt="" fill sizes="45vw" className="object-cover" />
          </motion.div>
        </motion.div>
      </section>
    </>
  );
}

/**
 * The collage's order, declared once on the parent.
 *
 * `staggerDirection: -1` on the way out so the sequence unwinds: the last tile
 * to arrive is the first to leave. Reversing a stagger by replaying it forwards
 * looks like a second entrance running backwards, which is not the same thing.
 */
const COLLAGE_VARIANTS = {
  shown: { transition: { staggerChildren: TILE_STAGGER } },
  hidden: { transition: { staggerChildren: TILE_STAGGER, staggerDirection: -1 } },
} as const;

/** One collage tile. Fades and lifts a little; the order comes from the
 *  staggerChildren on its parent, so there are no per-tile delays to keep in
 *  sync with the list. */
const TILE_VARIANTS = {
  hidden: { opacity: 0, y: 14, transition: { duration: 0.4, ease: "easeIn" } },
  shown: { opacity: 1, y: 0, transition: { duration: 0.55, ease: "easeOut" } },
} as const;

function CanvasImage({
  src,
  x,
  y,
  w,
  h,
}: {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  return (
    <motion.div
      variants={TILE_VARIANTS}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: 25,
        overflow: "hidden",
      }}
    >
      <Image src={src} alt="" fill sizes={`${w}px`} className="object-cover" />
    </motion.div>
  );
}
