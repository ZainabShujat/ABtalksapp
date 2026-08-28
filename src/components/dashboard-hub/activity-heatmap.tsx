"use client";

import { useEffect, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { IST, parseCalendarKeyToUtcDate } from "@/lib/date-utils";
import {
  HEATMAP_MONTHS,
  type ActivityCell,
} from "@/features/dashboard/get-activity-heatmap";
import { cn } from "@/lib/utils";

const LEVEL_CLASS: Record<ActivityCell["level"], string> = {
  0: "bg-neutral-100",
  1: "bg-emerald-200",
  2: "bg-emerald-400",
  3: "bg-emerald-600",
  4: "bg-emerald-800",
};

const ROW_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

type ActivityHeatmapProps = {
  cells: ActivityCell[];
  embedded?: boolean;
};

function formatTooltipDate(dateKey: string): string {
  const d = parseCalendarKeyToUtcDate(dateKey);
  return formatInTimeZone(d, IST, "d MMM yyyy");
}

function getTooltipText(count: number, dateKey: string): string {
  return count === 0
    ? `No submissions on ${formatTooltipDate(dateKey)}`
    : `${count} submission${count === 1 ? "" : "s"} on ${formatTooltipDate(dateKey)}`;
}

function monthLabelForColumn(
  cells: ActivityCell[],
  colIndex: number,
): string | null {
  const firstRowCell = cells[colIndex * 7];
  if (!firstRowCell) return null;
  const month = formatInTimeZone(
    parseCalendarKeyToUtcDate(firstRowCell.date),
    IST,
    "MMM",
  );
  if (colIndex === 0) return month;
  const prevColCell = cells[(colIndex - 1) * 7];
  if (!prevColCell) return month;
  const prevMonth = formatInTimeZone(
    parseCalendarKeyToUtcDate(prevColCell.date),
    IST,
    "MMM",
  );
  return month !== prevMonth ? month : null;
}

const CELL_CLASS =
  "rounded-[4px] border border-neutral-200/80 transition-transform duration-200 ease-[var(--ease-spark)] motion-safe:hover:z-10 motion-safe:hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#E05226]";

function HeatmapCell({
  cell,
  className,
  active,
  onHover,
  onLeave,
}: {
  cell: ActivityCell | null;
  className?: string;
  active: boolean;
  onHover: (count: number, date: string) => void;
  onLeave: () => void;
}) {
  if (!cell) {
    return <span className={className} aria-hidden />;
  }
  const label = getTooltipText(cell.count, cell.date);
  return (
    <div className="relative flex items-center justify-center">
      {active ? (
        <div className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-black px-2 py-1 text-[10px] font-medium text-white shadow-sm">
          {label}
        </div>
      ) : null}
      <button
        type="button"
        aria-label={label}
        className={cn(CELL_CLASS, LEVEL_CLASS[cell.level], className)}
        onMouseEnter={() => onHover(cell.count, cell.date)}
        onMouseLeave={onLeave}
        onFocus={() => onHover(cell.count, cell.date)}
        onBlur={onLeave}
        onTouchStart={() => onHover(cell.count, cell.date)}
      />
    </div>
  );
}

export function ActivityHeatmap({ cells, embedded = false }: ActivityHeatmapProps) {
  const [tooltip, setTooltip] = useState<{
    count: number;
    date: string;
  } | null>(null);

  const weekCount = Math.ceil(cells.length / 7);
  const gridCols = `1.5rem repeat(${weekCount}, minmax(0, 1fr))`;

  const setTooltipFromCell = (count: number, date: string) =>
    setTooltip({ count, date });
  const clearTooltip = () => setTooltip(null);

  const Wrapper = embedded ? "div" : "section";
  const wrapperClass = embedded
    ? "w-full min-w-0 flex flex-col lg:min-h-[350px]"
    : "scroll-mt-20 px-4 py-8 sm:px-6";

  return (
    <Wrapper className={wrapperClass}>
      <h2
        className={cn(
          "text-center font-heading font-semibold uppercase text-[#e05226]",
          embedded ? "text-base" : "text-xl",
        )}
      >
        Last {HEATMAP_MONTHS} months activity
      </h2>

      <div
        className={cn(
          "mt-3 grid w-full min-w-0 gap-[2px] sm:gap-[3px]",
          embedded && "flex-1 lg:min-h-0",
        )}
        style={{ gridTemplateColumns: gridCols }}
      >
        <span className="h-3 sm:h-4" aria-hidden />
        {Array.from({ length: weekCount }, (_, col) => (
          <span
            key={`month-${col}`}
            className="h-3 truncate text-[9px] leading-3 text-neutral-400 sm:h-4 sm:text-[10px] sm:leading-4"
          >
            {monthLabelForColumn(cells, col) ?? ""}
          </span>
        ))}

        {ROW_LABELS.map((label, rowIdx) => (
          <div key={`row-${rowIdx}`} className="contents">
            <span className="flex items-center text-[9px] text-neutral-400 sm:text-[10px]">
              {label}
            </span>
            {Array.from({ length: weekCount }, (_, col) => {
              const cell = cells[col * 7 + rowIdx] ?? null;
              return (
                <HeatmapCell
                  key={cell?.date ?? `empty-${col}-${rowIdx}`}
                  cell={cell}
                  className="aspect-square w-[88%] min-w-0 justify-self-center"
                  active={tooltip?.date === cell?.date}
                  onHover={setTooltipFromCell}
                  onLeave={clearTooltip}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-3 flex justify-end">
        <div className="flex shrink-0 items-center gap-1 self-end text-[10px] text-neutral-400 sm:self-auto">
          <span>Less</span>
          {([0, 1, 2, 3, 4] as const).map((level) => (
            <span
              key={level}
              className={cn("size-[9px] rounded-[4px] sm:size-[10px]", LEVEL_CLASS[level])}
              aria-hidden
            />
          ))}
          <span>More</span>
        </div>
      </div>
    </Wrapper>
  );
}
