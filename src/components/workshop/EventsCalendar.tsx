"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type WorkshopEvent,
  eventsForMonth,
  fullDate,
  hasReplay,
  istTodayKey,
  monthLabel,
} from "@/components/workshop/events-data";
import WorkshopDetailsModal from "@/components/workshop/WorkshopDetailsModal";
import UpcomingWorkshops from "@/components/workshop/UpcomingWorkshops";
import { useCanvasScale } from "@/components/workshop/use-canvas-scale";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/**
 * Card geometry — re-authored at 900 wide for the two-column layout.
 *
 * The scaling ARCHITECTURE is unchanged: the card is still drawn once at a
 * fixed design size and fitted by `useCanvasScale`, because absolute Figma
 * positions cannot survive being re-laid-out with flexbox. Only the design
 * size moved, from 1749 to 900.
 *
 * 900 was kept when the section's outer bound widened to 1560. Raising it to
 * 1000 to fill the wider column was tried and reverted: it buys a full-width
 * card at 1920 but drops the scale at 1280 from 0.85 to 0.76, and 1280 is the
 * commoner screen. The card is capped at CARD_W and centred, so a very wide
 * viewport leaves ~47px either side of the grid inside its column — a far
 * cheaper cost than shrinking the calendar on every laptop.
 *
 * It had to move. `useCanvasScale` divides available width by this number, so
 * a 1749 canvas dropped into ~65% of the row would render at scale 0.48 — the
 * whole calendar, fonts and all, at half size. At 900 the same column scales
 * so the grid reads at its intended size instead of being shrunk to fit.
 *
 * The cells are also deliberately less wide-and-flat than the original 100/240
 * ratio. That proportion was drawn for a full-bleed 1749 card; at a seventh of
 * 852 a 35px-tall row could not hold a day number and an event bar at once.
 */
const CARD_W = 900;
const PAD = 24;
const GRID_W = CARD_W - PAD * 2; // 852
const COL_W = GRID_W / 7; // 121.714
/**
 * Row height, raised from 86 so the card carries the column rather than
 * stopping 180px short of the sidebar beside it.
 *
 * The height is not empty space: at 86 the event bar was a single truncated
 * line, and the extra room goes into a two-line bar that shows the time as
 * well as the name. A taller row with more in it reads as a calendar; a taller
 * row with the same 36px bar floating in it reads as a stretched box.
 *
 * 113 against a 121.7 column is a near-square cell — ordinary calendar
 * proportions, and the height the sidebar beside it actually needs.
 */
const ROW_H = 113;
/** Vertical rhythm, scaled from the original card's own offsets. */
const NAV_TOP = 70;
const NAV_SIZE = 34;
const WEEK_TOP = 120;
const WEEK_H = 26;
const GRID_TOP = 158;
/** Space below the grid. */
const BOTTOM_PAD = 30;
/** Card height follows the row count; no trailing all-empty row. */
const cardHeight = (rows: number) => GRID_TOP + rows * ROW_H + BOTTOM_PAD;

/** A month needs 5 or 6 rows depending on where it starts. */
const rowsFor = (lead: number, days: number) => Math.ceil((lead + days) / 7);

/**
 * Event-bar gradients, one per track (Figma nodes 1:242 / 1:247 / 1:253 /
 * 1:289 carried four distinct hues).
 *
 * The design system allows no oranges beyond #E05226 / #C9411C / #A93617 and
 * its tints, which cannot yield four distinguishable hues. So the three
 * workshop-family tracks are the SAME orange ramp at descending alpha — tints
 * of the approved colour rather than new ones — and the hackathon takes the
 * palette's charcoal so it still reads as a different kind of event.
 */
const TRACK_GRADIENT: Record<WorkshopEvent["track"], [string, string]> = {
  workshop: ["#e05226", "#c9411c"],
  challenge: ["rgba(224, 82, 38, 0.62)", "rgba(201, 65, 28, 0.62)"],
  cohort: ["rgba(224, 82, 38, 0.30)", "rgba(201, 65, 28, 0.30)"],
  hackathon: ["#4b4b4b", "#111111"],
};

/**
 * Label colour per track, chosen by measured contrast against each bar.
 * The two tinted tracks are far too light for white text — cohort sits at
 * 1.48:1 against white versus 12.8:1 against ink — so they take ink instead.
 */
const TRACK_FG: Record<WorkshopEvent["track"], string> = {
  workshop: "#ffffff",
  challenge: "#111111",
  cohort: "#111111",
  hackathon: "#ffffff",
};

/** Icon colour inside the white tile — the deep end of each track's ramp. */
const TRACK_ICON: Record<WorkshopEvent["track"], string> = {
  workshop: "#c9411c",
  challenge: "#c9411c",
  cohort: "#c9411c",
  hackathon: "#111111",
};

/**
 * Day number in a cell. Today gets a filled disc rather than just an orange
 * tint — at a glance you scan for the marker, not for a hue difference.
 *
 * Non-today numbers keep plain text metrics on purpose: giving every number
 * the disc's fixed box would re-centre them and shift the whole grid.
 */
function DayNumber({
  day,
  today,
  birthday,
  size,
  fontSize,
}: {
  day: number | null;
  today: boolean;
  birthday: boolean;
  size: number;
  fontSize: number;
}) {
  const [burst, setBurst] = useState(0);

  // Both can land on the same date. Today keeps the filled disc and the
  // birthday adds a ring around it, so neither marker is lost.
  const disc: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    width: size,
    height: size,
    borderRadius: 999,
    fontSize,
    fontWeight: 700,
    lineHeight: 1,
  };
  const markerStyle: React.CSSProperties =
        today
          ? {
              ...disc,
              background: "var(--wk-a1)",
              color: "#ffffff",
              boxShadow: birthday
                ? "0 0 0 2px var(--wk-bg-alt), 0 0 0 3.5px var(--wk-a1)"
                : "0 1px 3px rgba(var(--wk-ink-a),0.24)",
            }
          : birthday
            ? {
                ...disc,
                border: "1.5px solid var(--wk-a1)",
                color: "var(--wk-a1)",
              }
            : {
                fontSize,
                fontWeight: 600,
                lineHeight: 1,
                color: day ? "var(--wk-cell-text)" : "var(--wk-cell-muted)",
              };

  // Only the marked day is interactive; every other date stays inert text.
  if (birthday) {
    return (
      <button
        type="button"
        className="wk-bday"
        style={markerStyle}
        aria-label={`${day} January`}
        // Each click remounts the ring via its key, so the flourish replays on
        // rapid repeat clicks instead of firing only the first time.
        onClick={() => setBurst((n) => n + 1)}
      >
        {day}
        {burst > 0 && <span key={burst} className="wk-bday-ring" aria-hidden />}
      </button>
    );
  }

  return <span style={markerStyle}>{day ?? "​"}</span>;
}

interface Cursor {
  y: number;
  m: number; // 0-indexed
}

const shiftMonth = ({ y, m }: Cursor, delta: number): Cursor => {
  const next = new Date(Date.UTC(y, m + delta, 1));
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() };
};

/**
 * A quiet personal marker on 3 January, every year.
 *
 * Distinguished from "today" by FORM, not colour: today is a filled disc, this
 * is an outlined ring in the same orange. The design system allows no extra
 * hues, and an outline also reads as secondary, which is right — it must never
 * out-shout the current date. No icon, by request.
 */
const BIRTHDAY = { month: 0, day: 3 }; // month is 0-indexed: 0 = January

const isBirthdayFor = (cursor: Cursor | null, day: number | null) =>
  Boolean(cursor && day && cursor.m === BIRTHDAY.month && day === BIRTHDAY.day);

const keyFor = (y: number, m: number, day: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** Month step control (nodes 1:207 / 1:203). Defined at module scope: a
 *  component created inside the render body remounts on every render. */
function NavButton({ dir, onClick }: { dir: -1 | 1; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={dir === -1 ? "Previous month" : "Next month"}
      onClick={onClick}
      className="wk-cal-ctl flex h-full w-full items-center justify-center rounded-[10px]"
    >
      {dir === -1 ? (
        <ChevronLeft className="size-4" aria-hidden />
      ) : (
        <ChevronRight className="size-4" aria-hidden />
      )}
    </button>
  );
}

/**
 * Month-grid calendar of every ABTalks activity — workshops, the hackathon,
 * and the challenge / cohort start days. Figma node 1:192.
 *
 * Takes no props and reads EVENTS itself, so nothing crosses the Server→Client
 * boundary (events carry a LucideIcon, which cannot be serialized).
 */
export default function EventsCalendar() {
  // Resolved on the client only. This page is statically prerendered, so a
  // build-time date would freeze the calendar on whatever month shipped.
  const [todayKey, setTodayKey] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [active, setActive] = useState<WorkshopEvent | null>(null);
  /**
   * The one clock on this surface, resolved on the client and then ticking.
   *
   * Null until mounted, exactly like `todayKey` and for the same reason: the
   * page is statically prerendered, so reading the time during render would
   * bake in the build time and disagree with the client's HTML.
   *
   * It ticks because a workshop goes live and then finishes while somebody is
   * looking at the page. Without the interval the sidebar would only be
   * correct as of page load, and the acceptance criteria call that out.
   * Thirty seconds is far finer than the minute-level boundaries it drives.
   */
  const [nowMs, setNowMs] = useState<number | null>(null);
  /**
   * Whether the two-column layout is actually on screen.
   *
   * Containment only buys something when there is a sidebar beside the modal
   * to keep readable. Below `xl` the columns are stacked, so a contained
   * overlay would be boxed into the calendar card and nothing else — measured
   * at 390px that is a 633px panel inside a 396px scrollport, which is worse
   * than the page-level overlay this page already had. So below xl it keeps
   * the original behaviour.
   *
   * Safe to start false: the modal only exists after a click, long after
   * hydration, so this never renders differently on server and client.
   */
  const [twoColumn, setTwoColumn] = useState(false);

  const { ref: canvasRef, scale, height: canvasBoxH } = useCanvasScale(CARD_W);

  // Focus goes back to the tile that opened the modal, not to <body>.
  const triggerRef = useRef<HTMLElement | null>(null);

  const seedCursor = useCallback(() => {
    const key = istTodayKey();
    setTodayKey(key);
    const [y, m] = key.split("-").map(Number);
    setCursor({ y: y!, m: m! - 1 });
  }, []);

  useEffect(() => {
    seedCursor();
    setNowMs(Date.now());
    const id = setInterval(() => {
      setNowMs(Date.now());
      // The IST day can roll over while the page is open too.
      setTodayKey(istTodayKey());
    }, 30_000);
    return () => clearInterval(id);
  }, [seedCursor]);

  // Tracks the same 1280px boundary the grid uses. Kept in JS rather than CSS
  // because it also decides whether to lock body scroll, which no media query
  // can express.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const sync = () => setTwoColumn(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const byDate = useMemo(
    () => (cursor ? eventsForMonth(cursor.y, cursor.m) : new Map<string, WorkshopEvent[]>()),
    [cursor],
  );

  const closeModal = useCallback(() => {
    setActive(null);
    triggerRef.current?.focus();
    triggerRef.current = null;
  }, []);

  const openModal = (ev: WorkshopEvent, el: HTMLElement) => {
    triggerRef.current = el;
    setActive(ev);
  };

  const { cells, rows } = useMemo(() => {
    if (!cursor) return { cells: Array<number | null>(35).fill(null), rows: 5 };
    const lead = new Date(Date.UTC(cursor.y, cursor.m, 1)).getUTCDay();
    const days = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
    const r = rowsFor(lead, days);
    const out: (number | null)[] = Array<number | null>(lead).fill(null);
    for (let d = 1; d <= days; d += 1) out.push(d);
    while (out.length < r * 7) out.push(null);
    return { cells: out, rows: r };
  }, [cursor]);

  const CARD_H = cardHeight(rows);

  const eventsOn = (day: number | null) => {
    if (!cursor || !day) return [];
    return byDate.get(keyFor(cursor.y, cursor.m, day)) ?? [];
  };
  const isToday = (day: number | null) =>
    Boolean(cursor && day && todayKey && keyFor(cursor.y, cursor.m, day) === todayKey);

  const step = (delta: number) => () =>
    setCursor((c) => (c ? shiftMonth(c, delta) : c));

  const jumpToToday = seedCursor;

  // Design section is 1920×981 with no gap to its neighbours: heading at top
  // 50, card at 163, 63 below the card. Those offsets hold at lg and up and
  // relax on small screens.
  //
  // The side inset is a percentage, not `px-0` + a max width: the design puts
  // the card 84 in from the left and 87 from the right of 1920, i.e. ~4.4% a
  // side. A fixed max width alone would only produce that margin above
  // ~1920px wide and let the card run edge to edge on every laptop.
  return (
    <section
      className="w-full px-4 pb-14 pt-10 lg:px-8 lg:pb-[63px] lg:pt-[50px] xl:px-10"
      style={{ background: "var(--wk-bg-alt)" }}
    >
      {/* A section heading, not a second hero. At 64px it out-weighed the
          calendar underneath it, which is the element this section is about. */}
      <h2
        className="mb-8 text-center text-[30px] font-bold leading-[1.1] tracking-tight sm:text-[38px] lg:mb-9 lg:text-[50px]"
        style={{ color: "var(--wk-text)" }}
      >
        Events and Workshops
      </h2>

      {/* ============ two columns from xl, stacked below ============
          `xl` and not `lg`: between 1024 and 1279 the calendar column would be
          under ~700px, which pushes the canvas scale below 0.8 and starts
          costing legibility. There the card keeps the full width and the
          sidebar sits underneath it.

          The outer max-width keeps the split honest on a wide screen: without
          it the 1.85fr column grows past the card's own width and the calendar
          floats in its own dead space. It is paired with CARD_W — raise one
          and the other has to follow, or the card stops filling its column. */}
      <div className="mx-auto w-full max-w-[1560px]">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.85fr)_minmax(300px,1fr)] xl:gap-7">
          {/* The positioned ancestor the contained details modal resolves
              against. This is the whole containment mechanism — the modal was
              already rendered inside this subtree and never used a portal. */}
          <div className="relative flex min-w-0 flex-col">

      {/* ================= exact canvas (lg and up) ================= */}
      {/*
        `flex-1` + a measured `minHeight` instead of a fixed aspect ratio.

        The canvas scales with the column; the sidebar's cards do not. So the
        two can only agree on one width, and at 1280 the card came out 109px
        short of the column beside it. Growing into the leftover space closes
        that at every width, while `minHeight` guarantees the card is never
        smaller than the grid it has to draw.

        The height comes from `scale` rather than `aspectRatio` because the two
        cannot both drive the box — and `scale` is already measured for us.
      */}
      <div
        ref={canvasRef}
        className="relative mx-auto hidden w-full flex-1 overflow-hidden rounded-[32px] lg:block"
        style={
          {
            maxWidth: CARD_W,
            minHeight: Math.round(CARD_H * scale),
            background: "var(--wk-card-bg)",
            boxShadow: "var(--wk-shadow)",
            "--wk-scale": scale,
          } as React.CSSProperties
        }
      >
        {/* Centred, not pinned. The card is allowed to grow to the row height
            (see `flex-1` above); dropping the slack entirely below the grid
            looked like a box someone forgot to finish, so it is split evenly
            above and below instead. */}
        <div
          style={{
            position: "absolute",
            top: Math.max(0, Math.round((canvasBoxH - CARD_H * scale) / 2)),
            left: 0,
            width: CARD_W,
            height: CARD_H,
            transformOrigin: "top left",
            transform: "scale(var(--wk-scale, 1))",
          }}
        >
          {/* ---------- month nav (nodes 1:207 / 1:210 / 1:203) ----------
              One flex group, not three absolutely-positioned elements.

              Each used to carry its own `left`: 24, 70 and 246. The title's
              width is the month name's, so only the LEFT gap was stable —
              measured, the right gap swung from 11px on "September 2026" to
              40px on "October 2026", because the next arrow stayed pinned at
              246 whatever the title did.

              The group is still absolutely placed (the card is a fixed canvas),
              but inside it the three children are laid out by one `gap`, so
              both sides are equal for every month name. */}
          <div
            style={{
              position: "absolute",
              left: PAD,
              top: NAV_TOP,
              height: NAV_SIZE,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ width: NAV_SIZE, height: NAV_SIZE, display: "grid" }}>
              <NavButton dir={-1} onClick={step(-1)} />
            </div>

            <h3
              style={{
                margin: 0,
                display: "flex",
                alignItems: "center",
                fontSize: 21,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                whiteSpace: "nowrap",
                color: "var(--wk-heading)",
              }}
              aria-live="polite"
            >
              {cursor ? monthLabel(cursor.y, cursor.m) : " "}
            </h3>

            <div style={{ width: NAV_SIZE, height: NAV_SIZE, display: "grid" }}>
              <NavButton dir={1} onClick={step(1)} />
            </div>
          </div>

          {/* Jumps back to the current month — the one control the reference
              design has that this card did not. Cheap: it re-runs the same
              cursor seed the mount effect uses. */}
          <button
            type="button"
            onClick={jumpToToday}
            className="wk-cal-ctl"
            style={{
              position: "absolute",
              right: PAD,
              top: NAV_TOP,
              height: NAV_SIZE,
              paddingInline: 16,
              borderRadius: 10,
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            Today
          </button>

          {/* ---------- weekday header (node 1:211) ---------- */}
          <div
            style={{
              position: "absolute",
              left: PAD,
              top: WEEK_TOP,
              width: GRID_W,
              height: WEEK_H,
              display: "grid",
              gridTemplateColumns: `repeat(7, ${COL_W}px)`,
            }}
          >
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--wk-muted)",
                }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* ---------- grid (node 1:226) ---------- */}
          <div
            style={{
              position: "absolute",
              left: PAD,
              top: GRID_TOP,
              width: GRID_W,
              display: "grid",
              gridTemplateColumns: `repeat(7, ${COL_W}px)`,
              borderRadius: 16,
              overflow: "hidden",
              borderTop: "1px solid var(--wk-grid-line)",
              borderLeft: "1px solid var(--wk-grid-line)",
            }}
          >
            {cells.map((day, i) => (
              <div
                key={i}
                style={{
                  height: ROW_H,
                  padding: 7,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 6,
                  borderRight: "1px solid var(--wk-grid-line)",
                  borderBottom: "1px solid var(--wk-grid-line)",
                  background: isToday(day) ? "rgba(var(--wk-a1-rgb),0.06)" : undefined,
                }}
              >
                <DayNumber
                  day={day}
                  today={isToday(day)}
                  birthday={isBirthdayFor(cursor, day)}
                  size={22}
                  fontSize={13}
                />

                {eventsOn(day).map((ev) => (
                  <EventBar key={ev.id} event={ev} todayKey={todayKey} onOpen={openModal} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ================= compact grid (below lg) =================
          The design's 240×100 cell cannot survive a phone width — scaled down
          it would put the 16px day number at ~4px. Same data, compact cells. */}
      <div
        className="mx-auto w-full rounded-[24px] p-4 lg:hidden"
        style={{ background: "var(--wk-card-bg)", boxShadow: "var(--wk-shadow)" }}
      >
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 shrink-0"><NavButton dir={-1} onClick={step(-1)} /></div>
          {/* nowrap: at 390px "September 2026" otherwise breaks across two
              lines and shoves the next-month button out of the row. */}
          <h3
            className="whitespace-nowrap text-[17px] font-bold tracking-tight"
            style={{ color: "var(--wk-heading)" }}
            aria-live="polite"
          >
            {cursor ? monthLabel(cursor.y, cursor.m) : " "}
          </h3>
          <div className="grid size-9 shrink-0"><NavButton dir={1} onClick={step(1)} /></div>
          {/* The canvas has this control; the compact grid needs it more,
              since paging on a phone is where you most easily lose your place. */}
          <button
            type="button"
            onClick={jumpToToday}
            className="wk-cal-ctl ml-auto rounded-[10px] px-3 py-1.5 text-[12px] font-semibold"
          >
            Today
          </button>
        </div>

        <div className="mt-4 grid grid-cols-7">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="py-1.5 text-center text-[11px] font-semibold"
              style={{ color: "var(--wk-muted)" }}
            >
              {d}
            </div>
          ))}
        </div>

        <div
          className="mt-1 grid grid-cols-7 overflow-hidden rounded-[12px]"
          style={{
            borderTop: "1px solid var(--wk-grid-line)",
            borderLeft: "1px solid var(--wk-grid-line)",
          }}
        >
          {cells.map((day, i) => (
            <div
              key={i}
              className="flex flex-col items-start gap-1 p-1"
              style={{
                aspectRatio: "1 / 1",
                borderRight: "1px solid var(--wk-grid-line)",
                borderBottom: "1px solid var(--wk-grid-line)",
                background: isToday(day) ? "rgba(var(--wk-a1-rgb),0.06)" : undefined,
              }}
            >
              <DayNumber
                day={day}
                today={isToday(day)}
                birthday={isBirthdayFor(cursor, day)}
                size={16}
                fontSize={10}
              />
              {eventsOn(day).map((ev) => (
                <EventBar
                  key={ev.id}
                  event={ev}
                  todayKey={todayKey}
                  onOpen={openModal}
                  compact
                />
              ))}
            </div>
          ))}
        </div>
      </div>

            {/* Contained only while the sidebar is actually beside it — see
                `twoColumn`. Stacked, it falls back to the page-level overlay
                this modal has always used. */}
            <WorkshopDetailsModal
              event={active}
              onClose={closeModal}
              contained={twoColumn}
            />
          </div>

          <UpcomingWorkshops nowMs={nowMs} />
        </div>
      </div>
    </section>
  );
}

/**
 * One event bar inside a day cell (Figma node 1:242) — a 56px rounded bar
 * carrying only the 57×50 thumbnail. Renders as a <button> when it opens the
 * replay modal, an <a> when it navigates, and an inert <span> otherwise —
 * never a div with a click handler.
 */
function EventBar({
  event,
  todayKey,
  onOpen,
  compact = false,
}: {
  event: WorkshopEvent;
  todayKey: string | null;
  onOpen: (ev: WorkshopEvent, el: HTMLElement) => void;
  compact?: boolean;
}) {
  const Icon = event.Icon;
  const label = `${event.title} — ${fullDate(event.date)}`;
  const [from, to] = TRACK_GRADIENT[event.track];

  const barStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    width: "100%",
    flexShrink: 0,
    overflow: "hidden",
    textAlign: "left",
    height: compact ? 18 : 50,
    borderRadius: compact ? 6 : 12,
    paddingLeft: compact ? 2 : 4,
    paddingRight: compact ? 2 : 5,
    ...(event.placeholder
      ? {
          background: "var(--wk-chip)",
          border: "1px dashed var(--wk-card-border)",
        }
      : { background: `linear-gradient(180deg, ${from}, ${to})` }),
  };

  /**
   * The poster's own visual language: a white rounded tile with the subject
   * drawn inside it. Reusing that here means the calendar rhymes with the
   * artwork, the icon actually says what kind of event it is, and no stock
   * photography is involved.
   */
  const thumbnail = (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        width: compact ? 14 : 24,
        height: compact ? 14 : 24,
        borderRadius: compact ? 4 : 7,
        background: event.placeholder ? "var(--wk-chip-strong)" : "#ffffff",
        // A hairline so the white tile still reads against the palest track,
        // where a plain white plate would dissolve into the bar.
        border: "1px solid rgba(var(--wk-ink-a),0.08)",
        boxShadow: "0 1px 2px rgba(var(--wk-ink-a),0.10)",
      }}
    >
      <Icon
        size={compact ? 9 : 13}
        strokeWidth={1.9}
        style={{
          color: event.placeholder ? "var(--wk-muted)" : TRACK_ICON[event.track],
        }}
        aria-hidden
      />
    </span>
  );

  // A calendar cell is only ~1/7 of the card wide, so the name always
  // truncates rather than wrapping the bar onto two lines. The full title
  // stays on the element's aria-label.
  const fg = event.placeholder ? "var(--wk-muted)" : TRACK_FG[event.track];
  const name = compact ? null : (
    <span
      style={{
        marginLeft: 6,
        minWidth: 0,
        flex: 1,
        color: fg,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 1,
      }}
    >
      {/*
        Two lines, not one. A cell is a seventh of 852px, so a single nowrap
        line left ~65px for text and every title collapsed to "AI Imag…",
        which names nothing. Wrapping to two clamped lines fits ~30 characters
        — enough that the shortest titles show in full and the longest still
        say what they are.
      */}
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          lineHeight: 1.22,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {event.placeholder ? "Workshop — TBA" : event.title}
      </span>
      {/* The time is the second thing you want off a calendar tile, and the
          taller row finally has room for it. */}
      <span
        style={{
          fontSize: 9,
          fontWeight: 500,
          lineHeight: 1.2,
          opacity: 0.85,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {event.time}
      </span>
    </span>
  );

  const inner = (
    <>
      {thumbnail}
      {name}
    </>
  );

  // Only the three interactive branches below take this. A finished placeholder
  // renders an inert <span> and deliberately does not, so the glow never
  // promises a click that does nothing.
  const interactive = "wk-event-bar cursor-pointer";

  // Any finished real workshop → details modal (with or without a recording).
  if (todayKey && hasReplay(event, todayKey)) {
    return (
      <button
        type="button"
        aria-label={`${label} — view details`}
        onClick={(e) => onOpen(event, e.currentTarget)}
        className={`wk-event-tile ${interactive}`}
        style={barStyle}
      >
        {inner}
      </button>
    );
  }

  // Anything with its own destination — hackathon, cohort, challenge.
  if (event.href) {
    const external = event.href.startsWith("http");
    return (
      <a
        href={event.href}
        aria-label={label}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className={`wk-event-tile ${interactive}`}
        style={barStyle}
      >
        {inner}
      </a>
    );
  }

  // Upcoming workshop (real or placeholder) → the registration form.
  if (!todayKey || event.date >= todayKey) {
    return (
      <a
        href="#register"
        aria-label={`${label} — register`}
        className={`wk-event-tile ${interactive}`}
        style={barStyle}
      >
        {inner}
      </a>
    );
  }

  // A Saturday placeholder whose date has since passed — nothing to open.
  return (
    <span className="wk-event-tile" style={{ ...barStyle, opacity: 0.75 }} title={label}>
      {inner}
    </span>
  );
}
