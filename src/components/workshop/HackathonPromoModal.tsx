"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, X } from "lucide-react";
import {
  EVENTS,
  fullDate,
  isPastEvent,
  istTodayKey,
} from "@/components/workshop/events-data";

// Bump the version suffix to show the popup again after changing its content.
const SEEN_KEY = "abtalks_hackathon_promo_v1";
const EVENT_ID = "ai-hackathon-48h";

/**
 * One-time promo for the hackathon, shown on the workshop landing page.
 *
 * Takes no props: it reads the event itself so nothing crosses the
 * Server -> Client boundary, and it lives inside `.wk-root` so the page's
 * brand custom properties cascade into it.
 */
export default function HackathonPromoModal() {
  const [open, setOpen] = useState(false);

  const event = EVENTS.find((e) => e.id === EVENT_ID);

  useEffect(() => {
    if (!event?.href) return;
    // Never show once dismissed, and never for an event that has passed.
    if (localStorage.getItem(SEEN_KEY)) return;
    if (isPastEvent(event, istTodayKey())) return;

    const timer = setTimeout(() => setOpen(true), 2500);
    return () => clearTimeout(timer);
  }, [event]);

  const dismiss = () => {
    localStorage.setItem(SEEN_KEY, "1");
    setOpen(false);
  };

  // Close on Escape, and lock background scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!event?.href) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          onClick={dismiss}
          role="dialog"
          aria-modal="true"
          aria-labelledby="hackathon-promo-title"
          className="fixed inset-0 z-[80] flex items-center justify-center px-4"
          style={{
            background: "rgba(5,10,23,0.7)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.96, y: 14, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-[420px] overflow-hidden rounded-3xl p-7 sm:p-8"
            style={{
              background: "var(--wk-surface, #0b1120)",
              border: `1px solid ${event.accent}40`,
              boxShadow: "0 30px 80px -30px rgba(0,0,0,0.85)",
              color: "var(--wk-text, #f5f6fa)",
            }}
          >
            {/* thin accent hairline */}
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-px"
              style={{
                background: `linear-gradient(to right, transparent, ${event.accent}, transparent)`,
              }}
            />

            <button
              type="button"
              onClick={dismiss}
              aria-label="Close"
              className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/5 hover:text-white/80"
            >
              <X className="size-4" aria-hidden />
            </button>

            <span
              className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.16em]"
              style={{
                background: `${event.accent}18`,
                color: event.accent,
                border: `1px solid ${event.accent}45`,
              }}
            >
              <event.Icon size={12} strokeWidth={2.25} />
              {event.tag}
            </span>

            <h2
              id="hackathon-promo-title"
              className="mt-4 text-[24px] font-extrabold leading-tight tracking-tight sm:text-[27px]"
            >
              {event.title}
            </h2>

            <p className="mt-3 text-[13.5px] leading-relaxed text-white/55">
              {event.desc}
            </p>

            <div
              className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl px-3.5 py-3 text-[12.5px] text-white/60"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <span>{fullDate(event.date)}</span>
              <span className="text-white/20">·</span>
              <span>{event.time}</span>
              <span className="text-white/20">·</span>
              <span>{event.location}</span>
            </div>

            <a
              href={event.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={dismiss}
              className="group mt-6 flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[15px] font-semibold text-white transition-transform hover:-translate-y-0.5"
              style={{ background: "var(--wk-grad)" }}
            >
              {event.ctaLabel ?? "Learn more"}
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-1"
                aria-hidden
              />
            </a>

            <button
              type="button"
              onClick={dismiss}
              className="mt-3 w-full text-center text-[12.5px] font-medium text-white/35 transition-colors hover:text-white/60"
            >
              Maybe later
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
