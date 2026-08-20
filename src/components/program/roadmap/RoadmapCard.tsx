"use client";

import { CalendarDays } from "lucide-react";
import { motion } from "framer-motion";
import type { RoadmapPhase } from "@/data/roadmap";
import { useSafeReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

const ease = [0.22, 1, 0.36, 1] as const;

export function RoadmapCard({
  phase,
  index,
  active,
}: {
  phase: RoadmapPhase;
  index: number;
  active: boolean;
}) {
  const reduceMotion = useSafeReducedMotion();
  const Icon = phase.icon;
  const slideFrom = index % 2 === 0 ? 48 : 32;

  return (
    <motion.article
      className={cn(
        "group relative w-full max-w-[640px] cursor-default rounded-xl border px-3 py-2.5 backdrop-blur-sm transition-[box-shadow,border-color,background-color] duration-200 md:px-3.5 md:py-2.5",
        index % 2 === 0 ? "md:ml-[6%]" : "md:ml-[14%]",
      )}
      style={{
        borderColor: `rgba(${phase.accentRgb}, 0.45)`,
        backgroundColor: "rgba(8, 12, 28, 0.72)",
        boxShadow: active
          ? `0 0 0 1px rgba(${phase.accentRgb}, 0.12), 0 4px 24px rgba(${phase.accentRgb}, 0.16), inset 0 1px 0 rgba(255,255,255,0.04)`
          : "0 4px 16px rgba(0,0,0,0.2)",
      }}
      initial={false}
      animate={
        active
          ? {
              opacity: 1,
              x: 0,
              scale: 1,
            }
          : {
              opacity: reduceMotion ? 0.35 : 0,
              x: reduceMotion ? 0 : slideFrom,
              scale: reduceMotion ? 1 : 0.98,
            }
      }
      transition={
        reduceMotion
          ? { duration: 0.2 }
          : { duration: 0.45, ease }
      }
      whileHover={
        reduceMotion
          ? undefined
          : {
              y: -4,
              boxShadow: `0 8px 40px rgba(${phase.accentRgb}, 0.28), inset 0 1px 0 rgba(255,255,255,0.06)`,
              borderColor: `rgba(${phase.accentRgb}, 0.55)`,
              backgroundColor: "rgba(12, 16, 36, 0.88)",
            }
      }
    >
      <motion.span
        className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 select-none font-semibold italic leading-none tracking-tight md:right-4"
        style={{
          color: `rgba(${phase.accentRgb}, 0.2)`,
          fontSize: "clamp(2.25rem, 5vw, 3.25rem)",
        }}
        initial={false}
        animate={{ opacity: active ? 1 : 0 }}
        transition={{ duration: reduceMotion ? 0.15 : 0.35, ease, delay: 0.08 }}
        aria-hidden
      >
        {phase.displayNumber}
      </motion.span>

      <div className="relative flex items-center gap-3">
        <motion.div
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border md:size-10"
          style={{
            borderColor: `rgba(${phase.accentRgb}, 0.4)`,
            backgroundColor: `rgba(${phase.accentRgb}, 0.12)`,
            boxShadow: `0 0 16px rgba(${phase.accentRgb}, 0.15)`,
          }}
          initial={false}
          animate={{ scale: active ? 1 : 0.85, opacity: active ? 1 : 0.5 }}
          transition={{ duration: reduceMotion ? 0.15 : 0.35, ease }}
          whileHover={reduceMotion ? undefined : { scale: 1.05 }}
        >
          <Icon className="size-4 text-white md:size-5" strokeWidth={1.75} />
        </motion.div>

        <div className="min-w-0 flex-1 pr-14 md:pr-24">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span
              className="inline-flex rounded-full px-2 py-px text-[10px] font-semibold tracking-wide text-white"
              style={{ backgroundColor: phase.accent }}
            >
              Phase {phase.phase}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-2 py-px text-[10px] text-[#E9E9E9] md:text-xs">
              <CalendarDays className="size-3 opacity-70" />
              {phase.days}
            </span>
          </div>
          <h3 className="mt-1 text-sm font-semibold text-white md:text-base">
            {phase.title}
          </h3>
          <p className="truncate text-xs text-[#9CA3AF] md:text-[13px]">
            {phase.subtitle}
          </p>
        </div>
      </div>
    </motion.article>
  );
}
