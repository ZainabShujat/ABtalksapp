"use client";

import * as React from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { parseCalendarKeyToUtcDate, formatDateIST } from "@/lib/date-utils";
import type { HeatmapCell } from "@/features/dashboard/get-heatmap-data";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Props = {
  data: HeatmapCell[];
  interactive?: boolean;
  /** Current dashboard enrollment: preserves ?challenge= when opening /challenge/[day] */
  challengeEnrollmentId?: string;
};

const STATUS_CLASS: Record<HeatmapCell["status"], string> = {
  on_time: "bg-emerald-500",
  late: "bg-emerald-500",
  rejected: "bg-purple-500 dark:bg-purple-600",
  missed: "bg-red-500",
  future:
    "border border-dotted border-muted-foreground/40 bg-muted/20 dark:bg-muted/30",
};

function tooltipLabel(cell: HeatmapCell): string {
  const displayDate = formatDateIST(parseCalendarKeyToUtcDate(cell.date));
  switch (cell.status) {
    case "on_time":
      return `Day ${cell.dayNumber}: On time on ${displayDate}`;
    case "late":
      return `Day ${cell.dayNumber}: On time on ${displayDate}`;
    case "rejected":
      return `Day ${cell.dayNumber}: Rejected on ${displayDate}`;
    case "missed":
      return cell.isRelaxable
        ? `Day ${cell.dayNumber} — Missed, but still in catch-up window`
        : `Day ${cell.dayNumber} — Missed on ${displayDate}`;
    case "future":
    default:
      return `Day ${cell.dayNumber}: Unlocks on ${displayDate}`;
  }
}

function isClickable(cell: HeatmapCell): boolean {
  return (
    cell.status === "on_time" ||
    cell.status === "late" ||
    cell.status === "rejected" ||
    cell.status === "missed"
  );
}

const markdownClass =
  "max-w-none text-sm leading-relaxed text-foreground [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5";

function TaskMetaSections({ cell }: { cell: HeatmapCell }) {
  const hasObjectives = cell.learningObjectives.length > 0;
  const hasResources = cell.resources.length > 0;
  const hasTags = cell.tags.length > 0;
  const hasMetaPill =
    cell.difficulty != null && cell.difficulty !== "" && cell.estimatedMinutes != null;

  if (!hasObjectives && !hasResources && !hasTags && !hasMetaPill) return null;

  return (
    <div className="space-y-4 border-t border-border/50 pt-4">
      {hasMetaPill ? (
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{cell.difficulty}</Badge>
          <span className="self-center tabular-nums">
            ~{cell.estimatedMinutes} min
          </span>
        </div>
      ) : null}

      {hasObjectives ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">
            Learning objectives
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {cell.learningObjectives.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {hasResources ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Resources</h3>
          <ul className="space-y-1.5 text-sm">
            {cell.resources.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all font-medium text-primary underline-offset-4 hover:underline"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {hasTags ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Tags</h3>
          <div className="flex flex-wrap gap-1.5">
            {cell.tags.map((t) => (
              <Badge key={t} variant="outline" className="font-normal">
                {t}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function dialogTitle(cell: HeatmapCell): string {
  switch (cell.status) {
    case "missed":
      return `Day ${cell.dayNumber}: Missed`;
    case "on_time":
      return `Day ${cell.dayNumber}: On Time`;
    case "late":
      return `Day ${cell.dayNumber}: On Time`;
    case "rejected":
      return `Day ${cell.dayNumber}: Submission Rejected`;
    default:
      return `Day ${cell.dayNumber}`;
  }
}

export function SubmissionHeatmap({
  data,
  interactive = true,
  challengeEnrollmentId,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState<HeatmapCell | null>(null);

  function openCell(cell: HeatmapCell) {
    if (!isClickable(cell)) return;
    setActive(cell);
    setOpen(true);
  }

  const submittedLabel =
    active?.submittedAt != null
      ? formatDateIST(new Date(active.submittedAt))
      : "-";

  return (
    <div className="w-full min-w-0">
      <div className="overflow-x-auto px-1 py-1.5">
        <div
          className="grid w-max max-w-full grid-cols-10 gap-1.5 sm:mx-auto sm:gap-2"
          role="grid"
          aria-label="60-day submission heatmap"
        >
          {data.map((cell) => {
            const clickable = interactive && isClickable(cell);
            const isFuture = cell.status === "future";
            return (
              <button
                key={cell.dayNumber}
                type="button"
                role="gridcell"
                title={tooltipLabel(cell)}
                disabled={!clickable}
                onClick={() => openCell(cell)}
                className={cn(
                  "size-7 shrink-0 rounded-md sm:size-9",
                  STATUS_CLASS[cell.status],
                  cell.status === "missed" &&
                    cell.isRelaxable &&
                    "ring-2 ring-amber-400 ring-offset-1 ring-offset-background dark:ring-amber-500",
                  clickable &&
                    "cursor-pointer transition-[box-shadow,transform] hover:z-10 hover:ring-2 hover:ring-primary hover:ring-offset-2 hover:ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                  isFuture && "cursor-not-allowed",
                  !clickable && !isFuture && "cursor-default",
                )}
              />
            );
          })}
        </div>
      </div>

      <ul className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <li className="flex items-center gap-2">
          <span
            className="size-3.5 shrink-0 rounded-sm bg-emerald-500"
            aria-hidden
          />
          On time
        </li>
        <li className="flex items-center gap-2">
          <span
            className="size-3.5 shrink-0 rounded-sm bg-purple-500 dark:bg-purple-600"
            aria-hidden
          />
          Rejected
        </li>
        <li className="flex items-center gap-2">
          <span
            className="size-3.5 shrink-0 rounded-sm bg-red-500"
            aria-hidden
          />
          Missed
        </li>
        <li className="flex items-center gap-2">
          <span
            className="size-3.5 shrink-0 rounded-sm bg-red-500 ring-2 ring-amber-400 ring-offset-1 ring-offset-background dark:ring-amber-500"
            aria-hidden
          />
          Missed - catch up
        </li>
        <li className="flex items-center gap-2">
          <span
            className="inline-block size-3.5 shrink-0 rounded-sm border border-dotted border-muted-foreground/45 bg-muted/25 dark:bg-muted/35"
            aria-hidden
          />
          Future
        </li>
      </ul>

      <Dialog open={interactive ? open : false} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton
          className="flex max-h-[min(90vh,720px)] max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        >
          {active ? (
            <>
              <DialogHeader className="shrink-0 border-b border-border/60 px-5 pt-5 pb-3">
                <DialogTitle className="font-display text-lg leading-snug sm:text-xl">
                  {dialogTitle(active)}
                </DialogTitle>
                {active.taskTitle &&
                active.status !== "missed" &&
                active.status !== "rejected" ? (
                  <p className="pt-1 text-sm font-medium text-muted-foreground">
                    {active.taskTitle}
                  </p>
                ) : null}
                {active.status === "rejected" && active.taskTitle ? (
                  <p className="pt-1 text-sm font-medium text-muted-foreground">
                    {active.taskTitle}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  {active.status === "missed" ? (
                    <Badge variant="secondary" className="bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-200">
                      Missed
                    </Badge>
                  ) : (
                    <Badge
                      variant="secondary"
                      className={
                        active.status === "on_time" || active.status === "late"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : "bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300"
                      }
                    >
                      {active.status === "on_time" || active.status === "late"
                        ? "On Time"
                        : "Rejected"}
                    </Badge>
                  )}
                  {active.status === "on_time" || active.status === "late" ? (
                    <p className="text-sm text-muted-foreground">
                      Submitted {submittedLabel}
                    </p>
                  ) : null}
                  {active.status === "rejected" && active.actionAt ? (
                    <p className="text-sm text-muted-foreground">
                      {active.adminName ?? "An admin"} rejected this submission on{" "}
                      {formatDateIST(new Date(active.actionAt))}
                    </p>
                  ) : null}
                </div>
              </DialogHeader>

              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
                {active.status === "missed" && active.isRelaxable ? (
                  <p className="rounded-lg border border-amber-400/60 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
                    You&apos;re inside the 5-day catch-up window. Submit GitHub +
                    LinkedIn now to mark this day green and heal your streak.
                  </p>
                ) : null}
                {active.status === "missed" && !active.isRelaxable ? (
                  <p className="rounded-lg border border-border/60 bg-muted/40 p-3 text-sm text-muted-foreground">
                    You missed this day. Submissions are no longer accepted, but you
                    can review the problem statement to help with later tasks.
                  </p>
                ) : null}

                {active.status === "rejected" ? (
                  <section className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
                    {active.actionReason ? (
                      <p>
                        <span className="font-medium">Reason: </span>
                        {active.actionReason}
                      </p>
                    ) : (
                      <p className="text-muted-foreground">No reason was provided.</p>
                    )}
                    <p className="text-muted-foreground">You can resubmit this day.</p>
                  </section>
                ) : null}

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Problem</h3>
                  <div className={markdownClass}>
                    {active.problemStatement ? (
                      <ReactMarkdown>{active.problemStatement}</ReactMarkdown>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No problem statement on file for this day.
                      </p>
                    )}
                  </div>
                </section>

                {active.status === "missed" ||
                active.status === "on_time" ||
                active.status === "late" ||
                active.status === "rejected" ? (
                  <TaskMetaSections cell={active} />
                ) : null}

                {active.status === "on_time" || active.status === "late" ? (
                  <section className="space-y-2 border-t border-border/50 pt-4">
                    <h3 className="text-sm font-semibold text-foreground">
                      Your submission
                    </h3>
                    <ul className="space-y-2 text-sm">
                      <li>
                        <span className="text-muted-foreground">GitHub: </span>
                        {active.githubUrl ? (
                          <a
                            href={active.githubUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {active.githubUrl}
                          </a>
                        ) : (
                          "-"
                        )}
                      </li>
                      <li>
                        <span className="text-muted-foreground">LinkedIn: </span>
                        {active.linkedinUrl ? (
                          <a
                            href={active.linkedinUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {active.linkedinUrl}
                          </a>
                        ) : (
                          "-"
                        )}
                      </li>
                    </ul>
                  </section>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-wrap justify-center gap-2 border-t border-border/60 bg-muted/30 px-5 py-4">
                {active.status === "missed" && active.isRelaxable ? (
                  <Link
                    href={
                      challengeEnrollmentId
                        ? `/challenge/${active.dayNumber}?challenge=${encodeURIComponent(challengeEnrollmentId)}`
                        : `/challenge/${active.dayNumber}`
                    }
                    className={cn(buttonVariants({ variant: "default" }))}
                    onClick={() => setOpen(false)}
                  >
                    Submit now
                  </Link>
                ) : null}
                {active.status === "rejected" ? (
                  <Link
                    href={
                      challengeEnrollmentId
                        ? `/challenge/${active.dayNumber}?challenge=${encodeURIComponent(challengeEnrollmentId)}`
                        : `/challenge/${active.dayNumber}`
                    }
                    className={cn(buttonVariants({ variant: "outline" }))}
                    onClick={() => setOpen(false)}
                  >
                    Resubmit
                  </Link>
                ) : null}
                {(active.status === "missed" && !active.isRelaxable) ||
                active.status === "on_time" ||
                active.status === "late" ? (
                  <Link
                    href={
                      challengeEnrollmentId
                        ? `/challenge/${active.dayNumber}?challenge=${encodeURIComponent(challengeEnrollmentId)}`
                        : `/challenge/${active.dayNumber}`
                    }
                    className={cn(buttonVariants({ variant: "outline" }))}
                    onClick={() => setOpen(false)}
                  >
                    View task
                  </Link>
                ) : null}
                <Button type="button" variant="default" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
