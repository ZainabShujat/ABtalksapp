"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const RADIUS = 15.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type StreakRingProps = {
  value: number;
  unit: string;
  progress: number;
};

export function StreakRing({ value, unit, progress }: StreakRingProps) {
  const target = CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, progress)));
  const [offset, setOffset] = useState(CIRCUMFERENCE);

  useEffect(() => {
    const id = requestAnimationFrame(() => setOffset(target));
    return () => cancelAnimationFrame(id);
  }, [target]);

  return (
    <div
      className="relative flex size-20 shrink-0 items-center justify-center"
      aria-hidden
    >
      <svg className="size-20 -rotate-90" viewBox="0 0 36 36">
        <circle
          cx="18"
          cy="18"
          r={RADIUS}
          fill="none"
          stroke="#e5e5e5"
          strokeWidth="3"
        />
        <circle
          cx="18"
          cy="18"
          r={RADIUS}
          fill="none"
          stroke="#e05226"
          strokeWidth="3"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-500 motion-safe:ease-[var(--ease-spark)]"
        />
      </svg>
      <span className="absolute flex flex-col items-center leading-none">
        <span
          className={cn(
            "font-inter font-bold tabular-nums text-black",
            value >= 100 ? "text-lg" : "text-2xl",
          )}
        >
          {value}
        </span>
        <span className="mt-0.5 text-[9px] font-semibold tracking-wider text-[#555555] uppercase">
          {unit}
        </span>
      </span>
    </div>
  );
}
