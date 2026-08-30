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
import { useCanvasScale } from "@/components/workshop/use-canvas-scale";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/**
 * Card geometry, Figma node 1:194 — a 1749-wide card with 32px padding, so a
 * 1685-wide grid of seven 240.714px columns and 100px rows.
 *
 * These are ratios, not just sizes: a 100px row against a 240.714px column is
 * what gives the design its wide, flat cells. Holding the row at a fixed 100px
 * while the columns flex would distort that at every width except 1749, so the
 * whole card is rendered at design size and scaled, exactly like the hero.
 */
const CARD_W = 1749;
const PAD = 32;
const GRID_W = CARD_W - PAD * 2; // 1685
const COL_W = GRID_W / 7; // 240.714
const ROW_H = 100;
/**
 * Vertical offsets are the design's own (nodes 1:207 / 1:211 / 1:226), kept
 * even though the Day/Week/Month control that used to sit above the nav is
 * gone: the card's proportions come from these, not from closing the gap the
 * tabs left behind.
 */
const NAV_TOP = 95;
const NAV_SIZE = 40;
const WEEK_TOP = 155;
const WEEK_H = 33;
const GRID_TOP = 212;
/** Space below the grid — 755 - 212 - 500 on the design's own five-row card. */
const BOTTOM_PAD = 43;
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
      className="flex h-full w-full items-center justify-center rounded-[12px] transition-opacity hover:opacity-70"
      style={{ background: "var(--wk-chip)", color: "var(--wk-muted)" }}
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

  const { ref: canvasRef, scale } = useCanvasScale(CARD_W);

  // Focus goes back to the tile that opened the modal, not to <body>.
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const key = istTodayKey();
    setTodayKey(key);
    const [y, m] = key.split("-").map(Number);
    setCursor({ y: y!, m: m! - 1 });
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
      className="w-full px-4 pb-14 pt-10 lg:px-[4.4%] lg:pb-[63px] lg:pt-[50px]"
      style={{ background: "var(--wk-bg-alt)" }}
    >
      <h2
        className="mb-10 text-center text-[34px] font-bold leading-[1.1] tracking-tight sm:text-[48px] lg:mb-[43px] lg:text-[64px]"
        style={{ color: "var(--wk-text)" }}
      >
        Events and Workshops
      </h2>

      {/* ================= exact canvas (lg and up) ================= */}
      <div
        ref={canvasRef}
        className="relative mx-auto hidden w-full overflow-hidden rounded-[32px] lg:block"
        style={
          {
            maxWidth: CARD_W,
            aspectRatio: `${CARD_W} / ${CARD_H}`,
            background: "var(--wk-card-bg)",
            boxShadow: "var(--wk-shadow)",
            "--wk-scale": scale,
          } as React.CSSProperties
        }
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: CARD_W,
            height: CARD_H,
            transformOrigin: "top left",
            transform: "scale(var(--wk-scale, 1))",
          }}
        >
          {/* ---------- month nav (nodes 1:207 / 1:210 / 1:203) ---------- */}
          <div
            style={{
              position: "absolute",
              left: 35,
              top: NAV_TOP,
              width: NAV_SIZE,
              height: NAV_SIZE,
              display: "grid",
            }}
          >
            <NavButton dir={-1} onClick={step(-1)} />
          </div>

          <h3
            style={{
              position: "absolute",
              left: 98,
              top: NAV_TOP,
              height: NAV_SIZE,
              margin: 0,
              display: "flex",
              alignItems: "center",
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              color: "var(--wk-heading)",
            }}
            aria-live="polite"
          >
            {cursor ? monthLabel(cursor.y, cursor.m) : " "}
          </h3>

          <div
            style={{
              position: "absolute",
              left: 295,
              top: NAV_TOP,
              width: NAV_SIZE,
              height: NAV_SIZE,
              display: "grid",
            }}
          >
            <NavButton dir={1} onClick={step(1)} />
          </div>

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
                  fontSize: 14,
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
                  padding: 8,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 8,
                  borderRight: "1px solid var(--wk-grid-line)",
                  borderBottom: "1px solid var(--wk-grid-line)",
                  background: isToday(day) ? "rgba(var(--wk-a1-rgb),0.06)" : undefined,
                }}
              >
                <DayNumber
                  day={day}
                  today={isToday(day)}
                  birthday={isBirthdayFor(cursor, day)}
                  size={26}
                  fontSize={16}
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
        <div className="flex items-center gap-4">
          <div className="grid size-9"><NavButton dir={-1} onClick={step(-1)} /></div>
          <h3
            className="text-[20px] font-bold tracking-tight"
            style={{ color: "var(--wk-heading)" }}
            aria-live="polite"
          >
            {cursor ? monthLabel(cursor.y, cursor.m) : " "}
          </h3>
          <div className="grid size-9"><NavButton dir={1} onClick={step(1)} /></div>
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

      <WorkshopDetailsModal event={active} onClose={closeModal} />
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
    height: compact ? 18 : 56,
    borderRadius: compact ? 6 : 16,
    paddingLeft: compact ? 2 : 4,
    paddingRight: compact ? 2 : 8,
    boxShadow: "0 2px 4px rgba(var(--wk-ink-a),0.06)",
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
        width: compact ? 14 : 57,
        height: compact ? 14 : 50,
        borderRadius: compact ? 4 : 12,
        background: event.placeholder ? "var(--wk-chip-strong)" : "#ffffff",
        // A hairline so the white tile still reads against the palest track,
        // where a plain white plate would dissolve into the bar.
        border: "1px solid rgba(var(--wk-ink-a),0.08)",
        boxShadow: "0 1px 2px rgba(var(--wk-ink-a),0.10)",
      }}
    >
      <Icon
        size={compact ? 9 : 24}
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
  const name = compact ? null : (
    <span
      style={{
        marginLeft: 8,
        minWidth: 0,
        flex: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.25,
        color: event.placeholder ? "var(--wk-muted)" : TRACK_FG[event.track],
      }}
    >
      {event.placeholder ? "Workshop — TBA" : event.title}
    </span>
  );

  const inner = (
    <>
      {thumbnail}
      {name}
    </>
  );

  const interactive = "cursor-pointer transition-transform hover:-translate-y-px";

  // Any finished real workshop → details modal (with or without a recording).
  if (todayKey && hasReplay(event, todayKey)) {
    return (
      <button
        type="button"
        aria-label={`${label} — view details`}
        onClick={(e) => onOpen(event, e.currentTarget)}
        className={interactive}
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
        className={interactive}
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
        className={interactive}
        style={barStyle}
      >
        {inner}
      </a>
    );
  }

  // A Saturday placeholder whose date has since passed — nothing to open.
  return (
    <span style={{ ...barStyle, opacity: 0.75 }} title={label}>
      {inner}
    </span>
  );
}
