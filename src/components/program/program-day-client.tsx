"use client";

import type {
  CurriculumDay,
  CurriculumModule,
} from "@/features/program/progression";
import { DayShell } from "@/components/program/day-shell";

export function ProgramDayClient({
  dayNumber,
  dayTitle,
  moduleNumber,
  moduleTitle,
  days,
  modules,
  estimatedMin,
  missionPoints,
  basePath,
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
  basePath?: string;
  children: React.ReactNode;
}) {
  return (
    <DayShell
      dayNumber={dayNumber}
      dayTitle={dayTitle}
      moduleNumber={moduleNumber}
      moduleTitle={moduleTitle}
      days={days}
      modules={modules}
      estimatedMin={estimatedMin}
      missionPoints={missionPoints}
      basePath={basePath}
    >
      {children}
    </DayShell>
  );
}
