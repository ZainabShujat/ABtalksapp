"use client";

import { useState } from "react";
import Link from "next/link";
import { BarChart3, ChevronDown, Lock, Mic } from "lucide-react";
import { dsButtonVariants } from "@/components/design/ds-button";
import { PowerBiStatsPanel } from "@/components/powerbi/powerbi-stats-panel";
import { ProgramModuleList } from "@/components/program/program-module-list";
import type { PowerBiDashboard } from "@/features/powerbi/dashboard";
import { cn } from "@/lib/utils";

type Props = {
  data: PowerBiDashboard;
};

const MISSION_LABEL: Record<string, string> = {
  CODE_SPRINT: "Code Sprint",
  SHIP_IT: "Ship It",
  DATA_ROOM: "Data Room",
  PROMPT_FORGE: "Prompt Forge",
  BOSS_BUILD: "Boss Build",
};

const ctaClass = dsButtonVariants({ size: "lg" });

export function PowerBiDashboardView({ data }: Props) {
  const [statsOpen, setStatsOpen] = useState(false);
  const [interviewOpen, setInterviewOpen] = useState(false);

  return (
    <div className="-mx-4 -my-6 min-h-[calc(100svh-4.25rem)] bg-[#FBF9F7] px-5 py-8 font-content text-[#111111] md:px-[50px]">
      <div className="mx-auto w-full max-w-[1500px] space-y-8">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            <li>
              <Link
                href="/dashboard"
                className="text-[#8F8F8F] hover:text-[#E05226]"
              >
                Dashboard
              </Link>
            </li>
            <li aria-hidden className="text-[#8F8F8F]">
              &gt;
            </li>
            <li aria-current="page" className="font-semibold text-[#111111]">
              Power BI &amp; Analytics
            </li>
          </ol>
        </nav>

        <header>
          <h1 className="ml-3 font-heading text-[32px] leading-9 font-semibold text-[#111111] md:text-[40px] md:leading-[48px]">
            Power BI &amp; Analytics
          </h1>
          <p className="font-fredoka ml-3 mt-2 text-[17px] leading-7 text-[#4B4B4B]">
            Ship recruiter-grade Power BI dashboards in 7 days
          </p>
        </header>

        <ContinueCard data={data} />

        <section>
          <div className="mt-6">
            <ProgramModuleList
              modules={data.modules}
              days={data.days}
              basePath="/program/powerbi"
            />
          </div>
        </section>

        <div className="rounded-[12px] border border-[#E0E0E0] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left focus-visible:ring-2 focus-visible:ring-[#E05226] focus-visible:ring-offset-4 focus-visible:outline-none"
            aria-expanded={statsOpen}
            aria-controls="powerbi-view-stats"
            onClick={() => setStatsOpen((v) => !v)}
          >
            <span className="flex items-center gap-2.5">
              <BarChart3 className="size-5 text-[#111111]" aria-hidden />
              <span className="font-heading text-xl leading-[26px] font-semibold text-[#111111]">
                VIEW STATS
              </span>
            </span>
            <ChevronDown
              className={cn(
                "size-5 text-[#8F8F8F] transition-transform",
                statsOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          {statsOpen && (
            <div
              id="powerbi-view-stats"
              className="border-t border-[#E0E0E0] px-6 py-6"
            >
              <PowerBiStatsPanel data={data} />
            </div>
          )}
        </div>

        <div className="rounded-[12px] border border-[#E0E0E0] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left focus-visible:ring-2 focus-visible:ring-[#E05226] focus-visible:ring-offset-4 focus-visible:outline-none"
            aria-expanded={interviewOpen}
            aria-controls="powerbi-mock-interview"
            onClick={() => setInterviewOpen((v) => !v)}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <Mic className="size-5 shrink-0 text-[#8F8F8F]" aria-hidden />
              <span className="font-heading text-xl leading-[26px] font-semibold text-[#8F8F8F]">
                Mock Interview
              </span>
              <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#F5F5F5] px-2 py-0.5 text-[12px] font-semibold text-[#8F8F8F]">
                <Lock className="size-4" aria-hidden />
                Locked
              </span>
            </span>
            <ChevronDown
              className={cn(
                "size-5 text-[#8F8F8F] transition-transform",
                interviewOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          {interviewOpen && (
            <div
              id="powerbi-mock-interview"
              className="border-t border-[#E0E0E0] px-6 py-6"
            >
              <p className="text-[17px] leading-7 text-[#4B4B4B]">
                Mock interviews for this cohort are not available yet.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function progressLines(data: PowerBiDashboard): string[] {
  if (data.clearedCount === 0) return [];
  return [`You've cleared ${data.clearedCount} of ${data.totalDays} days.`];
}

function ContinueCard({ data }: { data: PowerBiDashboard }) {
  const currentDay = data.currentDay;
  const nextDay =
    data.nextLockedDay !== null
      ? (data.days.find((d) => d.dayNumber === data.nextLockedDay) ?? null)
      : null;
  const hasStarted = data.clearedCount > 0;

  let eyebrow: string;
  let title: string;
  let supporting: string[] = [];
  let cta: string | null = null;
  let showMissionChip = false;
  let missionType: string | null = null;
  let lockedPreview = false;

  if (data.isComplete) {
    eyebrow = data.completedLate ? "COMPLETED LATE" : "COMPLETED";
    title = data.completedLate ? "Completed late" : "Completed";
    supporting = progressLines(data);
  } else if (!hasStarted && currentDay) {
    eyebrow = "GET STARTED";
    title = `Day ${currentDay.dayNumber}: ${currentDay.title}`;
    cta = `Start Day ${currentDay.dayNumber}`;
    showMissionChip = true;
    missionType = currentDay.missionType;
  } else if (hasStarted && currentDay) {
    eyebrow = "CONTINUE WHERE YOU LEFT OFF";
    title = `Day ${currentDay.dayNumber}: ${currentDay.title}`;
    cta = `Continue Day ${currentDay.dayNumber}`;
    showMissionChip = true;
    missionType = currentDay.missionType;
    supporting = progressLines(data);
  } else if (nextDay) {
    eyebrow = "UP NEXT";
    title = `Day ${nextDay.dayNumber}: ${nextDay.title}`;
    showMissionChip = true;
    missionType = nextDay.missionType;
    lockedPreview = true;
    supporting = progressLines(data);
    supporting.push(
      data.nextUnlockDateLabel
        ? `Unlocks ${data.nextUnlockDateLabel}. Nothing to submit today.`
        : `Day ${nextDay.dayNumber} unlocks soon. Nothing to submit today.`,
    );
  } else {
    eyebrow = "ALL CAUGHT UP";
    title = `You've completed all ${data.totalDays} days.`;
    supporting = progressLines(data);
  }

  if (data.behindBy > 0 && !data.isComplete) {
    supporting.push(
      `You're ${data.behindBy} day${data.behindBy === 1 ? "" : "s"} behind.`,
    );
  }

  return (
    <div className="rounded-2xl border border-[#E0E0E0] bg-white p-8 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] leading-[18px] font-semibold uppercase text-[#E05226]">
            {eyebrow}
          </p>
          <h1 className="mt-2 font-heading text-2xl leading-[30px] font-semibold text-[#111111]">
            {title}
          </h1>
          {showMissionChip && missionType && (
            <span className="mt-2 inline-flex items-center gap-1 rounded-[4px] bg-[#FFECE3] px-2 py-0.5 text-[12px] font-semibold text-[#E05226]">
              {lockedPreview && <Lock className="size-3.5" aria-hidden />}
              {MISSION_LABEL[missionType] ?? missionType}
              {lockedPreview ? " · Locked" : ""}
            </span>
          )}
          {supporting.map((line) => (
            <p key={line} className="mt-2 text-[17px] leading-7 text-[#4B4B4B]">
              {line}
            </p>
          ))}
        </div>
        {cta && currentDay && (
          <Link
            href={`/program/powerbi/day/${currentDay.dayNumber}`}
            className={ctaClass}
          >
            {cta}
          </Link>
        )}
      </div>
    </div>
  );
}
