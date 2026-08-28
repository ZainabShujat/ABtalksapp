import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Flag,
  Flame,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import {
  HUB_ARROW_HOVER_CLASS,
  HUB_CARD_HOVER_CLASS,
  HUB_TEXT_LINK_CLASS,
} from "@/components/dashboard-hub/nav-items";
import { StreakRing } from "@/components/dashboard-hub/streak-ring";
import type {
  ActivityStreak,
  WeekDayTick,
} from "@/features/dashboard/compute-activity-streak";
import { cn } from "@/lib/utils";

function formatDayCount(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

function formatRemaining(n: number): string {
  return n === 1 ? "1 more day" : `${n} more days`;
}

function headerCopy(streak: ActivityStreak): { title: string; headline: string } {
  if (streak.state === "empty") {
    return { title: "Day streak", headline: "Start your streak." };
  }
  if (streak.state === "broken") {
    return { title: "Streak broken", headline: "Streak lost." };
  }
  return { title: "Day streak", headline: "Keep showing up." };
}

function milestoneCopy(streak: ActivityStreak): string {
  if (streak.state === "empty") {
    return "Complete today's task to get started.";
  }
  if (streak.state === "broken") {
    return "Every day is a new chance to improve.";
  }
  if (!streak.todayCompleted) {
    return "Make a submission to keep your streak alive.";
  }
  if (streak.currentStreak === 1) {
    return "Your streak starts today.";
  }
  if (streak.daysToMilestone === 0) {
    return "You're on fire!";
  }
  return `You're on fire! ${formatRemaining(streak.daysToMilestone)} to reach your next milestone.`;
}

type StreakCardProps = {
  streak: ActivityStreak;
  restartHref: string;
};

export function StreakCard({ streak, restartHref }: StreakCardProps) {
  const { title, headline } = headerCopy(streak);
  const isBroken = streak.state === "broken";
  const isActive = streak.state === "active";
  const ringProgress =
    streak.nextMilestone === 0
      ? 0
      : Math.min(1, streak.currentStreak / streak.nextMilestone);
  const unit = streak.currentStreak === 1 ? "day" : "days";

  return (
    <div
      className={cn(
        "rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm",
        HUB_CARD_HOVER_CLASS,
      )}
    >
      <StreakHeader
        title={title}
        headline={headline}
        isActive={isActive}
        isBroken={isBroken}
        value={streak.currentStreak}
        unit={unit}
        progress={isActive ? ringProgress : 0}
      />

      <WeeklyStreak week={streak.week} />

      <StreakStats streak={streak} />

      <StreakMilestone
        message={milestoneCopy(streak)}
        showCta={isBroken}
        restartHref={restartHref}
      />
    </div>
  );
}

function StreakHeader({
  title,
  headline,
  isActive,
  isBroken,
  value,
  unit,
  progress,
}: {
  title: string;
  headline: string;
  isActive: boolean;
  isBroken: boolean;
  value: number;
  unit: string;
  progress: number;
}) {
  return (
    <div className="flex items-center gap-4">
      <StreakRing value={value} unit={unit} progress={progress} />
      <div className="min-w-0">
        <p
          className={cn(
            "flex items-center gap-1.5 text-xs font-semibold tracking-widest uppercase",
            isBroken ? "text-[#C9411C]" : "text-[#e05226]",
          )}
        >
          <Flame
            className={cn(
              "size-3.5",
              isActive ? "text-[#e05226]" : "text-neutral-400",
            )}
            aria-hidden
          />
          {title}
        </p>
        <p className="mt-1 text-sm text-[#555555]">{headline}</p>
      </div>
    </div>
  );
}

function WeeklyStreak({ week }: { week: WeekDayTick[] }) {
  return (
    <div className="mt-5 flex min-w-0 justify-between gap-1">
      {week.map((day) => (
        <div key={day.date} className="flex min-w-0 flex-col items-center gap-1">
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full",
              day.status === "complete" && "bg-[#e05226] text-white",
              day.status === "broken" && "bg-[#FCE8E6] text-[#C9411C]",
              day.status === "idle" &&
                "border border-neutral-200 bg-neutral-50",
              day.status === "future" &&
                "border border-neutral-200 bg-neutral-50",
              day.status === "today" &&
                "border-2 border-[#e05226] bg-white",
              day.isToday && "ring-2 ring-[#e05226]/25 ring-offset-1",
              day.status === "complete" &&
                day.isToday &&
                "motion-safe:animate-[heatmap-cell_0.4s_ease-out]",
            )}
            aria-label={weekDayAria(day)}
          >
            {day.status === "complete" ? <CheckIcon /> : null}
            {day.status === "broken" ? <XIcon /> : null}
          </span>
          <span className="text-[10px] text-neutral-400">{day.label}</span>
        </div>
      ))}
    </div>
  );
}

function weekDayAria(day: WeekDayTick): string {
  if (day.status === "complete") {
    return day.isToday ? `${day.label} today, complete` : `${day.label} complete`;
  }
  if (day.status === "broken") return `${day.label} missed, streak broken`;
  if (day.status === "today") return `${day.label} today, not yet complete`;
  if (day.status === "future") return `${day.label} upcoming`;
  return `${day.label} no activity`;
}

function CheckIcon() {
  return (
    <svg
      className="size-3.5"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M2 6l3 3 5-5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="size-3"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}

function StreakStats({ streak }: { streak: ActivityStreak }) {
  return (
    <ul className="mt-5 space-y-2 border-t border-neutral-100 pt-4 text-sm">
      <StatRow
        icon={Flame}
        label="Current streak"
        value={formatDayCount(streak.currentStreak)}
      />
      <StatRow
        icon={Trophy}
        label="Longest streak"
        value={formatDayCount(streak.longestStreak)}
      />
      <StatRow
        icon={CalendarDays}
        label="Total active days"
        value={formatDayCount(streak.totalActiveDays)}
      />
      <StatRow
        icon={Flag}
        label="Next milestone"
        value={formatDayCount(streak.nextMilestone)}
      />
    </ul>
  );
}

function StatRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <li className="flex justify-between gap-3">
      <span className="inline-flex min-w-0 items-center gap-2 text-[#555555]">
        <Icon className="size-3.5 shrink-0 text-[#e05226]" strokeWidth={1.75} aria-hidden />
        {label}
      </span>
      <span className="font-medium tabular-nums text-black">{value}</span>
    </li>
  );
}

function StreakMilestone({
  message,
  showCta,
  restartHref,
}: {
  message: string;
  showCta: boolean;
  restartHref: string;
}) {
  return (
    <div className="mt-4 border-t border-neutral-100 pt-4">
      <p className="text-sm text-[#555555]">{message}</p>
      {showCta ? (
        <Link href={restartHref} className={cn(HUB_TEXT_LINK_CLASS, "mt-2")}>
          Start again
          <ArrowRight className={HUB_ARROW_HOVER_CLASS} aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}
