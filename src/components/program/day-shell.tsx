"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, Lock, SkipForward } from "lucide-react";
import type {
  CurriculumDay,
  CurriculumModule,
  DayState,
} from "@/features/program/progression";
import { cn } from "@/lib/utils";

function StateIcon({ state }: { state: DayState }) {
  switch (state) {
    case "PASSED":
      return <CheckCircle2 className="size-4 text-emerald-400" />;
    case "SKIPPED":
      return <SkipForward className="size-4 text-amber-400" />;
    case "AVAILABLE":
      return <Circle className="size-4 animate-pulse text-[#968BEC]" />;
    default:
      return <Lock className="size-4 text-[#8F8F8F]" />;
  }
}

function DaySidebar({
  currentDay,
  moduleNumber,
  moduleTitle,
  days,
  modules,
}: {
  currentDay: number;
  moduleNumber: number;
  moduleTitle: string;
  days: CurriculumDay[];
  modules: CurriculumModule[];
}) {
  const activeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({
      block: "nearest",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [currentDay]);

  return (
    <aside className="sticky top-20 flex h-auto max-h-[50vh] flex-col overflow-hidden rounded-[20px] border border-[#8365E3] bg-[#040B1C] lg:h-[calc(100svh-5.5rem)] lg:max-h-none">
      <div className="shrink-0 border-b border-[#8365E3]/40 bg-gradient-to-b from-[#7528C9]/30 to-transparent px-4 py-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#968BEC]">
          Phase {moduleNumber}
        </p>
        <p className="mt-1 text-sm font-medium text-white">{moduleTitle}</p>
        <p className="mt-3 font-display text-2xl font-bold text-white/90">
          Day {currentDay}
        </p>
      </div>
      <nav
        className="scrollbar-program-purple min-h-0 flex-1 space-y-4 overflow-y-auto p-3 pr-2"
        aria-label="Course phases and days"
      >
        {modules.map((mod) => {
          const moduleDays = days.filter((d) => d.moduleNumber === mod.number);
          return (
            <div key={mod.number}>
              <div className="mb-1.5 flex items-center gap-2 px-2">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: mod.color }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#968BEC]">
                    Phase {mod.number}
                  </p>
                  <h3 className="truncate text-sm font-medium text-white">
                    {mod.title}
                  </h3>
                </div>
              </div>
              <div className="space-y-0.5">
                {moduleDays.map((d) => {
                  const locked = d.state === "LOCKED";
                  const active = d.dayNumber === currentDay;
                  const className = cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    active
                      ? "bg-[#7364E6]/25 text-white"
                      : locked
                        ? "cursor-not-allowed text-[#8F8F8F]"
                        : "text-[#BCBCBC] hover:bg-white/5 hover:text-white",
                  );

                  if (locked) {
                    return (
                      <span
                        key={d.dayNumber}
                        ref={
                          active
                            ? (node) => {
                                activeRef.current = node;
                              }
                            : undefined
                        }
                        className={className}
                      >
                        <StateIcon state={d.state} />
                        <span className="truncate">
                          Day {d.dayNumber}
                          <span className="ml-1 hidden text-xs opacity-70 sm:inline">
                            · {d.title}
                          </span>
                        </span>
                      </span>
                    );
                  }

                  return (
                    <Link
                      key={d.dayNumber}
                      href={`/program/day/${d.dayNumber}`}
                      className={className}
                      aria-current={active ? "page" : undefined}
                      ref={
                        active
                          ? (node) => {
                              activeRef.current = node;
                            }
                          : undefined
                      }
                    >
                      <StateIcon state={d.state} />
                      <span className="truncate">
                        Day {d.dayNumber}
                        <span className="ml-1 hidden text-xs opacity-70 sm:inline">
                          · {d.title}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function DayMetaTag({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "required";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-3 py-1 text-xs font-semibold md:text-sm",
        variant === "required"
          ? "border-[#FF4B4B]/60 bg-[#FF4B4B]/10 text-[#FF8A8A]"
          : "border-[#8365E3]/50 bg-[#110528] text-[#BCBCBC]",
      )}
    >
      {children}
    </span>
  );
}

export function DayShell({
  dayNumber,
  dayTitle,
  moduleNumber,
  moduleTitle,
  days,
  modules,
  estimatedMin,
  missionPoints,
  children,
}: {
  dayNumber: number;
  dayTitle: string;
  moduleNumber: number;
  moduleTitle: string;
  days: CurriculumDay[];
  modules: CurriculumModule[];
  estimatedMin: number;
  missionPoints: number;
  children: React.ReactNode;
}) {
  return (
    <div className="-mx-4 -my-6 min-h-[calc(100svh-4rem)] bg-[#030712] px-4 py-6 text-white md:-mx-4 md:px-6">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(240px,352px)_1fr] lg:items-stretch">
        <div className="hidden lg:block">
          <DaySidebar
            currentDay={dayNumber}
            moduleNumber={moduleNumber}
            moduleTitle={moduleTitle}
            days={days}
            modules={modules}
          />
        </div>

        <div className="min-w-0 space-y-5">
          <div className="relative overflow-hidden rounded-[16px] border border-[#8365E3]/30 bg-gradient-to-br from-[#7528C9]/40 via-[#110528] to-[#030712] px-5 py-6 md:px-7 md:py-8">
            <p className="text-xs font-bold uppercase tracking-wider text-[#968BEC]">
              Day {dayNumber}
            </p>
            <h1 className="mt-1.5 max-w-3xl font-display text-xl font-bold tracking-tight text-white md:text-2xl">
              {dayTitle}
            </h1>
            <div className="mt-4 flex flex-wrap gap-2">
              <DayMetaTag>{missionPoints} pts</DayMetaTag>
              <DayMetaTag>~{estimatedMin} min est.</DayMetaTag>
              <DayMetaTag variant="required">Required</DayMetaTag>
            </div>
          </div>

          {/* Mobile day rail */}
          <div className="lg:hidden">
            <DaySidebar
              currentDay={dayNumber}
              moduleNumber={moduleNumber}
              moduleTitle={moduleTitle}
              days={days}
              modules={modules}
            />
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
