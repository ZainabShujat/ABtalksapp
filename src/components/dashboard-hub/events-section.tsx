"use client";

import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { IST } from "@/lib/date-utils";
import type { WorkshopEvent } from "@/components/workshop/events-data";
import {
  HUB_CARD_CTA_CLASS,
  HUB_CARD_HOVER_CLASS,
} from "@/components/dashboard-hub/nav-items";
import { cn } from "@/lib/utils";

function todayIstKey(): string {
  return formatInTimeZone(new Date(), IST, "yyyy-MM-dd");
}

/** `events` comes from the server parent; the schedule is database-backed. */
export function EventsSection({ events }: { events: WorkshopEvent[] }) {
  const today = todayIstKey();

  const upcoming = events.filter((e) => e.date >= today).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const past = events.filter((e) => e.date < today).sort((a, b) =>
    b.date.localeCompare(a.date),
  );

  return (
    <section id="events" className="scroll-mt-20 px-4 py-8 sm:px-6 lg:ml-5">
      <h2 className="font-heading text-xl font-semibold uppercase text-[#03535F]">
        Events
      </h2>

      {upcoming.length > 0 ? (
        <EventRail title="Upcoming events" events={upcoming} />
      ) : null}

      {past.length > 0 ? (
        <EventRail title="Past events" events={past} past />
      ) : null}
    </section>
  );
}

function EventRail({
  title,
  events,
  past = false,
}: {
  title: string;
  events: WorkshopEvent[];
  past?: boolean;
}) {
  return (
    <div className={cn("mt-6", past && "mt-8")}>
      <h3 className="text-sm font-semibold tracking-wide text-black uppercase">
        {title}
      </h3>
      <div
        className={cn(
          "mt-3 gap-4 pt-1 pb-3",
          past
            ? "grid grid-cols-1 items-stretch sm:grid-cols-2 xl:grid-cols-3"
            : "no-scrollbar flex overflow-x-auto snap-x snap-mandatory 2xl:flex-wrap 2xl:overflow-visible",
        )}
      >
        {events.map((event) => (
          <EventCard key={event.id} event={event} past={past} />
        ))}
      </div>
    </div>
  );
}

function EventCard({
  event,
  past = false,
}: {
  event: WorkshopEvent;
  past?: boolean;
}) {
  const href =
    event.href ??
    (event.register ? `/workshop/events#${event.id}` : "/workshop/events");
  const ctaLabel = event.ctaLabel ?? (event.register ? "Register" : "View");

  return (
    <article
      className={cn(
        "flex flex-col rounded-2xl border border-[#E0E0E0] p-5",
        HUB_CARD_HOVER_CLASS,
        past
          ? "h-full w-full min-w-0 bg-white"
          : "w-[280px] shrink-0 snap-start justify-between bg-white shadow-sm sm:w-[300px] 2xl:min-w-[300px] 2xl:max-w-[420px] 2xl:shrink 2xl:grow 2xl:basis-0",
      )}
    >
      <div className="min-w-0">
        <h4
          className={cn(
            "font-inter text-base font-bold leading-snug text-black",
            past && "line-clamp-2 min-h-[2.75rem]",
          )}
        >
          {event.title}
        </h4>
        <p
          className={cn(
            "mt-2 text-xs text-[#4B4B4B]",
            past && "line-clamp-1 min-h-4",
          )}
        >
          {event.date} · {event.time}
        </p>
        <p
          className={cn(
            "mt-3 text-sm leading-relaxed text-[#4B4B4B]",
            past ? "line-clamp-3 min-h-[4.875rem]" : "line-clamp-3",
          )}
        >
          {event.desc}
        </p>
        <p
          className={cn(
            "mt-3 text-xs text-[#4B4B4B]",
            past && "line-clamp-1 min-h-4",
          )}
        >
          {event.location}
        </p>
      </div>
      {past ? null : (
        <Link
          href={href}
          {...(event.href
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
          className={cn(HUB_CARD_CTA_CLASS, "mt-2 self-end")}
        >
          {ctaLabel}
        </Link>
      )}
    </article>
  );
}
