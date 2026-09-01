import Link from "next/link";
import { FileText, Mic } from "lucide-react";
import type { HistoryEntry } from "@/features/interview/platform/service";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  COMPLETED: "Completed",
  ABANDONED: "Left early",
  INVALID: "Not scored",
};

/**
 * How many attempts the profile shows before deferring to the history page.
 *
 * The profile is a summary surface: a candidate with fifteen attempts should
 * see that they have fifteen, not scroll through fifteen. The full list has its
 * own page and this links to it.
 */
const PREVIEW_COUNT = 2;

type Props = {
  /** Newest first. Already user-scoped by the caller. */
  attempts: HistoryEntry[];
};

/**
 * Mock interviews on the profile, read-only.
 *
 * Like Evidence & achievements, nothing here is entered — every row is
 * something the candidate did. It sits after Projects because it is the same
 * kind of claim ("here is what I can do") with the platform, rather than the
 * candidate, as the author. Each row links straight to that attempt's own
 * report: retakes mean a domain has a list of reports, not a result.
 *
 * Server Component — rendered as children of the client `ProfileSection`.
 */
export function MockInterviewsSection({ attempts }: Props) {
  if (attempts.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        <p>
          You haven&rsquo;t taken a mock interview yet. They are live voice
          interviews with an AI interviewer, and each one you finish keeps its
          own scored report.
        </p>
        <Link
          href="/mock-interviews"
          className={cn(buttonVariants({ variant: "default" }), "mt-4")}
        >
          <Mic className="mr-1.5 size-4" strokeWidth={2} aria-hidden />
          Take a mock interview
        </Link>
      </div>
    );
  }

  const recent = attempts.slice(0, PREVIEW_COUNT);
  const hidden = attempts.length - recent.length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {attempts.length} interview{attempts.length === 1 ? "" : "s"} taken
        {recent.length < attempts.length
          ? ` — showing the ${recent.length} most recent`
          : ""}
        .
      </p>

      <ul className="space-y-3">
        {recent.map((a) => (
          <li
            key={a.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{a.domainLabel}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Attempt {a.attemptNumber}
                {" · "}
                {a.createdAt.toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
                {" · "}
                {STATUS_LABEL[a.status] ?? a.status}
                {a.status === "COMPLETED" && a.overallScore !== null
                  ? ` · ${(a.overallScore / 10).toFixed(1)}/10`
                  : ""}
              </p>
            </div>

            {a.hasReport ? (
              <Link
                href={`/mock-interviews/${a.domainSlug}/attempt/${a.id}/report`}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "shrink-0",
                )}
              >
                <FileText className="mr-1.5 size-3.5" strokeWidth={2} aria-hidden />
                View report
              </Link>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">
                Not scored
              </span>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2 pt-1">
        <Link
          href="/mock-interviews"
          className={cn(buttonVariants({ variant: "default", size: "sm" }))}
        >
          <Mic className="mr-1.5 size-3.5" strokeWidth={2} aria-hidden />
          Take another
        </Link>
        <Link
          href="/mock-interviews/history"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          {hidden > 0
            ? `All ${attempts.length} interviews and reports`
            : "Full practice history"}
        </Link>
      </div>
    </div>
  );
}
