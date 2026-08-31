import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ProfileCompleteness } from "@/features/profile/completeness";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Profile strength. Guidance only: this number never affects recruiter
 * discovery, `openToWork`, or eligibility for anything.
 */
export function ProfileStrength({ data }: { data: ProfileCompleteness }) {
  const { score, sections } = data;
  const tone =
    score >= 80
      ? "text-emerald-500"
      : score >= 50
        ? "text-amber-500"
        : "text-muted-foreground";

  return (
    <Card className="min-w-0">
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-base font-semibold tracking-tight">
            Profile strength
          </h2>
          <span className={cn("font-display text-2xl font-bold", tone)}>
            {score}%
          </span>
        </div>

        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Profile strength"
        >
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              score >= 80
                ? "bg-emerald-500"
                : score >= 50
                  ? "bg-amber-500"
                  : "bg-muted-foreground/50",
            )}
            style={{ width: `${score}%` }}
          />
        </div>

        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {sections.map((s) => (
            <li key={s.key} className="flex items-start gap-2 text-sm">
              {s.complete ? (
                <CheckCircle2
                  className="mt-0.5 size-4 shrink-0 text-emerald-500"
                  aria-hidden
                />
              ) : (
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-amber-500"
                  aria-hidden
                />
              )}
              <span className="min-w-0">
                <span
                  className={cn(
                    s.complete ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {s.label}
                </span>
                {!s.complete && s.hint ? (
                  <span className="block text-xs text-muted-foreground/80">
                    {s.hint}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>

        <p className="text-xs text-muted-foreground">
          Strength is guidance for you alone. It does not affect whether
          recruiters can find you, and it is separate from whether you are open
          to work.
        </p>
      </CardContent>
    </Card>
  );
}
