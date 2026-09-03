"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCanvasScale } from "@/components/workshop/use-canvas-scale";

/**
 * Community section — Figma node 1:311, an absolutely-positioned composition
 * on a 1920×818 frame, rendered on that canvas and scaled to fit.
 *
 * Below `lg` the canvas would be illegibly small, so the same content reflows
 * into a stacked layout.
 */

const FRAME_W = 1920;
const FRAME_H = 818;

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

function useInView(threshold = 0.3) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function CountUp({ target, run, duration = 1800 }: { target: number; run: boolean; duration?: number }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setVal(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, target, duration]);
  return <>{val.toLocaleString()}</>;
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
  const { ref: countersRef, visible: countersVisible } = useInView(0.35);

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
              at full strength it reads as a solid band rather than a wash. */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: -296,
              top: -289,
              width: 2519,
              height: 746,
              opacity: 0.34,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/workshop/community/band.svg"
              alt=""
              style={{ display: "block", width: "100%", height: "100%" }}
            />
          </div>

          {/* heading — node 1:317 */}
          <h2
            style={{
              position: "absolute",
              left: 123,
              top: 111,
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
              top: 276,
              width: 681,
              margin: 0,
              fontSize: 36,
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
              top: 405,
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
          <div ref={countersRef} style={{ position: "absolute", inset: 0 }}>
            {STATS.map((s, i) => (
              <div key={s.label}>
                <div
                  style={{
                    position: "absolute",
                    left: s.x,
                    top: 596,
                    fontFamily: NUM_FONT,
                    fontSize: 64,
                    fontWeight: 700,
                    lineHeight: 1.1,
                    whiteSpace: "nowrap",
                    color: "var(--wk-text)",
                    opacity: countersVisible ? 1 : 0,
                    transition: `opacity 0.6s ease ${i * 0.12}s`,
                  }}
                >
                  <CountUp target={s.value} run={countersVisible} />
                  {s.suffix}
                </div>

                <div
                  style={{
                    position: "absolute",
                    left: s.cx,
                    top: 677,
                    transform: "translateX(-50%)",
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    color: "var(--wk-a1-deep)",
                    lineHeight: 1.3,
                    opacity: countersVisible ? 1 : 0,
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

          {/* images — nodes 1:315 / 1:316 / 1:313 */}
          <CanvasImage src="/workshop/community/2.jpg" x={1065} y={111} w={395} h={242} />
          <CanvasImage src="/workshop/community/3.jpg" x={1065} y={367} w={395} h={394} />
          <CanvasImage src="/workshop/community/1.jpg" x={1479} y={111} w={373} h={650} />
        </div>
      </div>

      {/* ================= stacked fallback (below lg) ================= */}
      <section
        className="relative w-full overflow-hidden px-4 py-14 lg:hidden"
      >
        <h2
          className="text-[34px] font-bold leading-[1.1] tracking-tight sm:text-[48px]"
          style={{ color: "var(--wk-text)" }}
        >
          The ABTalks AI Learners Community
        </h2>

        <p
          className="mt-6 text-[22px] font-semibold leading-[1.1] sm:text-[30px]"
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
                <CountUp target={s.value} run />
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

        <div className="mt-10 grid grid-cols-2 gap-4">
          <div className="relative aspect-[395/242] overflow-hidden rounded-[25px]">
            <Image src="/workshop/community/2.jpg" alt="" fill sizes="45vw" className="object-cover" />
          </div>
          <div className="relative row-span-2 aspect-[373/650] overflow-hidden rounded-[25px]">
            <Image src="/workshop/community/1.jpg" alt="" fill sizes="45vw" className="object-cover" />
          </div>
          <div className="relative aspect-[395/394] overflow-hidden rounded-[25px]">
            <Image src="/workshop/community/3.jpg" alt="" fill sizes="45vw" className="object-cover" />
          </div>
        </div>
      </section>
    </>
  );
}

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
    <div
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
    </div>
  );
}
