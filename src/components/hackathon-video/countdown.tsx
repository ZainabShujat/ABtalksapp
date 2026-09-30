"use client";

import { useEffect, useState } from "react";

type Props = {
  kickoffUtc: string;
  deadlineUtc: string;
};

type Phase = "PRE" | "LIVE" | "ENDED";

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function resolve(now: number, kickoff: number, deadline: number) {
  if (now < kickoff) return { phase: "PRE" as Phase, target: kickoff };
  if (now < deadline) return { phase: "LIVE" as Phase, target: deadline };
  return { phase: "ENDED" as Phase, target: deadline };
}

function breakdown(ms: number) {
  if (ms <= 0) return { d: 0, h: 0, m: 0, s: 0 };
  const s = Math.floor(ms / 1000);
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}

/**
 * Cinematic countdown for the VideoThon hero.
 *
 * Renders placeholder zeros before mount to avoid an SSR/CSR flicker; the
 * effect ticks once a second and swaps in real values on hydration.
 */
export function VideothonCountdown({ kickoffUtc, deadlineUtc }: Props) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const kickoff = new Date(kickoffUtc).getTime();
  const deadline = new Date(deadlineUtc).getTime();

  const state =
    now == null
      ? { phase: "PRE" as Phase, target: kickoff }
      : resolve(now, kickoff, deadline);

  const { d, h, m, s } =
    now == null ? { d: 0, h: 0, m: 0, s: 0 } : breakdown(state.target - now);

  const phaseLabel =
    state.phase === "PRE"
      ? "Starts in"
      : state.phase === "LIVE"
        ? "Ends in"
        : "Wrapped";

  return (
    <div className="vt-count" aria-live="polite">
      <span className="vt-count__phase" data-phase={state.phase}>
        {phaseLabel}
      </span>
      {state.phase === "ENDED" ? null : (
        <>
          <div className="vt-count__tile">
            <span className="vt-count__num">{pad(d)}</span>
            <span className="vt-count__label">Days</span>
          </div>
          <div className="vt-count__tile">
            <span className="vt-count__num">{pad(h)}</span>
            <span className="vt-count__label">Hrs</span>
          </div>
          <div className="vt-count__tile">
            <span className="vt-count__num">{pad(m)}</span>
            <span className="vt-count__label">Min</span>
          </div>
          <div className="vt-count__tile">
            <span className="vt-count__num">{pad(s)}</span>
            <span className="vt-count__label">Sec</span>
          </div>
        </>
      )}
    </div>
  );
}
