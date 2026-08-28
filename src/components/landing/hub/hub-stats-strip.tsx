"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useSafeReducedMotion } from "@/lib/motion";

const STATS = [
  { target: 10, suffix: "k+", label: "People on the platform" },
  { target: 100, suffix: "+", label: "Companies in the recruiter network" },
  { target: 15, suffix: "+", label: "Profiles shared with consent" },
] as const;

function useInView(threshold = 0.35): {
  ref: RefObject<HTMLElement | null>;
  visible: boolean;
} {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
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

function CountUp({
  target,
  run,
  duration = 1600,
}: {
  target: number;
  run: boolean;
  duration?: number;
}) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, target, duration]);
  return <>{val}</>;
}

export function HubStatsStrip() {
  const { ref, visible } = useInView(0.4);
  const reduce = useSafeReducedMotion();
  const run = reduce || visible;

  return (
    <section ref={ref} className="hub-stats" aria-label="Platform statistics">
      <div className="hub-shell hub-stats-grid">
        {STATS.map((stat) => (
          <div key={stat.label} className="hub-stat">
            <p className="hub-stat-value">
              <CountUp target={stat.target} run={run} />
              {stat.suffix}
            </p>
            <p className="hub-stat-label">{stat.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
