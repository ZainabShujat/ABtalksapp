"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type {
  CurriculumDay,
  CurriculumModule,
} from "@/features/program/progression";
import { cn } from "@/lib/utils";

export function DaySidebar({
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
    <aside className="sticky top-20 flex h-auto max-h-[50vh] flex-col overflow-hidden rounded-[12px] border border-[#E0E0E0] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] lg:h-[calc(100svh-5.5rem)] lg:max-h-none">
      <div className="shrink-0 border-b border-[#E0E0E0] px-4 py-5">
        <p className="font-heading text-[13px] leading-[18px] font-semibold uppercase tracking-wider text-[#E05226]">
          Modules
        </p>
        <p className="mt-1 text-sm font-medium text-[#111111]">
          Module {moduleNumber} · {moduleTitle}
        </p>
        <p className="mt-3 font-heading text-2xl font-semibold text-[#111111]">
          Day {currentDay}
        </p>
      </div>
      <nav
        className="scrollbar-program-purple min-h-0 flex-1 space-y-4 overflow-y-auto p-3 pr-2"
        aria-label="Course modules and days"
      >
        {modules.map((mod) => {
          const moduleDays = days.filter((d) => d.moduleNumber === mod.number);
          return (
            <div key={mod.number}>
              <div className="mb-1.5 min-w-0 px-2">
                <p className="font-heading text-[13px] leading-[18px] font-semibold text-[#E05226]">
                  Module {mod.number}
                </p>
                <h3 className="truncate text-sm font-medium text-[#111111]">
                  {mod.title}
                </h3>
              </div>
              <div className="space-y-0.5">
                {moduleDays.map((d) => {
                  const locked = d.state === "LOCKED";
                  const active = d.dayNumber === currentDay;
                  const className = cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    active
                      ? "bg-[#FFECE3] text-[#E05226]"
                      : locked
                        ? "cursor-not-allowed text-[#8F8F8F]"
                        : "text-[#4B4B4B] hover:bg-[#FFECE3] hover:text-[#111111]",
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
