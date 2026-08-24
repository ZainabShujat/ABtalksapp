"use client";

import type {
  CurriculumDay,
  CurriculumModule,
} from "@/features/program/progression";
import { DayHeading } from "@/components/program/day-heading";
import { DaySidebar } from "@/components/program/day-sidebar";

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
    <div className="-mx-4 -my-6 min-h-[calc(100svh-4.25rem)] bg-[#FBF9F7] px-5 py-8 font-content text-[#111111] sm:px-8">
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
          <DayHeading
            dayNumber={dayNumber}
            dayTitle={dayTitle}
            estimatedMin={estimatedMin}
            missionPoints={missionPoints}
          />

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
