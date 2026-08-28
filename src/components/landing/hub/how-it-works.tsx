"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useSafeReducedMotion } from "@/lib/motion";

const SLIDES = [
  {
    number: "01",
    title: "A requirement comes in",
    body: "A company tells us the role, the stack, the level and the timeline. If a matching cohort is already running, we point at it. If not, we design one around the requirement.",
    image: "/landing/step1.jpeg",
  },
  {
    number: "02",
    title: "People build in the open",
    body: "Candidates enter a hackathon, cohort or challenge. Work is submitted, reviewed by mentors and scored against a published rubric, the same rubric for everyone in the room.",
    image: "/landing/step2.jpeg",
  },
  {
    number: "03",
    title: "The candidate releases the profile",
    body: "We show the company the evidence without the identity. When there is genuine interest on both sides, the candidate approves the release and the conversation starts, already past the screening stage.",
    image: "/landing/step3.jpeg",
  },
] as const;

export function HowItWorks() {
  const reduce = useSafeReducedMotion();
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index] ?? SLIDES[0];

  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % SLIDES.length);
    }, 5200);
    return () => window.clearInterval(id);
  }, [reduce]);

  return (
    <section id="how" className="hub-shell" style={{ padding: "72px 0" }}>
      <p className="hub-kicker">How it works</p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1fr)",
          gap: "clamp(28px, 4vw, 64px)",
          alignItems: "center",
          marginTop: 24,
        }}
        className="hub-how-grid"
      >
        <div
          className="hub-blank-frame hub-how-frame"
          style={{ minHeight: 320, position: "relative", overflow: "hidden" }}
        >
          {SLIDES.map((s, i) => (
            <Image
              key={s.image}
              src={s.image}
              alt=""
              fill
              sizes="(max-width: 800px) 100vw, 50vw"
              className="hub-how-frame-img"
              style={{
                objectFit: "cover",
                objectPosition: "center",
                opacity: i === index ? 1 : 0,
                transition: reduce ? "none" : "opacity 0.45s ease",
              }}
              priority={i === 0}
            />
          ))}
        </div>
        <div>
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 16,
            }}
          >
            {SLIDES.map((s, i) => (
              <button
                key={s.number}
                type="button"
                aria-label={`Show slide ${s.number}`}
                aria-current={i === index}
                onClick={() => setIndex(i)}
                style={{
                  width: i === index ? 28 : 10,
                  height: 10,
                  borderRadius: 999,
                  border: 0,
                  background:
                    i === index ? "var(--hub-accent)" : "var(--hub-border)",
                  cursor: "pointer",
                  transition: "width 0.25s ease",
                }}
              />
            ))}
          </div>
          <p
            className="hub-display"
            style={{
              margin: 0,
              fontSize: "clamp(64px, 8vw, 96px)",
              fontWeight: 700,
              lineHeight: 1,
              color: "var(--hub-accent)",
            }}
          >
            {slide.number}
          </p>
          <h3
            style={{
              margin: "12px 0 0",
              fontSize: "clamp(28px, 3.4vw, 48px)",
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
            }}
          >
            {slide.title}
          </h3>
          <p
            style={{
              margin: "18px 0 0",
              fontSize: 18,
              lineHeight: 1.6,
              color: "var(--hub-muted)",
              maxWidth: "42ch",
            }}
          >
            {slide.body}
          </p>
        </div>
      </div>
      <style>{`
        @media (max-width: 800px) {
          .hub-how-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
