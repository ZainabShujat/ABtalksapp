"use client";

import { useEffect, useRef, useState } from "react";
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

/** Base mobile cell size (px); +15% for mobile heatmap footprint. */
const MOBILE_CELL_SIZE_PX = 11.5;
const MOBILE_ROW_LABEL_REM = 1.725;

type ActivityHeatmapProps = {
  cells: ActivityCell[];
  totalSubmissions: number;
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

function HeatmapGrid({
  cells,
  weekCount,
  gridCols,
  cellClassName,
  tooltipDate,
  onHover,
  onLeave,
  className,
  variant = "desktop",
}: {
  cells: ActivityCell[];
  weekCount: number;
  gridCols: string;
  cellClassName: string;
  tooltipDate: string | undefined;
  onHover: (count: number, date: string) => void;
  onLeave: () => void;
  className?: string;
  variant?: "mobile" | "desktop";
}) {
  const isMobile = variant === "mobile";

  return (
    <div
      className={cn(
        "grid",
        isMobile ? "gap-[3px]" : "gap-[2px] sm:gap-[3px]",
        className,
      )}
      style={{ gridTemplateColumns: gridCols }}
    >
      <span className={cn(isMobile ? "h-4" : "h-3 sm:h-4")} aria-hidden />
      {Array.from({ length: weekCount }, (_, col) => {
        const monthLabel = monthLabelForColumn(cells, col);
        if (isMobile) {
          return (
            <span key={`month-${col}`} className="relative h-4">
              {monthLabel ? (
                <span className="absolute left-0 top-0 whitespace-nowrap text-[9px] leading-none text-neutral-400">
                  {monthLabel}
                </span>
              ) : null}
            </span>
          );
        }
        return (
          <span
            key={`month-${col}`}
            className="h-3 truncate text-[9px] leading-3 text-neutral-400 sm:h-4 sm:text-[10px] sm:leading-4"
          >
            {monthLabel ?? ""}
          </span>
        );
      })}

      {ROW_LABELS.map((label, rowIdx) => (
        <div key={`row-${rowIdx}`} className="contents">
          <span
            className={cn(
              "flex items-center text-neutral-400",
              isMobile ? "text-[10px]" : "text-[9px] sm:text-[10px]",
            )}
          >
            {label}
          </span>
          {Array.from({ length: weekCount }, (_, col) => {
            const cell = cells[col * 7 + rowIdx] ?? null;
            return (
              <HeatmapCell
                key={cell?.date ?? `empty-${col}-${rowIdx}`}
                cell={cell}
                className={cellClassName}
                active={tooltipDate === cell?.date}
                onHover={onHover}
                onLeave={onLeave}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function ActivityHeatmap({
  cells,
  totalSubmissions,
  embedded = false,
}: ActivityHeatmapProps) {
  const [tooltip, setTooltip] = useState<{
    count: number;
    date: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const weekCount = Math.ceil(cells.length / 7);
  const mobileGridCols = `${MOBILE_ROW_LABEL_REM}rem repeat(${weekCount}, ${MOBILE_CELL_SIZE_PX}px)`;
  const desktopGridCols = `1.5rem repeat(${weekCount}, minmax(0, 1fr))`;

  const setTooltipFromCell = (count: number, date: string) =>
    setTooltip({ count, date });
  const clearTooltip = () => setTooltip(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
  }, [weekCount]);

  const Wrapper = embedded ? "div" : "section";
  // lg/xl (laptop) trims the grid ~10% inside its own column — the dashboard
  // grid columns are untouched, so the streak card never moves. 2xl opts out.
  const wrapperClass = embedded
    ? "w-full min-w-0 flex flex-col max-lg:-mx-4 max-lg:w-[calc(100%+2rem)] lg:min-h-[315px] lg:max-w-[90%] 2xl:max-w-none"
    : "scroll-mt-20 px-4 py-8 sm:px-6";

  const gridSharedProps = {
    cells,
    weekCount,
    tooltipDate: tooltip?.date,
    onHover: setTooltipFromCell,
    onLeave: clearTooltip,
  };

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

      {/* Mobile: fixed cell size + horizontal scroll with orange scrollbar */}
      <div
        ref={scrollRef}
        className="scrollbar-admin-orange mt-3 overflow-x-auto overscroll-x-contain pb-1.5 pl-5 lg:hidden"
      >
        <HeatmapGrid
          {...gridSharedProps}
          variant="mobile"
          gridCols={mobileGridCols}
          cellClassName="size-[11.5px] shrink-0"
          className="w-max"
        />
      </div>

      {/* Desktop: fluid grid, smaller cells */}
      <HeatmapGrid
        {...gridSharedProps}
        variant="desktop"
        gridCols={desktopGridCols}
        cellClassName="aspect-square w-[72%] min-w-0 justify-self-center"
        className={cn(
          "mt-3 hidden w-full min-w-0 lg:grid",
          embedded && "flex-1 lg:min-h-0",
        )}
      />

      <p className="mt-2 ml-3 font-fredoka text-sm text-[#555555]">
        {totalSubmissions} submission{totalSubmissions === 1 ? "" : "s"} in the
        last {HEATMAP_MONTHS} months
      </p>

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
