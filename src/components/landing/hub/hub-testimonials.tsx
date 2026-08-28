"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  TESTIMONIALS,
  type Testimonial,
} from "@/components/landing/testimonials-data";

const AUTOPLAY_MS = 3500;
const RESUME_AFTER_INPUT_MS = 8000;

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}

function HubTestimonialCard({ name, org, photo, quote }: Testimonial) {
  return (
    <figure className="hub-t-card">
      <span className="hub-t-quote-mark" aria-hidden>
        “
      </span>
      <blockquote className="hub-t-body">{quote}</blockquote>
      <figcaption className="hub-t-footer">
        {photo ? (
          <Image
            src={photo}
            alt=""
            width={55}
            height={55}
            loading="lazy"
            style={{
              width: 55,
              height: 55,
              borderRadius: 999,
              objectFit: "cover",
              flex: "none",
            }}
          />
        ) : (
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              width: 55,
              height: 55,
              borderRadius: 999,
              alignItems: "center",
              justifyContent: "center",
              background: "var(--hub-lavender)",
              color: "var(--hub-accent)",
              fontWeight: 700,
              flex: "none",
            }}
          >
            {initials(name)}
          </span>
        )}
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 700,
              color: "#111",
            }}
          >
            {name}
          </p>
          {org ? (
            <p
              style={{
                margin: "2px 0 0",
                fontSize: 14,
                color: "#666",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 280,
              }}
            >
              {org}
            </p>
          ) : null}
        </div>
      </figcaption>
    </figure>
  );
}

export function HubTestimonials() {
  const trackRef = useRef<HTMLDivElement>(null);
  const cooldownRef = useRef<number | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const [cooling, setCooling] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);

  const syncEdges = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  const step = useCallback((direction: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    const card = el.querySelector("figure");
    const distance = card ? card.clientWidth + 20 : el.clientWidth * 0.8;
    el.scrollBy({ left: direction * distance, behavior: "smooth" });
  }, []);

  const holdAutoplay = useCallback(() => {
    setCooling(true);
    if (cooldownRef.current) window.clearTimeout(cooldownRef.current);
    cooldownRef.current = window.setTimeout(
      () => setCooling(false),
      RESUME_AFTER_INPUT_MS,
    );
  }, []);

  useEffect(() => {
    return () => {
      if (cooldownRef.current) window.clearTimeout(cooldownRef.current);
    };
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    syncEdges();
    const observer = new ResizeObserver(syncEdges);
    observer.observe(el);
    return () => observer.disconnect();
  }, [syncEdges]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const apply = () => setHidden(document.hidden);
    apply();
    document.addEventListener("visibilitychange", apply);
    return () => document.removeEventListener("visibilitychange", apply);
  }, []);

  const autoplaying = !reducedMotion && !engaged && !cooling && !hidden;

  useEffect(() => {
    if (!autoplaying) return;
    const timer = window.setInterval(() => {
      const el = trackRef.current;
      if (!el) return;
      const finished = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      if (finished) {
        el.scrollTo({ left: 0, behavior: "smooth" });
      } else {
        step(1);
      }
    }, AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [autoplaying, step]);

  const manualStep = (direction: 1 | -1) => {
    holdAutoplay();
    step(direction);
  };

  return (
    <div
      onMouseEnter={() => setEngaged(true)}
      onMouseLeave={() => setEngaged(false)}
      onFocus={() => setEngaged(true)}
      onBlur={() => setEngaged(false)}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <button
          type="button"
          className="hub-t-arrow"
          aria-label="Previous testimonials"
          disabled={atStart}
          onClick={() => manualStep(-1)}
        >
          ←
        </button>
        <button
          type="button"
          className="hub-t-arrow"
          aria-label="Next testimonials"
          disabled={atEnd}
          onClick={() => manualStep(1)}
        >
          →
        </button>
      </div>

      <div
        ref={trackRef}
        onScroll={syncEdges}
        onPointerDown={holdAutoplay}
        onTouchStart={holdAutoplay}
        tabIndex={0}
        role="region"
        aria-label="Testimonials, scroll horizontally"
        className="no-scrollbar"
        style={{
          overflowX: "auto",
          scrollSnapType: "x mandatory",
          scrollBehavior: "smooth",
          outline: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            width: "max-content",
            gap: 20,
            paddingBottom: 8,
          }}
        >
          {TESTIMONIALS.map((testimonial) => (
            <HubTestimonialCard key={testimonial.name} {...testimonial} />
          ))}
        </div>
      </div>
    </div>
  );
}
