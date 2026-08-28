"use client";

import { useEffect, useRef } from "react";
import { useSafeReducedMotion } from "@/lib/motion";
import { smoothstep } from "./motion/scroll-engine";
import { STATS } from "./landing-content";

const UP = 1200;
const HOLD = 2000;
const DOWN = 1100;
const CYCLE = UP + HOLD + DOWN;

export function StatsStrip() {
  const reduce = useSafeReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const numRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const items = STATS.map((stat, i) => ({
      el: numRefs.current[i],
      target: stat.count,
      suffix: stat.suffix,
    }));

    function paint(fraction: number) {
      for (const item of items) {
        if (!item.el) continue;
        item.el.textContent =
          Math.round(item.target * fraction) + item.suffix;
      }
    }

    if (reduce) {
      paint(1);
      return;
    }

    let raf: number | null = null;
    let startTs: number | null = null;

    function frame(ts: number) {
      if (startTs === null) startTs = ts;
      const t = (ts - startTs) % CYCLE;
      let f: number;
      if (t < UP) f = 1 - Math.pow(1 - t / UP, 3);
      else if (t < UP + HOLD) f = 1;
      else f = 1 - smoothstep((t - UP - HOLD) / DOWN);
      paint(f);
      raf = window.requestAnimationFrame(frame);
    }

    function start() {
      if (raf !== null) return;
      startTs = null;
      raf = window.requestAnimationFrame(frame);
    }

    function stop() {
      if (raf === null) return;
      window.cancelAnimationFrame(raf);
      raf = null;
      paint(0);
    }

    const section = sectionRef.current;
    if (!section || !("IntersectionObserver" in window)) {
      start();
      return () => stop();
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) start();
          else stop();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(section);
    return () => {
      io.disconnect();
      stop();
    };
  }, [reduce]);

  return (
    <section className="stats" aria-label="Key numbers" ref={sectionRef}>
      <div className="container stats__grid">
        {STATS.map((stat, i) => (
          <div className="stat" key={stat.label}>
            <div
              className="stat__num"
              data-count={stat.count}
              data-suffix={stat.suffix}
              ref={(node) => {
                numRefs.current[i] = node;
              }}
            >
              0
            </div>
            <p className="stat__label">{stat.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
