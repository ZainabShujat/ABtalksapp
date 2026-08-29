"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Check,
  Clock,
  Copy,
  ExternalLink,
  FileCode,
  FileOutput,
  Lightbulb,
  ListChecks,
  PlayCircle,
  Share2,
  Tag,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DayContent } from "@/components/challenge/day-content";
import { trackHref, type TrackConfig } from "@/components/challenge/track-config";
import { ToolChip } from "@/components/program/day-section-card";
import { DaySection } from "@/components/challenge/day-section";
import { DaySubmitPanel } from "@/components/challenge/day-submit-panel";
import { dsButtonVariants } from "@/components/design/ds-button";

function getYoutubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.slice(1) || null;
    }
    if (parsed.hostname.includes("youtube.com")) {
      if (parsed.pathname === "/watch") return parsed.searchParams.get("v");
      if (parsed.pathname.startsWith("/embed/")) {
        return parsed.pathname.split("/embed/")[1] || null;
      }
      if (parsed.pathname.startsWith("/shorts/")) {
        return parsed.pathname.split("/shorts/")[1] || null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

type Props = {
  track: TrackConfig;
  dayNumber: number;
  content: DayContent;
  enrollmentId: string;
  resources?: string[];
  existingSubmission?: { githubUrl: string; linkedinUrl: string } | null;
  /** True only when the user may create a new submission (not View-only). */
  canSubmit: boolean;
};

export function ChallengeDayView({
  track,
  dayNumber,
  content,
  enrollmentId,
  resources: resourcesProp,
  existingSubmission,
  canSubmit,
}: Props) {
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const solutionVideoUrl =
    content.solutionVideoUrl ?? content.task.solutionVideoUrl;
  const resources = resourcesProp ?? content.resources ?? [];
  const backHref = trackHref(track, enrollmentId);

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(content.promptTemplate);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      toast.error("Could not copy. Select the text manually");
    }
  };

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
          <p className="mt-1 text-xs text-[#8F8F8F]">{content.module}</p>
          <h1 className="mt-1.5 max-w-3xl font-heading text-xl font-semibold tracking-tight text-[#111111] md:text-2xl">
            {content.title}
          </h1>
          <p className="mt-2 text-[17px] leading-7 text-[#4B4B4B] italic">
            {content.tagline}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ToolChip label={content.difficulty} />
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#FFECE3] px-2 py-0.5 text-[12px] font-semibold text-[#E05226]">
              <Clock className="size-3" aria-hidden />~{content.estimatedMinutes}{" "}
              min
            </span>
            <ToolChip label={`Deliverable: ${content.deliverableFormat}`} />
          </div>
        </header>

        <DaySection title="Prompt Template" icon={<FileCode aria-hidden />}>
          <div className="mb-3">
            <button
              type="button"
              onClick={() => void handleCopyPrompt()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E0E0E0] px-3 py-1.5 text-sm font-medium text-[#111111] transition-colors hover:border-[#E05226] hover:text-[#E05226]"
            >
              {copiedPrompt ? (
                <>
                  <Check className="h-4 w-4 text-[#2E7D32]" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copy
                </>
              )}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-lg border border-[#E0E0E0] bg-[#FBF9F7] p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-[#4B4B4B] md:text-sm">
            {content.promptTemplate}
          </pre>
        </DaySection>

        {solutionVideoUrl ? (
          <DaySection title="Tutorial Video" icon={<PlayCircle aria-hidden />}>
            <p className="mb-3 text-xs text-[#8F8F8F]">
              Step-by-step video guide
            </p>
            {solutionVideoUrl.includes("REPLACE_WITH") ? (
              <p className="text-sm text-[#4B4B4B]">
                Tutorial video coming soon. Check back shortly.
              </p>
            ) : (
              <div className="space-y-3">
                {(() => {
                  const videoId = getYoutubeVideoId(solutionVideoUrl);
                  if (!videoId) return null;
                  return (
                    <div className="w-full overflow-hidden rounded-xl border border-[#E0E0E0] bg-black shadow-sm">
                      <div className="relative aspect-video">
                        <iframe
                          src={`https://www.youtube-nocookie.com/embed/${videoId}`}
                          title="Tutorial video player"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          className="absolute inset-0 h-full w-full"
                        />
                      </div>
                    </div>
                  );
                })()}
                <a
                  href={solutionVideoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(dsButtonVariants({ size: "sm" }), "inline-flex gap-2")}
                >
                  <PlayCircle className="h-4 w-4" />
                  Watch on YouTube
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </DaySection>
        ) : null}

        {content.tool ? (
          <DaySection title="Tool of the Day" icon={<Wrench aria-hidden />}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-semibold text-[#111111]">
                {content.tool.name}
              </span>
              <ToolChip label={content.tool.type} />
            </div>
            <p className="mb-4 text-sm leading-relaxed text-[#4B4B4B]">
              {content.tool.description}
            </p>
            <div className="mb-4 rounded-[12px] border border-[#E0E0E0] bg-[#FBF9F7] p-4">
              <h3 className="mb-3 text-sm font-semibold text-[#111111]">
                {content.tool.setupTitle}
              </h3>
              <ol className="space-y-2">
                {content.tool.setupSteps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#FFECE3] text-[10px] font-bold text-[#E05226]">
                      {i + 1}
                    </span>
                    <span className="flex-1 text-sm text-[#4B4B4B]">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
            <a
              href={content.tool.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(dsButtonVariants({ size: "sm" }), "inline-flex gap-2")}
            >
              {content.tool.linkLabel}
              <ExternalLink className="h-3 w-3" />
            </a>
          </DaySection>
        ) : null}

        <DaySection title={content.task.title} icon={<ListChecks aria-hidden />}>
          <ol className="space-y-3">
            {content.task.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#FFECE3] text-sm font-bold text-[#E05226]">
                  {i + 1}
                </span>
                <span className="pt-0.5 text-sm leading-relaxed text-[#111111]">
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </DaySection>

        <DaySection title="What You'll Learn" icon={<Lightbulb aria-hidden />}>
          <p className="mb-4 text-sm leading-relaxed text-[#4B4B4B]">
            {content.learning.summary}
          </p>
          <ol className="space-y-2.5">
            {content.learning.bullets.map((bullet, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#FFECE3] text-xs font-bold text-[#E05226]">
                  {i + 1}
                </span>
                <div className="flex-1 text-sm">
                  <span className="font-semibold text-[#111111]">
                    {bullet.label}:
                  </span>
                  <span className="text-[#4B4B4B]"> {bullet.text}</span>
                </div>
              </li>
            ))}
          </ol>
        </DaySection>

        {resources.length > 0 ? (
          <DaySection title="Resources" icon={<BookOpen aria-hidden />}>
            <ul className="space-y-2">
              {resources.map((url, i) => {
                let label = url;
                try {
                  const u = new URL(url);
                  label = u.hostname.replace("www.", "") + u.pathname;
                  if (label.endsWith("/")) label = label.slice(0, -1);
                } catch {
                  // fall back
                }
                return (
                  <li key={i}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-[#E05226] hover:underline"
                    >
                      <span className="break-all">{label}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </DaySection>
        ) : null}

        <DaySection title="LinkedIn Post Guidelines" icon={<Share2 aria-hidden />}>
          <p className="mb-2 text-xs text-[#8F8F8F]">{content.engagement.type}</p>
          <p className="mb-3 text-sm leading-relaxed text-[#4B4B4B]">
            {content.engagement.description}
          </p>
          <div className="mb-3 inline-flex items-center gap-2 rounded-[4px] bg-[#FFECE3] px-3 py-1 font-mono text-xs font-semibold text-[#E05226]">
            <Tag className="h-3 w-3" />
            {content.engagement.hashtag}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                {
                  label: "ANTHROPIC",
                  href: "https://www.linkedin.com/company/anthropicresearch/",
                },
                {
                  label: "ANIL BAJPAI",
                  href: "https://www.linkedin.com/in/anil-bajpai/",
                },
                {
                  label: "ABTALKSONAI",
                  href: "https://www.linkedin.com/company/abtalks-on-ai/",
                },
              ] as const
            ).map((chip) => (
              <a
                key={chip.href}
                href={chip.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: "#0A66C2" }}
              >
                {chip.label}
              </a>
            ))}
          </div>
        </DaySection>

        <DaySection title="Your Deliverable" icon={<FileOutput aria-hidden />}>
          <p className="text-sm text-[#4B4B4B]">
            {content.deliverable.description}
          </p>
          <span className="mt-2 inline-block font-mono text-xs font-semibold text-[#8F8F8F]">
            Format: {content.deliverable.format}
          </span>
        </DaySection>

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
