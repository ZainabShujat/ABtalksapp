"use client";

import { type ReactNode, useId, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Check,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  FileCode,
  FileOutput,
  Lightbulb,
  ListChecks,
  PlayCircle,
  Send,
  Share2,
  Tag,
  type LucideIcon,
  Wrench,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { submitDayAction } from "@/app/actions/submission-actions";
import { useSynergy } from "@/components/shared/synergy-provider";
import { ClaudeSharePromptDialog } from "@/components/claude/claude-share-prompt-dialog";
import { CLAUDE_DAY0_SHARE_PENDING_KEY } from "@/components/claude/claude-day0-share-prompt";
import {
  isClaudeMilestoneDay,
  type ClaudeMilestoneDay,
} from "@/lib/claude-linkedin-prompts";
import type { DayContent } from "@/components/challenge/day-page";
import { ToolChip } from "@/components/program/day-section-card";
import { dsButtonVariants } from "@/components/design/ds-button";

function ClaudeDaySection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <section className="overflow-hidden rounded-[12px] border border-[#E0E0E0] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      <h2>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-[#FBF9F7] focus-visible:ring-2 focus-visible:ring-[#E05226] focus-visible:ring-inset md:px-5 md:py-5"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#FFECE3]">
              <Icon className="size-4 text-[#E05226]" aria-hidden />
            </span>
            <span className="font-heading text-base font-semibold text-[#111111] md:text-lg">
              {title}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "size-5 shrink-0 text-[#8F8F8F] transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </h2>
      {open ? (
        <div
          id={panelId}
          className="border-t border-[#E0E0E0] px-4 py-4 md:px-5 md:py-5"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

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
  dayNumber: number;
  content: DayContent;
  enrollmentId: string;
  resources?: string[];
  existingSubmission?: { githubUrl: string; linkedinUrl: string } | null;
  /** True only when the user may create a new submission (not View-only). */
  canSubmit: boolean;
};

export function ClaudeDayView({
  dayNumber,
  content,
  enrollmentId,
  resources: resourcesProp,
  existingSubmission,
  canSubmit,
}: Props) {
  const router = useRouter();
  const { refresh } = useSynergy();
  const [githubUrl, setGithubUrl] = useState(
    existingSubmission?.githubUrl ?? "",
  );
  const [linkedinUrl, setLinkedinUrl] = useState(
    existingSubmission?.linkedinUrl ?? "",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [milestoneDialogDay, setMilestoneDialogDay] =
    useState<ClaudeMilestoneDay | null>(null);

  const solutionVideoUrl =
    content.solutionVideoUrl ?? content.task.solutionVideoUrl;
  const resources = resourcesProp ?? content.resources ?? [];
  const backHref = `/claude?challenge=${encodeURIComponent(enrollmentId)}`;

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(content.promptTemplate);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      toast.error("Could not copy. Select the text manually");
    }
  };

  const handleSubmit = async () => {
    if (!confirmed) return;

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("githubUrl", githubUrl.trim());
      fd.append("linkedinUrl", linkedinUrl.trim());
      fd.append("dayNumber", String(dayNumber));
      fd.append("enrollmentId", enrollmentId);
      fd.append("confirmed", "true");

      const result = await submitDayAction(fd);

      if (result.ok) {
        refresh();
        const synergyMsg =
          result.synergyAwarded !== undefined
            ? `Day ${dayNumber} submitted! +${result.synergyAwarded} synergy`
            : `Day ${dayNumber} submitted!`;
        toast.success(synergyMsg);
        if (dayNumber === 1) {
          try {
            window.localStorage.removeItem(CLAUDE_DAY0_SHARE_PENDING_KEY);
          } catch {
            // ignore
          }
        }
        if (isClaudeMilestoneDay(dayNumber)) {
          setMilestoneDialogDay(dayNumber);
          setSubmitting(false);
          return;
        }
        router.push(backHref);
      } else {
        toast.error(result.message);
        setSubmitting(false);
      }
    } catch {
      toast.error("Submission failed");
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-[#FBF9F7] px-5 py-8 font-content text-[#111111] sm:px-8">
      {milestoneDialogDay != null ? (
        <ClaudeSharePromptDialog
          open
          day={milestoneDialogDay}
          onOpenChange={(open) => {
            if (!open) {
              setMilestoneDialogDay(null);
              router.push(backHref);
            }
          }}
        />
      ) : null}

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
                Claude Challenge
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

        <ClaudeDaySection title="Prompt Template" icon={FileCode}>
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
        </ClaudeDaySection>

        {solutionVideoUrl ? (
          <ClaudeDaySection title="Tutorial Video" icon={PlayCircle}>
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
          </ClaudeDaySection>
        ) : null}

        {content.tool ? (
          <ClaudeDaySection title="Tool of the Day" icon={Wrench}>
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
          </ClaudeDaySection>
        ) : null}

        <ClaudeDaySection title={content.task.title} icon={ListChecks}>
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
        </ClaudeDaySection>

        <ClaudeDaySection title="What You'll Learn" icon={Lightbulb}>
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
        </ClaudeDaySection>

        {resources.length > 0 ? (
          <ClaudeDaySection title="Resources" icon={BookOpen}>
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
          </ClaudeDaySection>
        ) : null}

        <ClaudeDaySection title="LinkedIn Post Guidelines" icon={Share2}>
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
        </ClaudeDaySection>

        <ClaudeDaySection title="Your Deliverable" icon={FileOutput}>
          <p className="text-sm text-[#4B4B4B]">
            {content.deliverable.description}
          </p>
          <span className="mt-2 inline-block font-mono text-xs font-semibold text-[#8F8F8F]">
            Format: {content.deliverable.format}
          </span>
        </ClaudeDaySection>

        {canSubmit ? (
          <section className="rounded-[12px] border border-[#E0E0E0] bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] md:p-5">
            <h2 className="mb-4 font-heading text-base font-semibold text-[#111111] md:text-lg">
              Submit Day {dayNumber}
            </h2>
            <div className="space-y-5">
              <div className="flex items-start gap-3 rounded-[12px] border border-[#E05226]/30 bg-[#FFECE3]/50 p-4">
                <input
                  id="confirm-task"
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  disabled={submitting}
                  className="mt-0.5 size-4 shrink-0 rounded border border-[#E0E0E0] accent-[#E05226]"
                />
                <label
                  htmlFor="confirm-task"
                  className="text-sm font-medium leading-snug text-[#111111]"
                >
                  I confirm I have completed today&apos;s task.
                </label>
              </div>

              <div className="space-y-4">
                <p className="text-sm font-medium text-[#8F8F8F]">
                  Add proof (optional, earns more synergy)
                </p>
                <div className="space-y-2">
                  <label
                    htmlFor="github-url"
                    className="text-sm font-medium text-[#111111]"
                  >
                    GitHub URL
                  </label>
                  <Input
                    id="github-url"
                    type="url"
                    placeholder="GitHub commit or repo URL"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    className="text-sm"
                    disabled={submitting}
                  />
                  <p className="text-xs text-[#8F8F8F]">Optional · +5 synergy</p>
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="linkedin-url"
                    className="text-sm font-medium text-[#111111]"
                  >
                    LinkedIn URL
                  </label>
                  <Input
                    id="linkedin-url"
                    type="url"
                    placeholder="LinkedIn post URL"
                    value={linkedinUrl}
                    onChange={(e) => setLinkedinUrl(e.target.value)}
                    className="text-sm"
                    disabled={submitting}
                  />
                  <p className="text-xs text-[#8F8F8F]">Optional · +8 synergy</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={submitting || !confirmed}
                className={cn(
                  dsButtonVariants({ size: "default" }),
                  "inline-flex w-full gap-2 sm:w-auto",
                  (submitting || !confirmed) && "opacity-60",
                )}
              >
                <Send className="h-4 w-4" />
                {submitting ? "Submitting..." : `Submit Day ${dayNumber}`}
              </button>
            </div>
          </section>
        ) : (
          <section className="min-w-0 overflow-hidden rounded-[12px] border border-[#E0E0E0] bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] md:p-5">
            <h2 className="mb-4 font-heading text-base font-semibold text-[#111111] md:text-lg">
              {existingSubmission ? "Your submission" : "View only"}
            </h2>
            {existingSubmission &&
            (existingSubmission.githubUrl || existingSubmission.linkedinUrl) ? (
              <div className="mb-4 min-w-0 space-y-3 text-sm">
                {existingSubmission.githubUrl ? (
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-[#8F8F8F]">GitHub</p>
                    <a
                      href={existingSubmission.githubUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex max-w-full items-start gap-1 text-[#E05226] underline-offset-4 hover:underline"
                    >
                      <span className="min-w-0 flex-1 break-all">
                        {existingSubmission.githubUrl}
                      </span>
                      <ExternalLink
                        className="mt-0.5 size-3.5 shrink-0"
                        aria-hidden
                      />
                    </a>
                  </div>
                ) : null}
                {existingSubmission.linkedinUrl ? (
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-[#8F8F8F]">LinkedIn</p>
                    <a
                      href={existingSubmission.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex max-w-full items-start gap-1 text-[#E05226] underline-offset-4 hover:underline"
                    >
                      <span className="min-w-0 flex-1 break-all">
                        {existingSubmission.linkedinUrl}
                      </span>
                      <ExternalLink
                        className="mt-0.5 size-3.5 shrink-0"
                        aria-hidden
                      />
                    </a>
                  </div>
                ) : null}
              </div>
            ) : null}
            <p className="text-sm text-[#4B4B4B]">
              {existingSubmission
                ? "You've completed this day. Submissions cannot be edited from this page after the window closes."
                : "Submissions for this day are closed. You're viewing it for reference."}
            </p>
            <Link
              href={backHref}
              className={cn(
                dsButtonVariants({ size: "sm" }),
                "mt-4 inline-flex",
              )}
            >
              Back to Claude Challenge
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}
