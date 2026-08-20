import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";

const COMPLETED_DAYS = 23;

export function StreakGrid() {
  return (
    <div className="rounded-3xl border border-border/60 bg-card/70 p-5 shadow-card backdrop-blur-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-primary">Day 23</p>
          <h3 className="mt-1 font-display text-lg font-bold text-foreground">
            Current streak
          </h3>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Flame className="h-5 w-5" />
        </span>
      </div>

      <div
        className="mt-6 grid grid-cols-10 gap-1.5"
        role="img"
        aria-label="Example 60-day progress grid with 23 completed days"
      >
        {Array.from({ length: 60 }, (_, index) => (
          <span
            key={index}
            className={cn(
              "aspect-square rounded-sm",
              index < COMPLETED_DAYS
                ? "bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.3)]"
                : "bg-muted",
            )}
          />
        ))}
      </div>
    </div>
  );
}
