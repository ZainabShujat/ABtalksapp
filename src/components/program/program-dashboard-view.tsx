"use client";

import { useState } from "react";
import Link from "next/link";
import { BarChart3, ChevronDown, Lock, Mic } from "lucide-react";
import { dsButtonVariants } from "@/components/design/ds-button";
import { ProgramModuleList } from "@/components/program/program-module-list";
import { ProgramStatsPanel } from "@/components/program/program-stats-panel";
import { PROGRAM_AI_COHORT_BASE, PROGRAM_TOTAL_DAYS } from "@/features/program/constants";
import type { MemberDashboard } from "@/features/program/dashboard";
import { CohortInterviewCard } from "@/components/program/cohort-interview-card";
import type { CohortInterviewState } from "@/features/interview/cohort-eligibility";
import { cn } from "@/lib/utils";

type ProjectRow = {
  moduleNumber: number;
  status: string;
  adminScore: number | null;
  aiScore: number | null;
  aiFeedback: string | null;
};

type Props = {
  data: MemberDashboard;
  atRisk: { atRisk: boolean; reasons: string[] };
  projects: ProjectRow[];
  aiRec: { recommendation: string | null; generatedAt: string | null };
  cohortInterviewState: CohortInterviewState;
  isIshaan?: boolean;
};

const MISSION_LABEL: Record<string, string> = {
  CODE_SPRINT: "Code Sprint",
  SHIP_IT: "Ship It",
  DATA_ROOM: "Data Room",
  PROMPT_FORGE: "Prompt Forge",
  BOSS_BUILD: "Boss Build",
};

const ctaClass = dsButtonVariants({ size: "lg" });

export function ProgramDashboardView({
  data,
  atRisk,
  projects,
  aiRec,
  cohortInterviewState,
  isIshaan,
}: Props) {
  const [statsOpen, setStatsOpen] = useState(false);
  const [interviewOpen, setInterviewOpen] = useState(false);

  // The header badge must not claim "Locked" once a milestone is actually
  // available or taken. Unlock state is server-computed; this only reads it.
  const interviewFullyLocked =
    !cohortInterviewState.day15.unlocked &&
    !cohortInterviewState.day15.taken &&
    !cohortInterviewState.day31.unlocked &&
    !cohortInterviewState.day31.taken;

  return (
    <div className="-mx-4 -my-6 min-h-[calc(100svh-4.25rem)] bg-[#FBF9F7] px-5 py-8 font-content text-[#111111] sm:px-8">
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
              AI Cohort
            </li>
          </ol>
        </nav>

        <header>
          <h1 className="ml-3 font-heading text-[32px] leading-9 font-semibold text-[#111111] md:text-[40px] md:leading-[48px]">
            AI Cohort
          </h1>
          <p className="font-fredoka ml-3 mt-2 text-[17px] leading-7 text-[#4B4B4B]">
            Build and deploy a production-grade enterprise AI chatbot in 31 days
          </p>
        </header>

        <ContinueCard data={data} />

        <section>
          {/* <p className="text-[13px] leading-[18px] font-semibold uppercase text-[#E05226]">
            MODULES
          </p> */}
          {/* <h2 className="mt-3 font-heading text-[32px] leading-9 font-bold text-[#111111] md:text-[40px] md:leading-[48px]">
            Your 31-day path
          </h2> */}
          <div className="mt-6">
            <ProgramModuleList
              modules={data.modules}
              days={data.days}
            />
          </div>
        </section>

        <div className="rounded-[12px] border border-[#E0E0E0] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left focus-visible:ring-2 focus-visible:ring-[#E05226] focus-visible:ring-offset-4 focus-visible:outline-none"
            aria-expanded={statsOpen}
            aria-controls="program-view-stats"
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
              id="program-view-stats"
              className="border-t border-[#E0E0E0] px-6 py-6"
            >
              <ProgramStatsPanel
                data={data}
                atRisk={atRisk}
                projects={projects}
                aiRec={aiRec}
              />
            </div>
          )}
        </div>

        <div className="rounded-[12px] border border-[#E0E0E0] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left focus-visible:ring-2 focus-visible:ring-[#E05226] focus-visible:ring-offset-4 focus-visible:outline-none"
            aria-expanded={interviewOpen}
            aria-controls="program-mock-interview"
            onClick={() => setInterviewOpen((v) => !v)}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <Mic
                className={cn(
                  "size-5 shrink-0",
                  interviewFullyLocked ? "text-[#8F8F8F]" : "text-[#111111]",
                )}
                aria-hidden
              />
              <span
                className={cn(
                  "font-heading text-xl leading-[26px] font-semibold",
                  interviewFullyLocked ? "text-[#8F8F8F]" : "text-[#111111]",
                )}
              >
                Mock Interview
              </span>
              {interviewFullyLocked && (
                <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#F5F5F5] px-2 py-0.5 text-[12px] font-semibold text-[#8F8F8F]">
                  <Lock className="size-4" aria-hidden />
                  Locked
                </span>
              )}
            </span>
            <ChevronDown
              className={cn(
                "size-5 transition-transform",
                interviewFullyLocked ? "text-[#8F8F8F]" : "text-[#111111]",
                interviewOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          {interviewOpen && (
            <div
              id="program-mock-interview"
              className="border-t border-[#E0E0E0] px-6 py-6"
            >
              <p className="text-[17px] leading-7 text-[#4B4B4B]">
                A 15-minute voice interview, scored separately from your
                leaderboard total.
              </p>
              <div className="mt-4">
                <CohortInterviewCard state={cohortInterviewState} isIshaan={isIshaan} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function progressLines(
  data: MemberDashboard,
  opts: { includeCohortPace: boolean },
): string[] {
  if (data.clearedCount === 0) return [];
  let cleared = `You've cleared ${data.clearedCount} of ${PROGRAM_TOTAL_DAYS} days`;
  if (data.waivedCount > 0) {
    cleared += ` (${data.earnedCount} you completed · ${data.waivedCount} cleared at start)`;
  }
  cleared += ".";
  const lines = [cleared];
  if (opts.includeCohortPace && data.clearedCount < data.cohortDay) {
    lines.push(`The cohort is on day ${data.cohortDay}.`);
  }
  return lines;
}

function ContinueCard({ data }: { data: MemberDashboard }) {
  const currentDay = data.currentDay;
  const nextDay =
    data.nextLockedDay !== null
      ? (data.days.find((d) => d.dayNumber === data.nextLockedDay) ?? null)
      : null;

  let eyebrow: string;
  let title: string;
  let supporting: string[] = [];
  let cta: string | null = null;
  let showMissionChip = false;
  let missionType: string | null = null;
  let lockedPreview = false;

  if (!data.hasStarted && currentDay) {
    eyebrow = "GET STARTED";
    title = `Day ${currentDay.dayNumber}: ${currentDay.title}`;
    cta = `Start Day ${currentDay.dayNumber}`;
    showMissionChip = true;
    missionType = currentDay.missionType;
  } else if (data.hasStarted && currentDay) {
    eyebrow = "CONTINUE WHERE YOU LEFT OFF";
    title = `Day ${currentDay.dayNumber}: ${currentDay.title}`;
    cta = `Continue Day ${currentDay.dayNumber}`;
    showMissionChip = true;
    missionType = currentDay.missionType;
    supporting = progressLines(data, { includeCohortPace: true });
  } else if (nextDay) {
    eyebrow = "UP NEXT";
    title = `Day ${nextDay.dayNumber}: ${nextDay.title}`;
    showMissionChip = true;
    missionType = nextDay.missionType;
    lockedPreview = true;
    supporting = progressLines(data, { includeCohortPace: false });
    supporting.push(
      data.nextUnlockDateLabel
        ? `Unlocks ${data.nextUnlockDateLabel}. Nothing to submit today.`
        : `Day ${nextDay.dayNumber} unlocks soon. Nothing to submit today.`,
    );
  } else {
    eyebrow = "ALL CAUGHT UP";
    title = `You've completed all ${PROGRAM_TOTAL_DAYS} days.`;
    supporting = progressLines(data, { includeCohortPace: false });
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
            <p
              key={line}
              className="mt-2 text-[17px] leading-7 text-[#4B4B4B]"
            >
              {line}
            </p>
          ))}
        </div>
        {cta && currentDay && (
          <Link
            href={`${PROGRAM_AI_COHORT_BASE}/day/${currentDay.dayNumber}`}
            className={ctaClass}
          >
            {cta}
          </Link>
        )}
      </div>
    </div>
  );
}
