"use client";

import Link from "next/link";
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
  "inline-flex h-11 items-center justify-center rounded-[12px] border border-black bg-accent-500 px-6 text-sm font-semibold text-white shadow-[inset_3px_3px_3px_0_rgba(0,0,0,0.5)] transition-[background-color,box-shadow] duration-300 ease-out hover:bg-accent-500/90 hover:shadow-[inset_3px_3px_3px_0_rgba(0,0,0,0.5),0_0_12px_rgba(115,100,230,0.2)]";

const cardClass =
  "rounded-[16px] border border-[rgba(46,57,75,0.69)] bg-[rgba(5,12,33,0.89)] p-4 transition-[border-color,box-shadow] duration-300 ease-out md:p-5 hover:border-accent-600/55 hover:shadow-[0_4px_20px_rgba(115,100,230,0.08)]";

const availableBadge =
  "inline-flex rounded-[4px] border border-[#6AE276] bg-[#6AE276]/10 px-3 py-1 text-xs text-[#6AE276]";

const completedBadge =
  "inline-flex rounded-[4px] border border-accent-500 bg-[rgba(93,8,183,0.2)] px-3 py-1 text-xs text-accent-700";

const lockedBadge =
  "inline-flex rounded-[4px] border border-[rgba(46,57,75,0.9)] bg-[rgba(46,57,75,0.25)] px-3 py-1 text-xs text-ink-300";

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
    <div className="min-w-0 flex-1">
      <h3 className="text-sm font-semibold text-ink-100 md:text-[15px]">
        {title}
      </h3>

      {state.taken ? (
        <>
          <p className="mt-1 text-sm text-ink-200 md:text-[15px]">
            {state.score !== null
              ? `Completed — ${state.score}/100 overall.`
              : "Completed. Your result is being scored."}
          </p>
          <div className="mt-3">
            <span className={completedBadge}>Completed</span>
          </div>
        </>
      ) : state.unlocked ? (
        <>
          <p className="mt-1 text-sm text-ink-200 md:text-[15px]">{blurb}</p>
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
          <p className="mt-1 text-sm text-ink-200 md:text-[15px]">{blurb}</p>
          <div className="mt-3">
            <span className={lockedBadge}>
              {remaining} {remaining === 1 ? "day" : "days"} to go
            </span>
          </div>
        </>
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
        <span className="flex size-6 shrink-0 items-center justify-center rounded-[6px] bg-[rgba(93,8,183,0.25)] text-accent-700 transition-colors duration-200 group-hover:bg-[rgba(115,100,230,0.35)] group-hover:text-accent-700 md:size-7">
          <Sparkles className="size-3.5 md:size-4" strokeWidth={2.25} />
        </span>
        <h2 className="text-base font-semibold text-accent-700 md:text-lg">
          AI Interview
        </h2>
      </div>

      <div className="mt-2 flex flex-col gap-5 md:flex-row md:gap-6">
        <MilestoneRow
          title="Day 15 Checkpoint Interview"
          blurb="Test what you've learned across Days 1–15."
          state={state.day15}
          href="/program/cohort-interview/DAY_15"
        />
        <div className="hidden w-px shrink-0 bg-[rgba(46,57,75,0.69)] md:block" />
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
