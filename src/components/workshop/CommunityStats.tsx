"use client";

import { useEffect, useRef, useState } from "react";

const STATS = [
  { value: 11000, suffix: "+", label: "AI Learners", sub: "From 25+ Countries", accent: "#6366f1" },
  { value: 550, suffix: "+", label: "Institutions", sub: "Students enrolled", accent: "#a855f7" },
  { value: 300, suffix: "+", label: "Organisations", sub: "Working professionals", accent: "#818cf8" },
];

const CLAUDE_SIGNUP = "https://www.abtalks.in/?ref=N2VD2X";

function useInView(threshold = 0.3) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function CountUp({ target, run, duration = 1800 }: { target: number; run: boolean; duration?: number }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setVal(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, target, duration]);
  return <>{val.toLocaleString()}</>;
}

export default function CommunityStats() {
  const { ref, visible } = useInView(0.35);

  return (
    <section className="mx-auto w-full max-w-5xl px-4 pb-16 sm:pb-24">
      <div
        className="relative overflow-hidden rounded-3xl p-7 sm:p-10"
        style={{
          background: "rgba(255,255,255,0.025)",
          border: "1px solid rgba(255,255,255,0.09)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{
            background:
              "linear-gradient(to right, transparent, rgba(var(--wk-a1-rgb),0.6), rgba(var(--wk-a2-rgb),0.6), transparent)",
          }}
        />

        {/* Heading */}
        <div className="text-center">

          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-[38px]">
            The ABTalks AI Learners Community
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-white/45 md:text-[15px]">
            You&apos;re joining a fast-growing movement of builders learning AI together.
          </p>
        </div>

        {/* Stats */}
        <div ref={ref} className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {STATS.map((s, i) => (
            <div
              key={s.label}
              className="relative overflow-hidden rounded-2xl p-6 text-center"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.07)",
                transform: visible ? "translateY(0)" : "translateY(16px)",
                opacity: visible ? 1 : 0,
                transition: `transform 0.6s cubic-bezier(0.22,1,0.36,1) ${i * 0.12}s, opacity 0.6s ease ${i * 0.12}s`,
              }}
            >
              <div className="flex items-baseline justify-center">
                <span
                  className="font-mono text-4xl font-extrabold tracking-tight tabular-nums sm:text-5xl"
                  style={{
                    background: `linear-gradient(135deg, hsl(var(--background)), ${s.accent})`,
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  <CountUp target={s.value} run={visible} />
                </span>
                <span
                  className="ml-0.5 text-2xl font-extrabold sm:text-3xl"
                  style={{ color: s.accent }}
                >
                  {s.suffix}
                </span>
              </div>
              <div className="mt-2 text-sm font-bold text-white/85">{s.label}</div>
              <div className="mt-0.5 text-[12px] font-medium text-white/40">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* ABTalks + Claude challenge blurb */}
        <div className="mx-auto mt-10 max-w-2xl text-center">
          <p className="text-[14.5px] leading-relaxed text-white/55">
            ABTalks is where ambitious learners master AI together — through live
            workshops, hands-on challenges, and a community that ships.
          </p>
          <p className="mt-2 text-[14.5px] leading-relaxed text-white/55">
            Take on the <span className="font-semibold text-white/80">60-Day Claude AI Challenge</span>,
            build in public, and get discovered by recruiters.
          </p>

          <a
            href={CLAUDE_SIGNUP}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-7 inline-flex items-center gap-2 rounded-none px-7 py-3.5 text-[15px] font-semibold text-white transition-transform hover:-translate-y-0.5"
            style={{
              background: "var(--wk-grad)",
              boxShadow:
                "0 12px 30px -10px rgba(var(--wk-a2-rgb),0.6), inset 0 1px 0 rgba(255,255,255,0.25)",
            }}
          >
            Join the Claude Challenge →
          </a>
        </div>
      </div>
    </section>
  );
}
