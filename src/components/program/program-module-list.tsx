"use client";

import { useState } from "react";
import Link from "next/link";
import type { ProgramMissionType } from "@prisma/client";
import {
  CheckCircle2,
  ChevronDown,
  Lock,
  Monitor,
  SkipForward,
} from "lucide-react";
import { dsButtonVariants } from "@/components/design/ds-button";
import type {
  CurriculumDay,
  CurriculumModule,
} from "@/features/program/progression";
import { cn } from "@/lib/utils";

type Props = {
  modules: CurriculumModule[];
  days: CurriculumDay[];
};

const MISSION_LABEL: Record<ProgramMissionType, string> = {
  CODE_SPRINT: "Code Sprint",
  SHIP_IT: "Ship It",
  DATA_ROOM: "Data Room",
  PROMPT_FORGE: "Prompt Forge",
  BOSS_BUILD: "Boss Build",
};

const startChallengeClass = dsButtonVariants({ size: "sm" });

export function ProgramModuleList({ modules, days }: Props) {
  const [open, setOpen] = useState<number | null>(null);

  function toggle(moduleNumber: number) {
    setOpen((prev) => (prev === moduleNumber ? null : moduleNumber));
  }

  if (modules.length === 0) {
    return (
      <div className="rounded-[12px] border border-[#E0E0E0] bg-white px-6 py-5 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
        <p className="text-[17px] leading-7 text-[#4B4B4B]">
          The curriculum is being prepared. Check back soon.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[12px] border border-[#E0E0E0] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      <div className="flex items-center gap-2.5 px-6 py-5">
        <Monitor className="size-5 shrink-0 text-[#4B4B4B]" aria-hidden />
        <h3 className="ml-2 font-heading text-xl leading-[26px] font-semibold text-[#E05226]">
          Modules
        </h3>
      </div>
      <div className="border-t border-[#E0E0E0]">
        {modules.map((mod) => {
          const moduleDays = days.filter((d) => d.moduleNumber === mod.number);
          const total = moduleDays.length;
          const passed = moduleDays.filter((d) => d.state === "PASSED").length;
          const pct = total ? Math.round((passed / total) * 100) : 0;
          const isOpen = open === mod.number;
          const panelId = `program-module-${mod.number}`;

          return (
            <div key={mod.number} className="border-b border-[#E0E0E0] last:border-b-0">
              <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-4 px-6 py-5 text-left focus-visible:ring-2 focus-visible:ring-[#E05226] focus-visible:ring-offset-4 focus-visible:outline-none"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(mod.number)}
              >
                <span className="min-w-0">
                    <span className="block font-heading text-xl leading-[26px] font-semibold">
                      <span className="text-[#E05226]">Module {mod.number}</span>
                      <span className="text-[#111111]"> · {mod.title}</span>
                    </span>
                    <span className="mt-0.5 block text-[14px] leading-[21px] text-[#8F8F8F]">
                      {mod.subtitle}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-4 text-[#8F8F8F]">
                      Day {mod.startDay}–{mod.endDay}
                    </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-[14px] leading-[21px] text-[#4B4B4B]">
                    {passed}/{total} completed
                  </span>
                  <span
                    className="h-1.5 w-32 overflow-hidden rounded-full bg-[#E0E0E0]"
                    role="progressbar"
                    aria-valuenow={passed}
                    aria-valuemin={0}
                    aria-valuemax={total}
                    aria-label={`${mod.title}: ${passed} of ${total} completed`}
                  >
                    <span
                      className="block h-full rounded-full bg-[#E05226]"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-5 text-[#8F8F8F] transition-transform",
                      isOpen && "rotate-180",
                    )}
                    aria-hidden
                  />
                </span>
              </button>

              {isOpen && (
                <div id={panelId} className="px-6 pt-3 pb-5">
                  <div className="space-y-3">
                    {moduleDays.map((day) => (
                      <DayRow key={day.dayNumber} day={day} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayRow({ day }: { day: CurriculumDay }) {
  const locked = day.state === "LOCKED";

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-[12px] border border-transparent bg-[#FBF9F7] px-5 py-4 transition-colors",
        locked ? "opacity-70" : "hover:border-[#E05226] hover:bg-[#FFECE3]",
      )}
    >
      <div className="min-w-0">
        <p className="text-[12px] leading-4 font-semibold uppercase text-[#8F8F8F]">
          Day {day.dayNumber}
        </p>
        <p className="text-[17px] leading-7 font-semibold text-[#111111]">
          {day.title}
        </p>
        <span className="mt-1 inline-flex rounded-[4px] bg-[#FFECE3] px-2 py-0.5 text-[12px] font-semibold text-[#E05226]">
          {MISSION_LABEL[day.missionType]}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {day.state === "AVAILABLE" && (
          <Link
            href={`/program/day/${day.dayNumber}`}
            className={startChallengeClass}
          >
            Start Challenge
          </Link>
        )}
        {day.state === "PASSED" && (
          <>
            <span className="inline-flex items-center gap-1.5 text-[14px] leading-[21px] font-semibold text-[#2E7D32]">
              <CheckCircle2 className="size-5" aria-hidden />
              Completed
            </span>
            <Link
              href={`/program/day/${day.dayNumber}`}
              className="text-[14px] leading-[21px] text-[#E05226] hover:underline"
            >
              View
            </Link>
          </>
        )}
        {day.state === "SKIPPED" && (
          <>
            <span className="inline-flex items-center gap-1.5 text-[14px] leading-[21px] text-[#8F8F8F]">
              <SkipForward className="size-5" aria-hidden />
              Skipped
            </span>
            <Link
              href={`/program/day/${day.dayNumber}`}
              className="text-[14px] leading-[21px] text-[#E05226] hover:underline"
            >
              View
            </Link>
          </>
        )}
        {day.state === "LOCKED" && (
          <span className="inline-flex items-center gap-1.5 text-[14px] leading-[21px] text-[#8F8F8F]">
            <Lock className="size-4" aria-hidden />
            Day not unlocked
          </span>
        )}
      </div>
    </div>
  );
}
