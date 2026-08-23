"use client";

import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { IST } from "@/lib/date-utils";
import { EVENTS } from "@/components/workshop/events-data";
import { HUB_CARD_HOVER_CLASS } from "@/components/dashboard-hub/nav-items";
import { cn } from "@/lib/utils";

function todayIstKey(): string {
  return formatInTimeZone(new Date(), IST, "yyyy-MM-dd");
}

export function EventsSection() {
  const today = todayIstKey();

  const upcoming = EVENTS.filter((e) => e.date >= today).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const past = EVENTS.filter((e) => e.date < today).sort((a, b) =>
    b.date.localeCompare(a.date),
  );

  return (
    <section id="events" className="scroll-mt-20 ml-5 px-4 py-8 sm:px-6">
      <h2 className="ml-2 font-heading text-xl font-semibold uppercase text-[#e05226]">Events</h2>

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
  events: (typeof EVENTS)[number][];
  past?: boolean;
}) {
  return (
    <div className={cn("mt-6", past && "mt-8")}>
      <h3 className="text-sm font-semibold tracking-wide text-black uppercase">
        {title}
      </h3>
      <div className="no-scrollbar mt-3 flex gap-4 overflow-x-auto pt-1 pb-3 snap-x snap-mandatory">
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
  event: (typeof EVENTS)[number];
  past?: boolean;
}) {
  const Icon = event.Icon;
  const href =
    event.href ??
    (event.register ? `/ai-workshop/events#${event.id}` : "/ai-workshop/events");
  const ctaLabel = event.ctaLabel ?? (event.register ? "Register" : "View");

  return (
    <article
      className={cn(
        "flex w-[280px] shrink-0 snap-start flex-col rounded-2xl border border-neutral-200 p-5 sm:w-[300px]",
        HUB_CARD_HOVER_CLASS,
        past ? "bg-neutral-50 opacity-90" : "bg-white shadow-sm",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700"
          aria-hidden
        >
          <Icon className="size-5" />
        </span>
        <span className="rounded-full border border-neutral-200 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-neutral-600 uppercase">
          {event.tag}
        </span>
      </div>

      <h4 className="mt-4 font-heading text-base font-semibold leading-snug text-black">
        {event.title}
      </h4>
      <p className="mt-2 text-xs text-[#555555]">
        {event.date} · {event.time}
      </p>
      <p className="mt-3 line-clamp-3 flex-1 text-sm leading-relaxed text-[#555555]">
        {event.desc}
      </p>
      <p className="mt-3 text-xs text-[#555555]">{event.location}</p>
      {past ? null : (
        <Link
          href={href}
          {...(event.href
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
          className="mt-4 inline-flex text-sm font-medium text-black transition-colors duration-200 ease-[var(--ease-spark)] hover:text-[#e05226]"
        >
          {ctaLabel} →
        </Link>
      )}
    </article>
  );
}
