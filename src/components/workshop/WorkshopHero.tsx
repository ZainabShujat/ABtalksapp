"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import {
  CalendarDays,
  Clock,
  Gift,
  Sparkles,
  PlayCircle,
  type LucideIcon,
} from "lucide-react";
import { EVENTS } from "@/components/workshop/events-data";
import CountdownTimer, { CountdownExact } from "@/components/workshop/CountdownTimer";
import { useCanvasScale } from "@/components/workshop/use-canvas-scale";

/**
 * Hero — Figma node 1:117, an absolutely-positioned composition on a
 * 1920×806 frame. Rendered on that exact canvas and scaled to fit, rather
 * than re-laid-out with flexbox: the design depends on precise positions,
 * and the poster is deliberately CLIPPED by the card's bottom edge
 * (top 62 + height 716 = 778 against a 749-tall card).
 *
 * The card stays dark in both themes — that is the design, not a dark-mode
 * artefact. Below `lg` the canvas would be illegibly small, so the same
 * content reflows into a stacked layout.
 */

const FRAME_W = 1920;
const FRAME_H = 806;

/** Card (node 1:118), positioned within the frame. */
const CARD = { x: 48, y: 28, w: 1844, h: 749 };

/** Feature pills (nodes 1:128 / 1:132 / 1:136 / 1:157), card-relative.
 *  `plate` and `tx` are the inner offsets Figma gives each one.
 *  `delay` is from the motion timeline. */
const PILLS = [
  { label: "1 Hour Live", Icon: Clock, x: 877, y: 364, w: 268, plate: 18, tx: 91, delay: 0.24 },
  { label: "100% Free", Icon: Gift, x: 1588, y: 120, w: 235, plate: 18, tx: 95, delay: 0.84 },
  { label: "Live on Youtube", Icon: PlayCircle, x: 807, y: 618, w: 338, plate: 35, tx: 110, delay: 0 },
  { label: "Beginner Friendly", Icon: Sparkles, x: 1480, y: 620, w: 325, plate: 23, tx: 97, delay: 0.36 },
] as const;

/** The overshoot curve Figma authored on the pill scale track. */
const POP_EASE = [0.45, 1.45, 0.8, 1] as const;

/**
 * Primary CTA, a little larger than the design's 238×56 / 16px. Height grows
 * around the original centre line (654 + 56/2) so the button stays vertically
 * aligned with the "View Details" link next to it.
 */
const CTA_W = 268;
const CTA_H = 64;
const CTA_TOP = 654 + 56 / 2 - CTA_H / 2;

const ctaStyle: React.CSSProperties = {
  position: "absolute",
  left: 137,
  top: CTA_TOP,
  width: CTA_W,
  height: CTA_H,
  borderRadius: 12,
  display: "flex",
  alignItems: "center",
  paddingLeft: 34,
  fontSize: 18,
  fontWeight: 700,
  color: "#ffffff",
  textDecoration: "none",
};

const DEFAULT_DESC =
  "Turn one idea into a week of content — generate scroll-stopping posts, carousels and short-form videos with AI, then edit and schedule them in minutes.";

const DEFAULT_TITLE = "Create Anything with AI: From Prompt to Published Content";
const DEFAULT_TITLE_ACCENTS = ["AI", "Published Content"];

/**
 * Renders `title` with each substring in `accents` in the accent colour.
 *
 * Kept as a plain string + accent list on the event so a weekly swap is a
 * one-line data edit — JSX in `events-data.ts` would make that module
 * client-only for a second reason and put markup in a data file.
 */
function accentedTitle(title: string, accents: string[]) {
  const parts: React.ReactNode[] = [];
  let rest = title;
  let key = 0;

  for (const accent of accents) {
    const at = rest.indexOf(accent);
    if (at === -1) continue; // accent not present — leave the text plain
    if (at > 0) parts.push(rest.slice(0, at));
    parts.push(
      <span key={key++} style={{ color: "var(--wk-a3)" }}>
        {accent}
      </span>,
    );
    rest = rest.slice(at + accent.length);
  }
  if (rest) parts.push(rest);

  return <>{parts}</>;
}

export default function WorkshopHero({
  webinarDate,
  webinarTime,
  webinarTargetUtc,
}: {
  webinarDate: string;
  webinarTime: string;
  webinarTargetUtc: string;
}) {
  const event = EVENTS.find((e) => e.register && e.registrationOpen);
  const { ref, scale } = useCanvasScale(FRAME_W);
  const desc = event?.desc ?? DEFAULT_DESC;
  const poster = event?.posterSrc;

  const title = accentedTitle(
    event?.title ?? DEFAULT_TITLE,
    event?.titleAccents ?? DEFAULT_TITLE_ACCENTS,
  );

  return (
    <>
      {/* ================= exact canvas (lg and up) ================= */}
      <div
        ref={ref}
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
          {/* ---- navy card (clips the poster) ---- */}
          <div
            style={{
              position: "absolute",
              left: CARD.x,
              top: CARD.y,
              width: CARD.w,
              height: CARD.h,
              borderRadius: 30,
              overflow: "hidden",
              background: "var(--wk-navy)",
            }}
          >
            {/* poster — node 1:119 */}
            <div
              style={{
                position: "absolute",
                left: 1084,
                top: 62,
                width: 567,
                height: 716,
                borderRadius: 30,
                overflow: "hidden",
              }}
            >
              {poster ? (
                <Image
                  src={poster}
                  alt={event?.title ?? "Workshop poster"}
                  fill
                  sizes="567px"
                  className="object-cover"
                  priority
                />
              ) : (
                <div style={{ width: "100%", height: "100%", background: "var(--wk-navy-box)" }} />
              )}
            </div>

            {/* date + time chips — node 1:121 */}
            <Chip x={86} y={102} w={143} text={webinarDate} Icon={CalendarDays} />
            <Chip x={242} y={102} w={117} text={webinarTime} Icon={Clock} />

            {/* subtitle — node 1:120 */}
            <p
              style={{
                position: "absolute",
                left: 88,
                top: 389,
                width: 509,
                margin: 0,
                fontSize: 20,
                fontWeight: 600,
                lineHeight: 1.2,
                color: "#d2d2d2",
              }}
            >
              {desc}
            </p>

            {/* countdown — node 1:140 */}
            <div style={{ position: "absolute", left: 88, top: 492 }}>
              <CountdownExact targetUtc={webinarTargetUtc} />
            </div>

            {/* feature pills — cropped by the card, as designed */}
            {PILLS.map((p) => (
              <ExactPill key={p.label} {...p} />
            ))}
          </div>

          {/* ---- title and actions sit OUTSIDE the card in the layer tree,
                  so they are never clipped by it ---- */}
          <h1
            style={{
              position: "absolute",
              left: 134,
              top: 172,
              width: 639,
              margin: 0,
              fontSize: 64,
              fontWeight: 700,
              lineHeight: 1.2,
              letterSpacing: "-0.01em",
              color: "#ffffff",
            }}
          >
            {title}
          </h1>

          {/* Nudged up from the design's 238×56 / 16px and centred on the
              same axis, so the taller button still lines up with "View
              Details" beside it. Background, shadow and hover live in
              `.wk-cta` — a :hover rule cannot be expressed inline. */}
          <a href="#register" className="wk-cta" style={ctaStyle}>
            Reserve your free seat
          </a>
          <a
            href="#curriculum"
            style={{
              position: "absolute",
              left: 400,
              top: CTA_TOP,
              width: 146,
              height: CTA_H,
              display: "flex",
              alignItems: "center",
              paddingLeft: 24,
              fontSize: 16,
              fontWeight: 700,
              color: "#ffffff",
              textDecoration: "none",
            }}
          >
            View Details
          </a>
        </div>
      </div>

      {/* ================= stacked fallback (below lg) ================= */}
      <section className="w-full px-4 pt-6 lg:hidden">
        <div
          className="relative overflow-hidden rounded-[30px] px-6 py-10"
          style={{ background: "var(--wk-navy)" }}
        >
          {/* One row, always. The pair is ~316px at 12px against a 264px
              content box on a 320px phone, so the type scales with the
              viewport instead of wrapping. */}
          <div className="flex flex-nowrap items-center gap-2">
            <FlowChip text={webinarDate} Icon={CalendarDays} />
            <FlowChip text={webinarTime} Icon={Clock} />
          </div>

          <h1 className="mt-8 text-[34px] font-bold leading-[1.2] tracking-tight text-white sm:text-[46px]">
            {title}
          </h1>

          <p
            className="mt-6 text-[16px] font-semibold leading-[1.2] sm:text-[20px]"
            style={{ color: "#d2d2d2" }}
          >
            {desc}
          </p>

          <div className="mt-8">
            <CountdownTimer targetUtc={webinarTargetUtc} />
          </div>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <a
              href="#register"
              className="wk-cta rounded-[12px] px-[34px] py-[21px] text-[17px] font-bold leading-[1.1] text-white"
            >
              Reserve your free seat
            </a>
            <a
              href="#curriculum"
              className="text-[16px] font-bold leading-[1.1] text-white"
            >
              View Details
            </a>
          </div>

          {poster && (
            <div className="relative mt-9 aspect-[567/716] w-full overflow-hidden rounded-[30px]">
              <Image
                src={poster}
                alt={event?.title ?? "Workshop poster"}
                fill
                sizes="90vw"
                className="object-cover"
                priority
              />
            </div>
          )}

          {/* 2x2. Labels wrap to a second line rather than being forced onto
              one, which is what lets the long ones fit: only the widest WORD
              has to fit the cell (~54px against 67px at 320px), not the whole
              string. Grid stretch keeps all four the same height. */}
          <div className="mt-6 grid grid-cols-2 gap-2.5">
            {PILLS.map((p) => (
              <span
                key={p.label}
                className="flex h-full min-h-[50px] w-full items-center gap-2 rounded-[10px] px-3 py-2 text-[13px] font-semibold leading-tight text-white"
                style={{
                  background: "linear-gradient(180deg, #e05226 0%, #c9411c 100%)",
                  boxShadow: "0 4px 7px rgba(var(--wk-ink-a),0.5)",
                }}
              >
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-white"
                  aria-hidden
                >
                  <p.Icon size={16} strokeWidth={2.25} color="var(--wk-a1)" />
                </span>
                {p.label}
              </span>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

/** Node 1:122 — 30px pill, 23×22 plate at x9, label at x39. */
function Chip({
  x,
  y,
  w,
  text,
  Icon,
}: {
  x: number;
  y: number;
  w: number;
  text: string;
  Icon: LucideIcon;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: 30,
        borderRadius: 8,
        background: "var(--wk-navy-chip)",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 9,
          top: 4,
          width: 23,
          height: 22,
          borderRadius: 10,
          background: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={14} strokeWidth={2.25} color="var(--wk-a1)" />
      </span>
      <span
        style={{
          position: "absolute",
          left: 39,
          top: 8,
          fontSize: 12,
          lineHeight: 1.1,
          fontWeight: 500,
          color: "#ffffff",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </span>
    </div>
  );
}

function FlowChip({ text, Icon }: { text: string; Icon: LucideIcon }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] py-[6px] pl-[7px] pr-2.5 text-[clamp(10px,3.1vw,12px)] font-medium text-white"
      style={{ background: "var(--wk-navy-chip)" }}
    >
      <span
        className="flex size-[19px] shrink-0 items-center justify-center rounded-[7px] bg-white"
        aria-hidden
      >
        <Icon size={12} strokeWidth={2.25} color="var(--wk-a1)" />
      </span>
      {text}
    </span>
  );
}

/** Node 1:128 — 72px gradient pill, 48×41 plate, 24px label. */
function ExactPill({
  label,
  Icon,
  x,
  y,
  w,
  plate,
  tx,
  delay,
}: {
  label: string;
  Icon: LucideIcon;
  x: number;
  y: number;
  w: number;
  plate: number;
  tx: number;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{
        scale: { duration: 0.35, delay, ease: POP_EASE },
        opacity: { duration: 0.2, delay, ease: "easeOut" },
      }}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: 72,
        borderRadius: 10,
        background: "linear-gradient(180deg, #e05226 0%, #c9411c 100%)",
        boxShadow: "0 4px 7px rgba(var(--wk-ink-a),0.5)",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: plate,
          top: 15,
          width: 48,
          height: 41,
          borderRadius: 10,
          background: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={24} strokeWidth={2.25} color="var(--wk-a1)" />
      </span>
      <span
        style={{
          position: "absolute",
          left: tx,
          top: 23,
          fontSize: 24,
          lineHeight: 1.1,
          fontWeight: 600,
          color: "#ffffff",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </motion.div>
  );
}
