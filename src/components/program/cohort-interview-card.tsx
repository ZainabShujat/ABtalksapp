"use client";

import Link from "next/link";
import Image from "next/image";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  BlueprintState,
  CohortInterviewState,
} from "@/features/interview/cohort-eligibility";

type Props = {
  state: CohortInterviewState;
};

const figmaBtn =
  "inline-flex h-11 items-center justify-center rounded-[12px] bg-[#E05226] px-6 text-sm font-semibold text-white transition-colors duration-200 ease-out hover:bg-[#C9411C] focus-visible:ring-2 focus-visible:ring-[#E05226] focus-visible:ring-offset-2 focus-visible:outline-none";

const cardClass =
  "rounded-[16px] border border-[#E0E0E0] bg-[#FFF5F0] p-4 transition-colors duration-200 ease-out md:p-5 hover:border-[#E05226]/40";

const availableBadge =
  "inline-flex rounded-[4px] border border-[#1A7F37]/40 bg-[#1A7F37]/10 px-3 py-1 text-xs font-semibold text-[#1A7F37]";

const completedBadge =
  "inline-flex rounded-[4px] border border-[#E05226]/40 bg-[#FFECE3] px-3 py-1 text-xs font-semibold text-[#E05226]";

const lockedBadge =
  "inline-flex rounded-[4px] border border-[#E0E0E0] bg-[#F5F5F5] px-3 py-1 text-xs font-semibold text-[#8F8F8F]";

/**
 * One milestone row. `unlocked` describes CURRICULUM progress (every scope day
 * passed); `taken` describes INTERVIEW completion. They are never conflated.
 */
function MilestoneRow({
  title,
  blurb,
  state,
  href,
}: {
  title: string;
  blurb: string;
  state: BlueprintState;
  href: string;
}) {
  const remaining = state.missingDays.length;

  return (
    <div className="min-w-0 flex-1 flex gap-4 justify-between items-start">
      <div className="flex-1">
        <h3 className="text-sm font-semibold text-[#111111] md:text-[15px]">
          {title}
        </h3>

        {state.taken ? (
          <>
            <p className="mt-1 text-sm text-[#4B4B4B] md:text-[15px]">
              {state.score !== null
                ? `Completed — ${state.score}/100 overall.`
                : "Completed. Your result is being scored."}
            </p>
            <div className="mt-3">
              <span className={completedBadge}>Completed</span>
            </div>
            <div className="mt-3">
              <Link href={`${href}/report`} className={cn(figmaBtn)}>
                View report →
              </Link>
            </div>
          </>
        ) : state.unlocked ? (
          <>
            <p className="mt-1 text-sm text-[#4B4B4B] md:text-[15px]">{blurb}</p>
            <div className="mt-3">
              <span className={availableBadge}>
                {state.inProgressId ? "In progress" : "Available"}
              </span>
            </div>
            <div className="mt-3">
              <Link href={href} className={cn(figmaBtn)}>
                {state.inProgressId ? "Resume Interview" : "Take Interview"} →
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-[#4B4B4B] md:text-[15px]">{blurb}</p>
            <div className="mt-3">
              <span className={lockedBadge}>
                {remaining} {remaining === 1 ? "day" : "days"} to go
              </span>
            </div>
          </>
        )}
      </div>

      {!state.taken && !state.unlocked && (
        <div className="relative size-[64px] shrink-0 opacity-80 sm:size-[72px]">
          <Image
            src="/program/interview-key.png"
            alt="Locked"
            fill
            className="object-contain"
            sizes="72px"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Cohort interview card on the AI Cohort dashboard.
 *
 * Both milestones are always shown and unlock independently — Day 15 is not a
 * prerequisite for Day 31. Each can be taken exactly once. Every unlock flag is
 * computed on the server from actual PASSED mission days; nothing here derives
 * eligibility from a count the client could influence.
 */
export function CohortInterviewCard({ state }: Props) {
  return (
    <section className={cn(cardClass, "group flex flex-1 flex-col")}>
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-[6px] bg-[#FFECE3] text-[#E05226] transition-colors duration-200 group-hover:bg-[#FFDBC9] md:size-7">
          <Sparkles className="size-3.5 md:size-4" strokeWidth={2.25} />
        </span>
        <h2 className="text-base font-semibold text-[#E05226] md:text-lg">
          AI Voice Interview
        </h2>
      </div>

      <div className="mt-2 flex flex-col gap-5 md:flex-row md:gap-6">
        <MilestoneRow
          title="Day 15 Checkpoint Interview"
          blurb="Test what you've learned across Days 1–15."
          state={state.day15}
          href="/program/cohort-interview/DAY_15"
        />
        <div className="hidden w-px shrink-0 bg-[#E0E0E0] md:block" />
        <MilestoneRow
          title="Day 31 Final Interview"
          blurb="Assess what you've learned across the full cohort."
          state={state.day31}
          href="/program/cohort-interview/DAY_31"
        />
      </div>
    </section>
  );
}
