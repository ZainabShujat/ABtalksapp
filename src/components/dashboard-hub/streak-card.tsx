import { HUB_CARD_HOVER_CLASS } from "@/components/dashboard-hub/nav-items";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MILESTONES = [7, 14, 30, 60, 100];

function nextMilestone(current: number): number {
  for (const m of MILESTONES) {
    if (m > current) return m;
  }
  return MILESTONES[MILESTONES.length - 1]!;
}

type StreakCardProps = {
  streak: { current: number; longest: number };
  weekTicks: boolean[];
  totalActiveDays: number;
};

export function StreakCard({
  streak,
  weekTicks,
  totalActiveDays,
}: StreakCardProps) {
  const milestone = nextMilestone(streak.current);
  const ringPct = Math.min(100, (streak.current / milestone) * 100);

  return (
    <div
      className={cn(
        "rounded-2xl border border-neutral-200 bg-[#FBF9F7] p-5 shadow-sm",
        HUB_CARD_HOVER_CLASS,
      )}
    >
      <div className="flex items-center gap-4">
        <div
          className="relative flex size-20 shrink-0 items-center justify-center"
          aria-hidden
        >
          <svg className="size-20 -rotate-90" viewBox="0 0 36 36">
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke="#e5e5e5"
              strokeWidth="3"
            />
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke="#e05226"
              strokeWidth="3"
              strokeDasharray={`${ringPct} ${100 - ringPct}`}
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute font-inter text-2xl font-bold tabular-nums text-black">
            {streak.current}
          </span>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-widest text-[#e05226] uppercase">
            Day streak
          </p>
          <p className="mt-1 text-sm text-[#555555]">
            Keep submitting daily to grow your streak.
          </p>
        </div>
      </div>

      <div className="mt-5 flex justify-between gap-1">
        {WEEKDAY_LABELS.map((label, i) => (
          <div key={label} className="flex flex-col items-center gap-1">
            <span
              className={
                weekTicks[i]
                  ? "flex size-6 items-center justify-center rounded-full bg-[#e05226] text-white"
                  : "flex size-6 items-center justify-center rounded-full border border-neutral-200 bg-neutral-50"
              }
              aria-hidden
            >
              {weekTicks[i] ? (
                <svg
                  className="size-3.5"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="white"
                  strokeWidth="2"
                >
                  <path d="M2 6l3 3 5-5" />
                </svg>
              ) : null}
            </span>
            <span className="text-[10px] text-neutral-400">{label}</span>
          </div>
        ))}
      </div>

      <ul className="mt-5 space-y-2 border-t border-neutral-100 pt-4 text-sm">
        <li className="flex justify-between">
          <span className="text-[#555555]">Current streak</span>
          <span className="font-medium tabular-nums text-black">
            {streak.current} days
          </span>
        </li>
        <li className="flex justify-between">
          <span className="text-[#555555]">Longest streak</span>
          <span className="font-medium tabular-nums text-black">
            {streak.longest} days
          </span>
        </li>
        <li className="flex justify-between">
          <span className="text-[#555555]">Total active days</span>
          <span className="font-medium tabular-nums text-black">
            {totalActiveDays}
          </span>
        </li>
        <li className="flex justify-between">
          <span className="text-[#555555]">Next milestone</span>
          <span className="font-medium tabular-nums text-black">
            {milestone} days
          </span>
        </li>
      </ul>
    </div>
  );
}
