"use client";

import Link from "next/link";
import { CalendarDays, Clock3, LayoutGrid } from "lucide-react";
import {
  type EventStatus,
  type WorkshopEvent,
  eventStatus,
  fullDate,
  getRegistrableEvent,
  sidebarEvents,
} from "@/components/workshop/events-data";

/**
 * The Upcoming Workshops column beside the calendar.
 *
 * Reads nothing of its own: `sidebarEvents` is the same EVENTS array the grid
 * draws from, filtered by absolute time. Two lists that could disagree about
 * what is coming up would be worse than no sidebar at all.
 *
 * `nowMs` is passed in rather than read here. EventsCalendar already owns the
 * one client-resolved clock — the page is statically prerendered, so any time
 * read during render would be frozen at build and would differ between server
 * and client HTML. Null means "not resolved yet" and renders nothing.
 */

/**
 * Which event the `#register` form is actually bound to.
 *
 * Asks the same helper the SERVER asks, rather than re-deriving it from the
 * static flags — that second copy is how the card could offer Register Now for
 * one workshop while `submitWorkshopRegistrationAction` filed the row under
 * another.
 */

function StatusBadge({ status }: { status: EventStatus }) {
  if (status === "LIVE") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.12em]"
        style={{
          // The one colour outside the workshop ramp, and it earns its place:
          // LIVE and UPCOMING must be told apart at a glance, and two tints of
          // the same orange cannot do that. Green for "running now" is the
          // convention every viewer already knows.
          background: "rgba(22, 163, 74, 0.12)",
          color: "#15803d",
          border: "1px solid rgba(22, 163, 74, 0.3)",
        }}
      >
        <span className="wk-live-dot size-1.5 rounded-full" aria-hidden />
        Live
      </span>
    );
  }
  // Deliberately quieter than LIVE. Every card in the list is upcoming, so the
  // badge is a label, not an alert — a bordered orange pill on all three was
  // competing with the titles it sits above.
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.12em]"
      style={{ background: "var(--wk-chip)", color: "var(--wk-text-faint)" }}
    >
      Upcoming
    </span>
  );
}

function WorkshopCard({
  event,
  status,
  canRegister,
}: {
  event: WorkshopEvent;
  status: EventStatus;
  canRegister: boolean;
}) {
  const Icon = event.Icon;

  return (
    <article
      className="rounded-2xl p-3"
      style={{
        background: "var(--wk-surface)",
        border: `1px solid ${
          status === "LIVE" ? "rgba(22, 163, 74, 0.32)" : "var(--wk-card-border)"
        }`,
      }}
    >
      {/* Header: icon and status on one line, so the two identity markers read
          as a single band rather than the icon floating beside the body text. */}
      <div className="flex items-center gap-2.5">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-[9px]"
          style={{
            background: "rgba(var(--wk-a1-rgb),0.10)",
            border: "1px solid rgba(var(--wk-a1-rgb),0.16)",
          }}
        >
          <Icon size={15} strokeWidth={2} style={{ color: "var(--wk-a1)" }} aria-hidden />
        </span>
        <StatusBadge status={status} />
      </div>

      {/*
        Clamped at two lines so one long title can never run away with the
        card. At this column width all three current titles fit on one line,
        so the three cards measure the same without reserving a line that
        nobody uses.
      */}
      <h4
        className="mt-2.5 line-clamp-2 text-[15px] font-bold leading-[1.3] tracking-tight"
        style={{ color: "var(--wk-heading)" }}
      >
        {event.title}
      </h4>
      {/* Two lines reserved as well as clamped. Clamping alone only stops a
          long description; at wider column widths a SHORT one collapses to a
          single line and that card measures 18px less than its neighbours —
          which is exactly what made the tablet column look ragged. */}
      <p
        className="mt-1 line-clamp-2 min-h-[2.9em] text-[12px] leading-[1.45]"
        style={{ color: "var(--wk-text-faint)" }}
      >
        {event.desc}
      </p>

      {/* The rule above the metadata is the divider — a border on the row it
          separates, rather than an element of its own to space around. */}
      <dl
        className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 pt-2.5 text-[11.5px]"
        style={{ color: "var(--wk-text-dim)", borderTop: "1px solid var(--wk-card-border)" }}
      >
        <div className="flex items-center gap-1.5">
          <CalendarDays size={12} style={{ color: "var(--wk-muted)" }} aria-hidden />
          <dt className="sr-only">Date</dt>
          <dd>{fullDate(event.date)}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock3 size={12} style={{ color: "var(--wk-muted)" }} aria-hidden />
          <dt className="sr-only">Time</dt>
          <dd>{event.time}</dd>
        </div>
        {/*
          `host` is deliberately NOT rendered. It names a real person on the
          three September sessions, and this page is public and unauthenticated
          — a speaker's name does not need to be on it to sell the workshop.

          The field stays on WorkshopEvent and in the data: it is useful
          internally, and removing it would be a schema change for a display
          decision. This is the display decision. The same removal is applied
          to the other public surface that showed it, EventsTimeline.
        */}
      </dl>

      {/*
        `#register` and nothing else — the existing hash-driven RegistrationModal
        is the whole flow, and it binds server-side to getRegistrableEvent().
        That resolves to the SOONEST open workshop, so putting a live Register
        button on a later card would file that signup against the earlier one.
        Only the bound event gets the CTA; the rest say so plainly.
      */}
      {canRegister ? (
        <a
          href="#register"
          className="wk-cta mt-2.5 flex h-[34px] w-full items-center justify-center rounded-xl text-[13px] font-bold text-white"
        >
          Register Now
        </a>
      ) : (
        <p
          className="mt-2.5 flex h-[34px] w-full items-center justify-center rounded-xl px-3 text-center text-[11.5px] font-medium"
          style={{ background: "var(--wk-chip)", color: "var(--wk-text-faint)" }}
        >
          Registration opens closer to the date
        </p>
      )}
    </article>
  );
}

export default function UpcomingWorkshops({ nowMs }: { nowMs: number | null }) {
  // Nothing is rendered until the client has a clock. Server and client agree
  // on "empty", so there is no hydration mismatch to reconcile.
  const events = nowMs === null ? [] : sidebarEvents(nowMs);
  const openId = nowMs === null ? undefined : getRegistrableEvent(nowMs)?.id;

  return (
    <aside className="flex h-full flex-col gap-3" aria-labelledby="wk-upcoming-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h3
          id="wk-upcoming-heading"
          className="text-[17px] font-bold tracking-tight"
          style={{ color: "var(--wk-heading)" }}
        >
          Upcoming Workshops
        </h3>
        <Link
          href="/workshop/events"
          className="text-[13px] font-semibold hover:underline"
          style={{ color: "var(--wk-a1)" }}
        >
          View All
        </Link>
      </div>

      {nowMs !== null && events.length === 0 ? (
        <p
          className="rounded-2xl px-4 py-8 text-center text-[13px]"
          style={{
            background: "var(--wk-surface)",
            border: "1px solid var(--wk-card-border)",
            color: "var(--wk-text-faint)",
          }}
        >
          No sessions scheduled right now. The weekly Saturday slot is still
          running — check the calendar.
        </p>
      ) : (
        events.map((ev) => (
          <WorkshopCard
            key={ev.id}
            event={ev}
            status={eventStatus(ev, nowMs!)}
            canRegister={ev.id === openId}
          />
        ))
      )}

      {/* Secondary by construction: no fill, no shadow, just a bordered row.
          It closes the column without reading as a fourth workshop card. */}
      <Link
        href="/workshop/events"
        className="group mt-auto flex items-center justify-center gap-2 rounded-xl py-2.5 text-[12.5px] font-semibold transition-colors"
        style={{
          border: "1px solid var(--wk-card-border)",
          color: "var(--wk-text-dim)",
        }}
      >
        <LayoutGrid size={13} aria-hidden />
        Browse all events
        <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>
          →
        </span>
      </Link>
    </aside>
  );
}
