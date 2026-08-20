"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, Lock, SkipForward } from "lucide-react";
import type { ProgramMissionType } from "@prisma/client";
import type { CurriculumDay, DayState } from "@/features/program/progression";
import { cn } from "@/lib/utils";

const MISSION_LABEL: Record<ProgramMissionType, string> = {
  CODE_SPRINT: "Code Sprint",
  SHIP_IT: "Ship It",
  DATA_ROOM: "Data Room",
  PROMPT_FORGE: "Prompt Forge",
  BOSS_BUILD: "Boss Build",
};

const ALL_TYPES = Object.keys(MISSION_LABEL) as ProgramMissionType[];

function StateIcon({ state }: { state: DayState }) {
  switch (state) {
    case "PASSED":
      return <CheckCircle2 className="size-4 text-emerald-500" />;
    case "SKIPPED":
      return <SkipForward className="size-4 text-amber-500" />;
    case "AVAILABLE":
      return <Circle className="size-4 animate-pulse text-primary" />;
    default:
      return <Lock className="size-4 text-muted-foreground/60" />;
  }
}

export function CurriculumMap({
  modules,
  days,
}: {
  modules: {
    number: number;
    title: string;
    subtitle: string;
    color: string;
  }[];
  days: CurriculumDay[];
}) {
  const [filter, setFilter] = useState<ProgramMissionType | "ALL">("ALL");

  const filteredDays = useMemo(
    () =>
      filter === "ALL" ? days : days.filter((d) => d.missionType === filter),
    [days, filter],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilter("ALL")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium",
            filter === "ALL"
              ? "border-primary bg-primary/10 text-primary"
              : "text-muted-foreground",
          )}
        >
          All types
        </button>
        {ALL_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setFilter(t)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              filter === t
                ? "border-primary bg-primary/10 text-primary"
                : "text-muted-foreground",
            )}
          >
            {MISSION_LABEL[t]}
          </button>
        ))}
      </div>

      {modules.map((module) => {
        const moduleDays = filteredDays.filter(
          (d) => d.moduleNumber === module.number,
        );
        if (moduleDays.length === 0) return null;
        return (
          <section key={module.number} className="space-y-3">
            <div className="flex items-center gap-2">
              <span
                className="size-3 rounded-full"
                style={{ backgroundColor: module.color }}
                aria-hidden
              />
              <h2 className="font-display text-lg font-semibold">
                Phase {module.number} · {module.title}
              </h2>
            </div>
            <p className="text-sm text-muted-foreground">{module.subtitle}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {moduleDays.map((day) => {
                const locked = day.state === "LOCKED";
                const inner = (
                  <div
                    className={cn(
                      "flex h-full flex-col gap-2 rounded-xl border p-3 transition-colors",
                      locked
                        ? "border-border/60 bg-muted/30"
                        : "border-border bg-card hover:border-primary/50 hover:bg-muted/40",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Day {day.dayNumber}
                      </span>
                      <StateIcon state={day.state} />
                    </div>
                    <p className="line-clamp-2 text-sm font-medium">{day.title}</p>
                    <span className="mt-auto inline-flex w-fit items-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {MISSION_LABEL[day.missionType]}
                    </span>
                  </div>
                );
                if (locked) return <div key={day.dayNumber}>{inner}</div>;
                return (
                  <Link
                    key={day.dayNumber}
                    href={`/program/day/${day.dayNumber}`}
                    className="focus-spark"
                  >
                    {inner}
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
