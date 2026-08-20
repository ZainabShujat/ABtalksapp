"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import {
  EVENTS,
  dayNum,
  getRegistrableEvent,
  istTodayKey,
  monthAbbr,
  upcomingEvents,
} from "@/components/workshop/events-data";
import ComingSoonCard from "@/components/workshop/ComingSoonCard";

export default function UpcomingEvents() {
  const [perView, setPerView] = useState(3);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Client-only: this page is statically prerendered, so a build-time date
  // would freeze the list. null keeps the first render deterministic.
  const [todayKey, setTodayKey] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setTodayKey(istTodayKey());
    sync();
    const id = setInterval(sync, 60_000);
    return () => clearInterval(id);
  }, []);

  const { events, openEventId } = useMemo(
    () =>
      todayKey
        ? {
            events: upcomingEvents(todayKey),
            openEventId: getRegistrableEvent(todayKey)?.id,
          }
        : { events: EVENTS, openEventId: undefined },
    [todayKey],
  );

  const TOTAL_SLIDES = events.length + 1; // events + the "coming soon" teaser

  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth;
      setPerView(w < 640 ? 1 : w < 1024 ? 2 : 3);
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  const maxIndex = Math.max(0, TOTAL_SLIDES - perView);

  // Keep index valid when the viewport (perView) changes.
  useEffect(() => {
    setIndex((i) => Math.min(i, maxIndex));
  }, [maxIndex]);

  // Auto-advance (pauses on hover / focus).
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setIndex((i) => (i >= maxIndex ? 0 : i + 1));
    }, 4000);
    return () => clearInterval(id);
  }, [paused, maxIndex]);

  const next = () => setIndex((i) => (i >= maxIndex ? 0 : i + 1));
  const prev = () => setIndex((i) => (i <= 0 ? maxIndex : i - 1));

  return (
    <section className="mx-auto w-full max-w-5xl px-4 pb-20">
      <div className="mb-10 text-center">
        
        <h2 className="text-3xl font-extrabold tracking-tight text-white md:text-[38px]">
          Upcoming Workshops &amp; Events
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-white/45 md:text-[15px]">
          More live sessions are on the way. Register above and we&apos;ll notify
          you when these open.
        </p>
      </div>

      <div
        className="relative"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
      >
        {/* arrows */}
        <button
          onClick={prev}
          aria-label="Previous"
          className="absolute -left-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-white/80 transition-colors hover:text-white sm:flex md:-left-5"
          style={{
            background: "rgba(11,17,32,0.8)",
            border: "1px solid rgba(255,255,255,0.12)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          ‹
        </button>
        <button
          onClick={next}
          aria-label="Next"
          className="absolute -right-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-white/80 transition-colors hover:text-white sm:flex md:-right-5"
          style={{
            background: "rgba(11,17,32,0.8)",
            border: "1px solid rgba(255,255,255,0.12)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          ›
        </button>

        {/* track */}
        <div className="overflow-hidden">
          <div
            className="flex transition-transform duration-500 ease-out"
            style={{ transform: `translateX(-${index * (100 / perView)}%)` }}
          >
            {events.map((ev) => (
              <div
                key={ev.title}
                className="shrink-0 px-2"
                style={{ width: `${100 / perView}%` }}
              >
                {(() => {
                  const cardCommon = "relative flex h-full flex-col overflow-hidden rounded-2xl p-5 transition-transform";
                  const cardStyle: React.CSSProperties = {
                    background: "rgba(255,255,255,0.025)",
                    border: `1px solid ${ev.id === openEventId || ev.href ? `${ev.accent}45` : "rgba(255,255,255,0.08)"}`,
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                  };
                  const body = (
                    <>
                      <div
                        className="absolute inset-x-0 top-0 h-px"
                        style={{
                          background: `linear-gradient(to right, transparent, ${ev.accent}, transparent)`,
                          opacity: 0.4,
                        }}
                      />
                      <div className="flex items-start justify-between gap-3">
                        <div
                          className="flex flex-col items-center rounded-xl px-3 py-2 text-center"
                          style={{
                            background: `${ev.accent}18`,
                            border: `1px solid ${ev.accent}30`,
                          }}
                        >
                          <span
                            className="text-[11px] font-extrabold uppercase tracking-widest"
                            style={{ color: ev.accent }}
                          >
                            {monthAbbr(ev.date)}
                          </span>
                          <span className="text-[13px] font-extrabold text-white/70">
                            {dayNum(ev.date)}
                          </span>
                        </div>
                        <span
                          className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
                          style={{ background: `${ev.accent}18`, color: ev.accent }}
                        >
                          {ev.tag}
                        </span>
                      </div>

                      <h4 className="mt-4 text-[16px] font-bold leading-snug tracking-tight text-white">
                        {ev.title}
                      </h4>
                      <p className="mt-2 flex-1 text-[12.5px] font-medium leading-relaxed text-white/45">
                        {ev.desc}
                      </p>

                      <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3.5">
                        <span className="text-[11.5px] font-medium text-white/40">
                          {ev.location}
                        </span>
                        {ev.id === openEventId ? (
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
                            style={{
                              background: `${ev.accent}20`,
                              color: ev.accent,
                              border: `1px solid ${ev.accent}55`,
                            }}
                          >
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ background: ev.accent, boxShadow: `0 0 6px 1px ${ev.accent}` }}
                            />
                            Register →
                          </span>
                        ) : ev.href ? (
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
                            style={{
                              background: `${ev.accent}20`,
                              color: ev.accent,
                              border: `1px solid ${ev.accent}55`,
                            }}
                          >
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ background: ev.accent, boxShadow: `0 0 6px 1px ${ev.accent}` }}
                            />
                            {ev.ctaLabel ?? "Learn more"} →
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                            style={{
                              background: "rgba(255,255,255,0.04)",
                              color: "rgba(255,255,255,0.6)",
                              border: "1px solid rgba(255,255,255,0.08)",
                            }}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                            Coming soon
                          </span>
                        )}
                      </div>
                    </>
                  );
                  if (ev.href) {
                    return (
                      <a
                        href={ev.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${cardCommon} cursor-pointer hover:-translate-y-1`}
                        style={cardStyle}
                      >
                        {body}
                      </a>
                    );
                  }
                  return ev.id === openEventId ? (
                    <Link
                      href="/ai-workshop#register"
                      className={`${cardCommon} cursor-pointer hover:-translate-y-1`}
                      style={cardStyle}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className={cardCommon} style={cardStyle}>
                      {body}
                    </div>
                  );
                })()}
              </div>
            ))}

            {/* coming-soon teaser slide */}
            <div className="shrink-0 px-2" style={{ width: `${100 / perView}%` }}>
              <ComingSoonCard />
            </div>
          </div>
        </div>
      </div>

      {/* dots */}
      <div className="mt-7 flex items-center justify-center gap-2">
        {Array.from({ length: maxIndex + 1 }).map((_, i) => (
          <button
            key={i}
            onClick={() => setIndex(i)}
            aria-label={`Go to slide ${i + 1}`}
            className="h-2 rounded-full transition-all duration-300"
            style={{
              width: i === index ? 22 : 8,
              background:
                i === index
                  ? "var(--wk-grad)"
                  : "rgba(255,255,255,0.18)",
            }}
          />
        ))}
      </div>

      {/* See all */}
      <div className="mt-8 text-center">
        <Link
          href="/ai-workshop/events"
          className="group inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-[14px] font-semibold text-white/80 transition-all hover:text-white"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          See all events
          <span className="transition-transform group-hover:translate-x-1">→</span>
        </Link>
      </div>
    </section>
  );
}
