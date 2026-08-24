"use client";

import { useState } from "react";
import Link from "next/link";
import { BarChart3, ChevronDown, Lock, Mic } from "lucide-react";
import { dsButtonVariants } from "@/components/design/ds-button";
import { ProgramModuleList } from "@/components/program/program-module-list";
import { ProgramStatsPanel } from "@/components/program/program-stats-panel";
import { PROGRAM_TOTAL_DAYS } from "@/features/program/constants";
import type { MemberDashboard } from "@/features/program/dashboard";
import type { InterviewDashboardCard } from "@/features/program/interview";
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
  interviewCard: InterviewDashboardCard;
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
  interviewCard,
}: Props) {
  const [statsOpen, setStatsOpen] = useState(false);
  const [interviewOpen, setInterviewOpen] = useState(false);

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
              id="program-mock-interview"
              className="border-t border-[#E0E0E0] px-6 py-6"
            >
              <p className="text-[17px] leading-7 text-[#4B4B4B]">
                A 15-minute voice interview, scored separately from your
                leaderboard total.
              </p>
              <p className="mt-2 text-[17px] leading-7 text-[#4B4B4B]">
                {interviewCard.state === "locked"
                  ? interviewCard.label
                  : "Unlocks after the program ends"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ContinueCard({ data }: { data: MemberDashboard }) {
  const currentDay = data.currentDay;

  let eyebrow: string;
  let title: string;
  let supporting: string | null = null;
  let cta: string | null = null;

  if (!data.hasStarted && currentDay) {
    eyebrow = "GET STARTED";
    title = `Day ${currentDay.dayNumber}: ${currentDay.title}`;
    cta = `Start Day ${currentDay.dayNumber}`;
  } else if (data.hasStarted && currentDay) {
    eyebrow = "CONTINUE WHERE YOU LEFT OFF";
    title = `Day ${currentDay.dayNumber}: ${currentDay.title}`;
    cta = `Continue Day ${currentDay.dayNumber}`;
  } else {
    eyebrow = "ALL CAUGHT UP";
    title = "You're all caught up";
    supporting =
      data.nextLockedDay !== null
        ? `Day ${data.nextLockedDay} unlocks soon.`
        : `You've completed all ${PROGRAM_TOTAL_DAYS} days.`;
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
          {currentDay && (
            <span className="mt-2 inline-flex rounded-[4px] bg-[#FFECE3] px-2 py-0.5 text-[12px] font-semibold text-[#E05226]">
              {MISSION_LABEL[currentDay.missionType] ?? currentDay.missionType}
            </span>
          )}
          {supporting && (
            <p className="mt-2 text-[17px] leading-7 text-[#4B4B4B]">
              {supporting}
            </p>
          )}
        </div>
        {cta && currentDay && (
          <Link
            href={`/program/day/${currentDay.dayNumber}`}
            className={ctaClass}
          >
            {cta}
          </Link>
        )}
      </div>
    </div>
  );
}
