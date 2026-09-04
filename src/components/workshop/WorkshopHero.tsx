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

/** The poster's box inside the card (node 1:119). The pills are placed against
 *  its edges, so they are derived from it rather than repeated as literals. */
// x nudged from the design's 1084. Everything to the right of the poster is
// dead card, and the only thing stopping it closing further is the right-hand
// pill: it hangs off the poster's right edge and has to land inside the card,
// which caps the shift at ~20 units. See the note on BITE.
const POSTER = { x: 1098, y: 62, w: 567, h: 716 };
const POSTER_L = POSTER.x;
const POSTER_R = POSTER.x + POSTER.w;

/**
 * How far a pill is allowed to sit over the poster.
 *
 * Measured off the rendered poster: the artwork carries a cream margin of
 * ~21 units on the left and ~25 on the right before its own content starts
 * (the icon column, and the "WORKSHOP TOPICS" tile row). 14 keeps every pill
 * inside that margin, so they read as pinned to the poster's edge without
 * landing on anything printed on it.
 *
 * The design's own bite was 61 units on the left pair and 63/171 on the right,
 * which is what put "Live on Youtube" across "AI IMAGE GENERATION" and
 * "Beginner Friendly" across "AI AVATAR / DIGITAL PRESENTERS".
 */
const BITE = 14;

/**
 * Per-pill overrides, where the artwork behind that pill allows a deeper sit.
 *
 * BITE is the safe default — the width of the poster's cream margin, so no pill
 * can land on anything printed. These three go further because what is behind
 * them at their own height is not print:
 *
 *   100% Free        56  the poster's decorative circuit corner, no text at all
 *   1 Hour Live      24  the cream band left of the last topic tile, which
 *                        ends 27 units short of the poster's right edge
 *   Beginner Friendly 34 the cream band right of the poster's left icon column
 *
 * Nothing here changes a pill's size or wording; each one just sits further
 * over the poster and so further from the card's edge.
 */

/** Feature pills (nodes 1:128 / 1:132 / 1:136 / 1:157), card-relative.
 *
 *  Anchored by ONE edge and one centre line rather than by a top-left corner
 *  and a fixed width, because these pills were shrunk from the design's 72px
 *  and a corner anchor moves everything that matters when they do:
 *
 *  - `ax` is the edge that lies over the poster. Left-hand pills anchor their
 *    RIGHT edge to the poster's left edge; right-hand pills anchor their LEFT
 *    edge to its right edge. Both hang outward from there.
 *  - `cy` is the pill's centre, not its top. "Live on Youtube" is centred on
 *    the same line as the Reserve CTA (both 682 in frame coordinates); a top
 *    anchor would have broken that pairing the moment the height changed.
 *
 *  WHICH label sits on which side is geometry, not taste. A right-hand pill has
 *  to fit between the poster's edge and the card's (1844): at BITE 14 that
 *  leaves 191 units, which the two short labels clear (168 / 171) and the two
 *  long ones do not (221 / 237). So the long pair took the left, where the card
 *  is empty for 350 units. "Beginner Friendly" and "1 Hour Live" swapped sides
 *  for that reason — the alternative was covering the poster again or being
 *  clipped by the card.
 *
 *  `delay` is from the motion timeline. */
const PILLS = [
  { label: "Beginner Friendly", Icon: Sparkles, ax: POSTER_L + 34, anchorRight: true, cy: 400, delay: 0.36 },
  { label: "100% Free", Icon: Gift, ax: POSTER_R - 56, anchorRight: false, cy: 156, delay: 0.84 },
  { label: "Live on Youtube", Icon: PlayCircle, ax: POSTER_L + BITE, anchorRight: true, cy: 654, delay: 0 },
  { label: "1 Hour Live", Icon: Clock, ax: POSTER_R - 24, anchorRight: false, cy: 656, delay: 0.24 },
] as const;

/** The overshoot curve Figma authored on the pill scale track. */
const POP_EASE = [0.45, 1.45, 0.8, 1] as const;

/**
 * Primary CTA, now under the design's own 238×56 / 16px. It started at
 * 268×64 / 18px and still read as oversized against a 56px title and a 20px
 * subtitle, so it is the smallest of the three passes: 216×48 / 16px.
 *
 * No `top` any more: it is the last item in the centred column below, so its
 * position falls out of the stack rather than out of an offset that had to be
 * kept in step with everything above it.
 */
const CTA_W = 216;
const CTA_H = 48;

const ctaStyle: React.CSSProperties = {
  width: CTA_W,
  height: CTA_H,
  flexShrink: 0,
  borderRadius: 12,
  display: "flex",
  alignItems: "center",
  paddingLeft: 24,
  fontSize: 16,
  fontWeight: 700,
  color: "#ffffff",
  textDecoration: "none",
};

/**
 * The gaps in the left column, top to bottom.
 *
 * The countdown's own box carries 16 units of leading above its first digit,
 * so its gap is set 16 short of the one below it — the two then read as equal.
 */
const GAP_CHIPS_TITLE = 24;
const GAP_TITLE_DESC = 30;
const GAP_DESC_COUNT = 20;
const GAP_COUNT_CTA = 34;

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
  eventTitle,
  eventAccents,
  eventDesc,
  eventPoster,
}: {
  webinarDate: string;
  webinarTime: string;
  webinarTargetUtc: string;
  /**
   * The current workshop, resolved on the SERVER by `getRegistrableEvent`.
   *
   * It used to be found here with `EVENTS.find(e => e.register &&
   * e.registrationOpen)` — a third copy of "which event is current", on static
   * flags, so the hero stayed on a finished workshop until someone edited the
   * data file. Deriving it from the clock in this component instead would mean
   * either a hydration mismatch or a visible swap-in on the largest text on the
   * page, so the page resolves it and passes primitives (never the event: it
   * carries a LucideIcon, which cannot cross the boundary).
   */
  eventTitle: string | null;
  eventAccents: string[] | null;
  eventDesc: string | null;
  eventPoster: string | null;
}) {
  const { ref, scale } = useCanvasScale(FRAME_W);
  const desc = eventDesc ?? DEFAULT_DESC;
  const poster = eventPoster ?? undefined;

  const title = accentedTitle(
    eventTitle ?? DEFAULT_TITLE,
    eventAccents ?? DEFAULT_TITLE_ACCENTS,
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
                left: POSTER.x,
                top: POSTER.y,
                width: POSTER.w,
                height: POSTER.h,
                borderRadius: 30,
                overflow: "hidden",
              }}
            >
              {poster ? (
                <Image
                  src={poster}
                  alt={eventTitle ?? "Workshop poster"}
                  fill
                  sizes="567px"
                  className="object-cover"
                  priority
                />
              ) : (
                <div style={{ width: "100%", height: "100%", background: "var(--wk-navy-box)" }} />
              )}
            </div>

            {/*
              The left column — one centred stack, not five absolute offsets.

              Every item here used to carry its own `top` (102, 172, 324, 462,
              655), so the rhythm was arithmetic that had to be redone by hand
              whenever any one line changed length, and the block as a whole sat
              wherever those numbers left it: 102 units of card above it against
              74 below. It is now a full-height flex column with
              `justifyContent: center`, so the stack is compact by its gaps and
              the leftover card is split evenly above and below it — whatever
              number of lines the title happens to wrap to.

              The title and the CTA moved INSIDE the card to join it. They sat
              outside so the card could not clip them, but at x 86 and 134 units
              of a 1844-wide card neither was ever near an edge.
            */}
            <div
              style={{
                position: "absolute",
                left: 86,
                top: 0,
                height: CARD.h,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "flex-start",
              }}
            >
              {/* date + time chips — node 1:121.
                  One flex row rather than two separately-placed pills. Each used
                  to carry a hardcoded width (143 and 117) with an absolutely
                  positioned label inside, so the pill could not size to its own
                  text: measured, "September 05, 2026" needed 114px against 104px
                  of room and spilled 10px past the background, while the time
                  pill left 28px of empty pill trailing its text. */}
              <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                <Chip text={webinarDate} Icon={CalendarDays} />
                <Chip text={webinarTime} Icon={Clock} />
              </div>

              <h1
                style={{
                  marginTop: GAP_CHIPS_TITLE,
                  width: 639,
                  marginBottom: 0,
                  // 64 in the design. Trimmed one step: the 639px box still
                  // breaks it at the same word, so the wrap stays intentional
                  // and the title stays the largest thing on the page.
                  fontSize: 56,
                  fontWeight: 700,
                  lineHeight: 1.2,
                  letterSpacing: "-0.01em",
                  color: "#ffffff",
                }}
              >
                {title}
              </h1>

              {/* subtitle — node 1:120. 509 in the design, against a title box
                  639 wide: the copy stopped 128 units short of the column it
                  belongs to and left the card black from there to the poster.
                  620 ends the two on the same line and costs no extra line of
                  text — the string needs 2.1 lines at this width, the same 3 it
                  already wrapped to. */}
              <p
                style={{
                  marginTop: GAP_TITLE_DESC,
                  marginBottom: 0,
                  width: 620,
                  fontSize: 20,
                  fontWeight: 600,
                  lineHeight: 1.2,
                  color: "#d2d2d2",
                }}
              >
                {desc}
              </p>

              {/* countdown — node 1:140 */}
              <div style={{ marginTop: GAP_DESC_COUNT }}>
                <CountdownExact targetUtc={webinarTargetUtc} />
              </div>

              {/* Background, shadow and hover live in `.wk-cta` — a :hover rule
                  cannot be expressed inline. */}
              <div
                style={{
                  marginTop: GAP_COUNT_CTA,
                  display: "flex",
                  alignItems: "center",
                  gap: 26,
                }}
              >
                <a href="#register" className="wk-cta" style={ctaStyle}>
                  Reserve your free seat
                </a>
                <a
                  href="#curriculum"
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "#ffffff",
                    textDecoration: "none",
                  }}
                >
                  View Details
                </a>
              </div>
            </div>

            {/* feature pills — cropped by the card, as designed */}
            {PILLS.map((p) => (
              <ExactPill key={p.label} {...p} />
            ))}
          </div>

        </div>
      </div>

      {/* ================= stacked fallback (below lg) ================= */}
      <section className="w-full px-4 pt-6 lg:hidden">
        <div
          className="relative overflow-hidden rounded-[30px] px-5 py-10 min-[400px]:px-6"
          style={{ background: "var(--wk-navy)" }}
        >
          {/* One row, always. The pair is ~316px at 12px against a 264px
              content box on a 320px phone, so the type scales with the
              viewport instead of wrapping. */}
          <div className="flex flex-nowrap items-center gap-2">
            <FlowChip text={webinarDate} Icon={CalendarDays} />
            <FlowChip text={webinarTime} Icon={Clock} />
          </div>

          {/* Trimmed one step alongside the canvas title (64→56), so the
              hierarchy is the same at every width. */}
          <h1 className="mt-8 text-[30px] font-bold leading-[1.2] tracking-tight text-white sm:text-[40px]">
            {title}
          </h1>

          <p
            className="mt-5 text-[16px] font-semibold leading-[1.2] sm:text-[20px]"
            style={{ color: "#d2d2d2" }}
          >
            {desc}
          </p>

          <div className="mt-8">
            <CountdownTimer targetUtc={webinarTargetUtc} />
          </div>

          {/* One row. Measured at 390px the content box is 310px and the pair
              came to 321, so it wrapped and left "View Details" stranded on a
              line of its own. The button and the link are both a step smaller
              below 400px and the gap is 12 rather than 16, which brings the
              pair inside the box at 390 and at 360; `flex-wrap` stays as the
              fallback for anything narrower, where wrapping beats overflowing. */}
          <div className="mt-9 flex flex-wrap items-center gap-3 min-[400px]:gap-4">
            <a
              href="#register"
              className="wk-cta rounded-[12px] px-4 py-3 text-[13px] font-bold leading-[1.1] text-white min-[400px]:px-5.5 min-[400px]:py-3.5 min-[400px]:text-[14px]"
            >
              Reserve your free seat
            </a>
            <a
              href="#curriculum"
              className="text-[13px] font-bold leading-[1.1] text-white min-[400px]:text-[14px]"
            >
              View Details
            </a>
          </div>

          {poster && (
            <div className="relative mt-9 aspect-[567/716] w-full overflow-hidden rounded-[30px]">
              <Image
                src={poster}
                alt={eventTitle ?? "Workshop poster"}
                fill
                sizes="90vw"
                className="object-cover"
                priority
              />
            </div>
          )}

          {/* 2x2, trimmed to match the canvas pills (50→42 min height, 13→12px
              label, 28→24px plate). Labels still wrap to a second line rather
              than being forced onto one, which is what lets the long ones fit:
              only the widest WORD has to fit the cell (~50px against 71px at
              320px), not the whole string. Grid stretch keeps all four the same
              height. */}
          <div className="mt-6 grid grid-cols-2 gap-2">
            {PILLS.map((p) => (
              <span
                key={p.label}
                className="flex h-full min-h-10.5 w-full items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-[12px] font-semibold leading-tight text-white"
                style={{
                  background: "linear-gradient(180deg, #e05226 0%, #c9411c 100%)",
                  boxShadow: "0 4px 7px rgba(var(--wk-ink-a),0.5)",
                }}
              >
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-white"
                  aria-hidden
                >
                  <p.Icon size={14} strokeWidth={2.25} color="var(--wk-a1)" />
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

/**
 * Node 1:122 — a 30px pill carrying a 23×22 icon plate and a label.
 *
 * Sizes to its content. The design gave it a fixed width because the canvas is
 * a fixed-size composition, but the text inside is data — a month name, a time
 * — and a pill that cannot grow with it either clips the label or trails empty
 * background. Padding and a gap reproduce the design's own 9/39px offsets while
 * staying correct for "May" and for "September" alike.
 */
function Chip({
  text,
  Icon,
}: {
  text: string;
  Icon: LucideIcon;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        height: 30,
        paddingLeft: 9,
        paddingRight: 12,
        borderRadius: 8,
        background: "var(--wk-navy-chip)",
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
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
          fontSize: 12,
          lineHeight: 1.1,
          fontWeight: 500,
          color: "#ffffff",
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

/**
 * Node 1:128 — the gradient feature pill.
 *
 * Trimmed from the design's 72px / 48×41 plate / 24px label to 52 / 34×30 / 20:
 * at full size these four read as four more primary CTAs competing with
 * "Reserve your free seat", when they are supporting metadata about the same
 * workshop.
 *
 * Sizes to its content, the way `Chip` above already does. The design gave each
 * pill a hardcoded width with the plate and the label placed at absolute
 * offsets inside it, which is only correct at exactly one type size — shrinking
 * the label there leaves the trailing background behind. Padding and a gap
 * reproduce the same spacing and survive the change.
 */
function ExactPill({
  label,
  Icon,
  ax,
  anchorRight,
  cy,
  delay,
}: {
  label: string;
  Icon: LucideIcon;
  /** The edge that lies over the poster — see PILLS. */
  ax: number;
  anchorRight: boolean;
  cy: number;
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
        left: ax,
        top: cy,
        // framer-motion composes these into the same transform as the scale
        // track, so the pop still originates at the pill's own centre.
        x: anchorRight ? "-100%" : 0,
        y: "-50%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 52,
        paddingLeft: 9,
        paddingRight: 18,
        borderRadius: 9,
        background: "linear-gradient(180deg, #e05226 0%, #c9411c 100%)",
        boxShadow: "0 4px 7px rgba(var(--wk-ink-a),0.5)",
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 34,
          height: 30,
          borderRadius: 8,
          background: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={17} strokeWidth={2.25} color="var(--wk-a1)" />
      </span>
      <span
        style={{
          fontSize: 20,
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
