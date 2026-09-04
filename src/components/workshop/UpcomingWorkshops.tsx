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

/** How many upcoming workshops the scrollable column will hold. */
const SIDEBAR_LIMIT = 8;

function StatusBadge({ status }: { status: EventStatus }) {
  if (status === "LIVE") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]"
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
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]"
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
      // `shrink-0` or the flex column squeezes the cards to fit instead of
      // letting the list scroll — measured, the second card came out 6px
      // shorter than its neighbours once there were four of them.
      className="shrink-0 rounded-2xl p-4"
      style={{
        background: "var(--wk-surface)",
        border: `1px solid ${
          status === "LIVE" ? "rgba(22, 163, 74, 0.32)" : "var(--wk-card-border)"
        }`,
      }}
    >
      {/* Icon, title and status share the top line. The icon used to sit on a
          line of its own beside the badge with the title underneath, which
          spent a whole row on two marks and read as a header strip rather than
          as a workshop. Here the title starts the card. */}
      <div className="flex items-start gap-2.5">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-[10px]"
          style={{
            background: "rgba(var(--wk-a1-rgb),0.10)",
            border: "1px solid rgba(var(--wk-a1-rgb),0.16)",
          }}
        >
          <Icon size={17} strokeWidth={2} style={{ color: "var(--wk-a1)" }} aria-hidden />
        </span>

        {/* `min-w-0` or the flex item refuses to shrink below its longest word
            and pushes the badge out of the card. Clamped at two lines so a long
            title cannot run away with the card, but NOT reserved at two: every
            current title fits on one line at every width this column takes, so
            a reserve would have hung an empty line under all three. The
            description below carries the reserve that keeps the heights level. */}
        <h4
          className="line-clamp-2 min-w-0 flex-1 text-[16px] font-bold leading-[1.3] tracking-tight"
          style={{ color: "var(--wk-heading)" }}
        >
          {event.title}
        </h4>

        <span className="mt-0.5 shrink-0">
          <StatusBadge status={status} />
        </span>
      </div>

      {/* Indented to the title rather than the card edge — 36 for the icon plus
          the 10 gap — so the text block reads as one column under its heading. */}
      <p
        className="mt-2 line-clamp-2 min-h-[2.9em] pl-[46px] text-[13px] leading-[1.5]"
        style={{ color: "var(--wk-text-faint)" }}
      >
        {event.desc}
      </p>

      {/* The rule above this row is the divider — a border on the row it
          separates, rather than an element of its own to space around. Date,
          time and the action share it: the CTA used to be a full-width bar
          below, which made it the loudest thing in the column. */}
      <div
        className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-2.5"
        style={{ borderTop: "1px solid var(--wk-card-border)" }}
      >
        <dl
          className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px]"
          style={{ color: "var(--wk-text-dim)" }}
        >
          <div className="flex items-center gap-1.5">
            <CalendarDays size={13} style={{ color: "var(--wk-muted)" }} aria-hidden />
            <dt className="sr-only">Date</dt>
            <dd>{fullDate(event.date)}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock3 size={13} style={{ color: "var(--wk-muted)" }} aria-hidden />
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
            className="wk-cta flex h-[34px] shrink-0 items-center rounded-[10px] px-4 text-[13px] font-bold text-white"
          >
            Register Now
          </a>
        ) : (
          /* One line, and legible. It used to be broken over two by a <br />
             in --wk-muted, which read as a footnote rather than as the status
             of the card it sits on. `whitespace-nowrap` holds it together and
             the row below wraps it onto its own line when the date and time
             beside it leave too little room. */
          <p
            className="whitespace-nowrap text-right text-[12px] font-semibold leading-[1.3]"
            style={{ color: "var(--wk-text-dim)" }}
          >
            Registration opens closer to the date
          </p>
        )}
      </div>
    </article>
  );
}

export default function UpcomingWorkshops({ nowMs }: { nowMs: number | null }) {
  // Nothing is rendered until the client has a clock. Server and client agree
  // on "empty", so there is no hydration mismatch to reconcile.
  // 3 was the whole list when the column could not scroll — a fourth card
  // would simply have run past the calendar beside it. The list scrolls now,
  // so the cap is only there to stop a very long series rendering in full.
  const events = nowMs === null ? [] : sidebarEvents(nowMs, SIDEBAR_LIMIT);
  const openId = nowMs === null ? undefined : getRegistrableEvent(nowMs)?.id;

  return (
    /*
     * `xl:absolute xl:inset-0` inside the relative cell EventsCalendar wraps
     * this in, so at xl the column is exactly as tall as the calendar beside it
     * — that is where the scroller's height comes from, and why the list can
     * never push the row taller.
     *
     * `min-h-0` is the other half: a flex child's default `min-height: auto`
     * refuses to shrink below its content, so without it the list below would
     * grow instead of scrolling inside.
     */
    <aside
      className="flex min-h-0 flex-col gap-3 xl:absolute xl:inset-0"
      aria-labelledby="wk-upcoming-heading"
    >
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <h3
          id="wk-upcoming-heading"
          className="text-[18px] font-bold tracking-tight"
          style={{ color: "var(--wk-heading)" }}
        >
          Upcoming Workshops
        </h3>
        {/* One Browse-all action, and it lives here. The column used to carry
            two links to the same route — "View All" at the top and a bordered
            "Browse all events" row pinned to the bottom — which read as two
            different destinations. The bottom row is gone; this is it. */}
        <Link
          href="/workshop/events"
          className="group inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold hover:underline"
          style={{ color: "var(--wk-a1)" }}
        >
          <LayoutGrid size={13} aria-hidden />
          Browse all events
          <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>
            →
          </span>
        </Link>
      </div>

      {/*
        Only the cards scroll; the heading and the Browse-all link above stay
        put. The scroller is gated to `xl` because that is the only breakpoint
        with two columns — below it the grid is a single column, the aside has
        no imposed height, and a scrollbox there would be a tiny window on a
        page that already scrolls perfectly well.
      */}
      <div className="wk-scroll flex flex-col gap-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
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
      </div>
    </aside>
  );
}
