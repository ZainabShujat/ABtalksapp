"use client";

import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  BlueprintState,
  CohortInterviewState,
} from "@/features/interview/cohort-eligibility";
import { PROGRAM_AI_COHORT_BASE } from "@/features/program/constants";
import { resetDemoInterviewAction } from "@/app/actions/interview-actions";

type Props = {
  state: CohortInterviewState;
  isIshaan?: boolean;
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
  blueprint,
  isIshaan,
}: {
  title: string;
  blurb: string;
  state: BlueprintState;
  href: string;
  blueprint: string;
  isIshaan?: boolean;
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
            <div className="mt-3 flex items-center gap-3">
              <Link href={`${href}/report`} className={cn(figmaBtn)}>
                View report →
              </Link>
              {isIshaan && (
                <button
                  type="button"
                  onClick={() => resetDemoInterviewAction(blueprint)}
                  className="inline-flex h-11 items-center rounded-[12px] border border-gray-300 bg-gray-100 px-5 text-[14px] font-semibold text-gray-800 transition-colors hover:bg-gray-200"
                >
                  Reattempt (Demo)
                </button>
              )}
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
        // Was a purple PNG padlock, which was the one element on this card that
        // did not belong to the ABTalks palette. A lucide icon in the brand
        // orange also scales crisply and drops an image request.
        <div
          className="flex size-[56px] shrink-0 items-center justify-center rounded-[12px] bg-[#FFECE3] sm:size-[64px]"
          aria-hidden="true"
        >
          <Lock className="size-6 text-[#E05226] sm:size-7" strokeWidth={1.75} />
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
export function CohortInterviewCard({ state, isIshaan }: Props) {
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
          href={`${PROGRAM_AI_COHORT_BASE}/cohort-interview/DAY_15`}
          blueprint="DAY_15"
          isIshaan={isIshaan}
        />
        <div className="hidden w-px shrink-0 bg-[#E0E0E0] md:block" />
        <MilestoneRow
          title="Day 31 Final Interview"
          blurb="Assess what you've learned across the full cohort."
          state={state.day31}
          href={`${PROGRAM_AI_COHORT_BASE}/cohort-interview/DAY_31`}
          blueprint="DAY_31"
          isIshaan={isIshaan}
        />
      </div>
    </section>
  );
}
