import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, Clock, Lightbulb, ListChecks, Share2 } from "lucide-react";
import { DaySection } from "@/components/challenge/day-section";
import { DaySubmitPanel } from "@/components/challenge/day-submit-panel";
import type { TrackConfig } from "@/components/challenge/track-config";
import { trackHref } from "@/components/challenge/track-config";
import { ToolChip, dayMdClassName } from "@/components/program/day-section-card";
import { cn } from "@/lib/utils";

type PlainTask = {
  title: string;
  problemStatement: string;
  learningObjectives: string[];
  resources: string[];
  difficulty: string;
  estimatedMinutes: number;
  linkedinTemplate: string;
};

type Props = {
  track: TrackConfig;
  dayNumber: number;
  task: PlainTask;
  enrollmentId: string;
  existingSubmission?: { githubUrl: string; linkedinUrl: string } | null;
  canSubmit: boolean;
  /** Past day inside the 5-day relaxation window. */
  isRelaxable: boolean;
};

/**
 * Day page for tracks whose DailyTask has no authored `dayContent` JSON — the
 * brief lives in `problemStatement` as markdown. Same chrome as
 * ChallengeDayView, driven by the columns that do exist.
 */
export function ChallengeTaskDayView({
  track,
  dayNumber,
  task,
  enrollmentId,
  existingSubmission,
  canSubmit,
  isRelaxable,
}: Props) {
  const backHref = trackHref(track, enrollmentId);

  return (
    <div className="bg-[#FBF9F7] px-5 py-8 font-content text-[#111111] sm:px-8">
      <div className="mx-auto w-full max-w-[1500px] space-y-5">
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
            <li>
              <Link
                href={backHref}
                className="text-[#8F8F8F] hover:text-[#E05226]"
              >
                {track.label}
              </Link>
            </li>
            <li aria-hidden className="text-[#8F8F8F]">
              &gt;
            </li>
            <li aria-current="page" className="font-semibold text-[#111111]">
              Day {dayNumber}
            </li>
          </ol>
        </nav>

        <header>
          <p className="font-heading text-[13px] leading-[18px] font-semibold uppercase text-[#E05226]">
            Day {dayNumber}
          </p>
          <h1 className="mt-1.5 max-w-3xl font-heading text-xl font-semibold tracking-tight text-[#111111] md:text-2xl">
            {task.title}
          </h1>
          <div className="mt-4 flex flex-wrap gap-2">
            <ToolChip label={task.difficulty} />
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#FFECE3] px-2 py-0.5 text-[12px] font-semibold text-[#E05226]">
              <Clock className="size-3" aria-hidden />~{task.estimatedMinutes} min
            </span>
          </div>
        </header>

        {isRelaxable ? (
          <div
            role="status"
            className="rounded-[12px] border border-[#E05226]/30 bg-[#FFECE3]/50 px-4 py-3 text-sm"
          >
            <p className="font-semibold text-[#111111]">Catch-up day</p>
            <p className="mt-1 text-[#4B4B4B]">
              You&apos;re submitting for Day {dayNumber}, a past day inside your
              5-day relaxation window. This will mark Day {dayNumber} complete
              and heal your current streak.
            </p>
          </div>
        ) : null}

        <DaySection title="Your Task" icon={<ListChecks aria-hidden />} defaultOpen>
          <div
            className={cn(
              dayMdClassName,
              // Briefs number their steps; dayMdClassName alone renders every
              // list item as a disc. Direct children only, so a nested bullet
              // list inside a numbered step keeps its disc.
              "[&_ol>li]:list-decimal [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:font-heading [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-[#111111] [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-heading [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-[#111111] [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:font-heading [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-[#111111] [&_ul]:mb-2 [&_ol]:mb-2",
            )}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {task.problemStatement}
            </ReactMarkdown>
          </div>
        </DaySection>

        {task.learningObjectives.length > 0 ? (
          <DaySection title="What You'll Learn" icon={<Lightbulb aria-hidden />}>
            <ul className="space-y-2 text-sm text-[#4B4B4B]">
              {task.learningObjectives.map((objective) => (
                <li key={objective} className="flex gap-2">
                  <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#E05226]" />
                  <span>{objective}</span>
                </li>
              ))}
            </ul>
          </DaySection>
        ) : null}

        {task.resources.length > 0 ? (
          <DaySection title="Resources" icon={<BookOpen aria-hidden />}>
            <ul className="space-y-2 text-sm">
              {task.resources.map((resource) => (
                <li key={resource} className="min-w-0">
                  <a
                    href={resource}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-[#E05226] underline-offset-4 hover:underline"
                  >
                    {resource}
                  </a>
                </li>
              ))}
            </ul>
          </DaySection>
        ) : null}

        {task.linkedinTemplate.trim() ? (
          <DaySection title="LinkedIn Post Template" icon={<Share2 aria-hidden />}>
            <p className="mb-3 text-sm text-[#8F8F8F]">
              Share your progress — a LinkedIn post earns bonus synergy.
            </p>
            <pre className="overflow-x-auto rounded-[8px] border border-[#E0E0E0] bg-[#FBF9F7] p-4 font-content text-sm leading-6 whitespace-pre-wrap text-[#4B4B4B]">
              {task.linkedinTemplate}
            </pre>
          </DaySection>
        ) : null}

        <DaySubmitPanel
          track={track}
          dayNumber={dayNumber}
          enrollmentId={enrollmentId}
          existingSubmission={existingSubmission}
          canSubmit={canSubmit}
        />
      </div>
    </div>
  );
}
