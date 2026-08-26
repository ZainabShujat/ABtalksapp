"use client";

import { useState, useEffect } from "react";

/** Shared ticker so both layouts below run off the same clock. */
export function useCountdown(targetUtc: string) {
  const [mounted, setMounted] = useState(false);
  const [time, setTime] = useState({ d: 0, h: 0, m: 0, s: 0 });

  useEffect(() => {
    setMounted(true);
    const target = new Date(targetUtc).getTime();
    const tick = () => {
      const diff = Math.max(0, target - Date.now());
      setTime({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetUtc]);

  const pad = (n: number) => (mounted ? n.toString().padStart(2, "0") : "--");
  return [
    { val: pad(time.d), label: "Days" },
    { val: pad(time.h), label: "hrs" },
    { val: pad(time.m), label: "Min" },
    { val: pad(time.s), label: "Sec" },
  ];
}

/**
 * Exact design geometry — Figma node 1:140, a 348×82 box.
 * Boxes at x 0/87/174/261 (67×41), colons at 75/162/249, labels at
 * 18/108/196/283. Used inside the scaled hero canvas.
 */
export function CountdownExact({ targetUtc }: { targetUtc: string }) {
  const units = useCountdown(targetUtc);
  const boxX = [0, 87, 174, 261];
  const colonX = [75, 162, 249];
  const labelX = [18, 108, 196, 283];

  return (
    <div style={{ position: "relative", width: 348, height: 82 }}>
      {units.map((u, i) => (
        <div
          key={u.label}
          style={{
            position: "absolute",
            left: boxX[i],
            top: 16,
            width: 67,
            height: 41,
            borderRadius: 8,
            background: "var(--wk-navy-box)",
            border: "1px solid var(--wk-navy-box-border)",
          }}
        >
          <span
            style={{
              position: "absolute",
              left: 20,
              top: 7,
              fontSize: 24,
              lineHeight: 1.1,
              fontWeight: 500,
              color: "#ffffff",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {u.val}
          </span>
        </div>
      ))}

      {colonX.map((x) => (
        <span
          key={x}
          aria-hidden
          style={{
            position: "absolute",
            left: x,
            top: 32,
            fontSize: 12,
            lineHeight: 1.1,
            fontWeight: 500,
            color: "#a5a5a5",
          }}
        >
          :
        </span>
      ))}

      {units.map((u, i) => (
        <span
          key={`${u.label}-l`}
          style={{
            position: "absolute",
            left: labelX[i],
            top: 62,
            fontSize: 12,
            lineHeight: 1.1,
            fontWeight: 500,
            textTransform: "uppercase",
            color: "#d2d2d2",
          }}
        >
          {u.label}
        </span>
      ))}
    </div>
  );
}

/** Responsive flow layout, used below the canvas breakpoint. */
export default function CountdownTimer({ targetUtc }: { targetUtc: string }) {
  const units = useCountdown(targetUtc);

  return (
    <div className="inline-flex items-start gap-3">
      {units.map((u, i) => (
        <div key={u.label} className="flex items-start gap-3">
          {i > 0 && (
            <span
              aria-hidden
              className="mt-[14px] text-[12px] font-medium leading-none"
              style={{ color: "#a5a5a5" }}
            >
              :
            </span>
          )}
          <div className="flex flex-col items-center gap-2">
            <div
              className="flex h-[41px] w-[58px] items-center justify-center rounded-[8px]"
              style={{
                background: "var(--wk-navy-box)",
                border: "1px solid var(--wk-navy-box-border)",
              }}
            >
              <span className="text-[22px] font-medium leading-none tabular-nums text-white">
                {u.val}
              </span>
            </div>
            <span
              className="text-[12px] font-medium uppercase leading-none"
              style={{ color: "#d2d2d2" }}
            >
              {u.label}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
