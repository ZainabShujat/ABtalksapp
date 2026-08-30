"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Play, X } from "lucide-react";
import {
  type WorkshopEvent,
  fullDate,
  youtubeThumb,
} from "@/components/workshop/events-data";

/**
 * Replay overlay for a past workshop (Figma node 19:5).
 *
 * Takes the event as a prop rather than reading EVENTS itself: both this and
 * its caller are Client Components, so the LucideIcon on the event is fine
 * here — the serialization rule only bars a Server→Client hand-off.
 */
export default function WorkshopDetailsModal({
  event,
  onClose,
}: {
  event: WorkshopEvent | null;
  onClose: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [thumbHq, setThumbHq] = useState(false);

  // Every open starts back at the poster still, never mid-video.
  useEffect(() => {
    if (event) {
      setPlaying(false);
      setThumbHq(false);
    }
  }, [event]);

  // The video's own still is the honest image for a "YouTube recording"
  // panel; posterSrc (promo artwork) only stands in when there is no video.
  const still = event?.youtubeId
    ? youtubeThumb(event.youtubeId, thumbHq ? "hq" : "maxres")
    : event?.posterSrc;

  // Escape to close, and lock background scroll while open.
  useEffect(() => {
    if (!event) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [event, onClose]);

  return (
    <AnimatePresence>
      {event && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="wk-details-title"
          className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto p-4 sm:p-6"
          style={{
            background: "var(--wk-scrim)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.97, y: 14, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="relative my-auto w-full max-w-[1100px] overflow-hidden rounded-3xl p-5 sm:p-8"
            style={{
              background: "var(--wk-surface)",
              border: "1px solid var(--wk-card-border)",
              boxShadow: "var(--wk-shadow-lg)",
              color: "var(--wk-text)",
            }}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-4 top-4 z-10 flex size-9 items-center justify-center rounded-full transition-colors"
              style={{ background: "var(--wk-chip)", color: "var(--wk-text-dim)" }}
            >
              <X className="size-4" aria-hidden />
            </button>

            <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr] lg:gap-8">
              {/* ---------------- player ---------------- */}
              <div
                className="relative aspect-video w-full overflow-hidden rounded-2xl"
                style={{ background: "var(--wk-ink)", border: "1px solid var(--wk-card-border)" }}
              >
                {playing && event.youtubeId ? (
                  <iframe
                    // youtube-nocookie + click-to-load: the app runs a cookie
                    // consent gate, so no YouTube request may fire on render.
                    src={`https://www.youtube-nocookie.com/embed/${event.youtubeId}?autoplay=1&rel=0`}
                    title={event.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="absolute inset-0 h-full w-full border-0"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setPlaying(true)}
                    disabled={!event.youtubeId}
                    aria-label={
                      event.youtubeId
                        ? `Play the ${event.title} recording`
                        : "Recording not available yet"
                    }
                    className="group absolute inset-0 flex h-full w-full items-center justify-center disabled:cursor-not-allowed"
                  >
                    {still && (
                      <Image
                        src={still}
                        alt=""
                        fill
                        sizes="(max-width: 1024px) 100vw, 640px"
                        className="object-cover opacity-70"
                        // maxresdefault is absent for videos not published in
                        // HD; drop to the always-present hq still rather than
                        // leaving a broken image behind the play button.
                        onError={() => setThumbHq(true)}
                        unoptimized={thumbHq}
                      />
                    )}

                    <span className="absolute left-6 top-5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">
                      YouTube recording
                    </span>

                    {event.youtubeId ? (
                      <span className="relative flex size-[82px] items-center justify-center rounded-full bg-white shadow-lg transition-transform group-hover:scale-105">
                        <Play
                          className="size-8 translate-x-0.5"
                          fill="var(--wk-a1)"
                          stroke="var(--wk-a1)"
                          aria-hidden
                        />
                      </span>
                    ) : (
                      <span className="relative rounded-full bg-white/10 px-4 py-2 text-[12.5px] font-semibold text-white/70">
                        Recording coming soon
                      </span>
                    )}

                    {event.duration && (
                      <span className="absolute bottom-5 right-6 text-[11.5px] font-medium tabular-nums text-white/70">
                        {event.duration}
                      </span>
                    )}
                  </button>
                )}
              </div>

              {/* ---------------- info ---------------- */}
              <div className="min-w-0">
                <h2
                  id="wk-details-title"
                  className="wk-t text-[26px] font-extrabold leading-[1.12] tracking-tight sm:text-[32px]"
                >
                  {event.title}
                </h2>

                <p
                  className="mt-4 text-[11.5px] font-bold uppercase tracking-[0.12em]"
                  style={{ color: "var(--wk-a1)" }}
                >
                  Past workshop • {fullDate(event.date)} • {event.time}
                </p>

                <p className="wk-dim mt-4 text-[14.5px] leading-relaxed">
                  {event.desc}
                </p>

                {event.takeaways && event.takeaways.length > 0 && (
                  <>
                    <h3 className="wk-t mt-7 text-[17px] font-bold tracking-tight">
                      Key takeaways
                    </h3>
                    <ul className="mt-3 space-y-2">
                      {event.takeaways.map((t, i) => (
                        <li key={t} className="flex gap-3 text-[13.5px] leading-relaxed">
                          <span className="wk-faint shrink-0 font-semibold tabular-nums">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="wk-t">{t}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {event.resources && event.resources.length > 0 && (
                  <>
                    <h3 className="wk-t mt-7 text-[17px] font-bold tracking-tight">
                      Resources
                    </h3>
                    <ul className="mt-3 space-y-2">
                      {event.resources.map((r) => (
                        <li key={r.href}>
                          <a
                            href={r.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-[13.5px] font-medium hover:underline"
                            style={{ color: "var(--wk-a1)" }}
                          >
                            <span aria-hidden>{r.kind === "youtube" ? "▶" : "↗"}</span>
                            {r.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <span
                  className="mt-7 inline-flex items-center rounded-full px-3.5 py-2 text-[10.5px] font-bold uppercase tracking-[0.12em]"
                  style={{
                    background: "rgba(var(--wk-a1-rgb),0.10)",
                    color: "var(--wk-a1)",
                    border: "1px solid rgba(var(--wk-a1-rgb),0.28)",
                  }}
                >
                  {event.youtubeId ? "Replay available" : "Replay coming soon"}
                </span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
