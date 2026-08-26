"use client";

import Link from "next/link";
import { CheckCircle2, Lock, Monitor } from "lucide-react";
import { dsButtonVariants } from "@/components/design/ds-button";
import type { HeatmapCell } from "@/features/dashboard/get-heatmap-data";
import { mapHeatmapCellToUiState } from "@/features/claude/map-day-ui-state";
import { cn } from "@/lib/utils";

type Props = {
  cells: HeatmapCell[];
  currentDay: number;
  enrollmentId: string;
};

const startClass = dsButtonVariants({ size: "sm" });

function dayHref(enrollmentId: string, dayNumber: number) {
  return `/claude/day/${dayNumber}?challenge=${encodeURIComponent(enrollmentId)}`;
}

export function ClaudeDayList({ cells, currentDay, enrollmentId }: Props) {
  return (
    <div
      id="claude-days"
      className="scroll-mt-24 overflow-hidden rounded-[12px] border border-[#E0E0E0] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
    >
      <div className="flex items-center gap-2.5 px-6 py-5">
        <Monitor className="size-5 shrink-0 text-[#4B4B4B]" aria-hidden />
        <h2 className="ml-2 font-heading text-xl leading-[26px] font-semibold text-[#E05226]">
          Days
        </h2>
      </div>
      <div className="max-h-[min(70vh,720px)] space-y-3 overflow-y-auto border-t border-[#E0E0E0] px-6 py-5">
        {cells.map((cell) => {
          const state = mapHeatmapCellToUiState(cell, currentDay);
          const title = cell.taskTitle?.trim() || `Day ${cell.dayNumber}`;
          const href = dayHref(enrollmentId, cell.dayNumber);
          const locked = state === "locked";

          return (
            <div
              key={cell.dayNumber}
              className={cn(
                "flex flex-col gap-3 rounded-[12px] border border-transparent bg-[#FBF9F7] px-5 py-4 transition-colors sm:flex-row sm:items-center sm:justify-between",
                locked
                  ? "opacity-70"
                  : "hover:border-[#E05226] hover:bg-[#FFECE3]",
              )}
            >
              <div className="min-w-0">
                <p className="text-[12px] leading-4 font-semibold uppercase text-[#8F8F8F]">
                  Day {cell.dayNumber}
                </p>
                <p className="text-[17px] leading-7 font-semibold text-[#111111]">
                  {title}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-3">
                {state === "available" ? (
                  <Link href={href} className={startClass}>
                    {cell.dayNumber === currentDay
                      ? "Start Challenge"
                      : "Submit"}
                  </Link>
                ) : null}
                {state === "completed" ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 text-[14px] leading-[21px] font-semibold text-[#2E7D32]">
                      <CheckCircle2 className="size-5" aria-hidden />
                      Completed
                    </span>
                    <Link
                      href={href}
                      className="text-[14px] leading-[21px] text-[#E05226] hover:underline"
                    >
                      View
                    </Link>
                  </>
                ) : null}
                {state === "window_closed" ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 text-[14px] leading-[21px] text-[#8F8F8F]">
                      Window closed
                    </span>
                    <Link
                      href={href}
                      className="text-[14px] leading-[21px] text-[#E05226] hover:underline"
                    >
                      View
                    </Link>
                  </>
                ) : null}
                {state === "locked" ? (
                  <span className="inline-flex items-center gap-1.5 text-[14px] leading-[21px] text-[#8F8F8F]">
                    <Lock className="size-4" aria-hidden />
                    Not Unlocked
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
