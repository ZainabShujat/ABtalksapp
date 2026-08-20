"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lightbulb,
  Wrench,
  ListChecks,
  FileCode,
  Share2,
  FileOutput,
  Copy,
  Check,
  ExternalLink,
  Send,
  Clock,
  Award,
  Tag,
  PlayCircle,
  BookOpen,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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

// Matches CollapsibleSection's expand/collapse transition duration. When one
// section closes right before another opens, we wait for the close to finish
// before scrolling — otherwise the closing section's shrinking height keeps
// shifting the next section's position mid-scroll, so the browser lands on a
// moving target and the heading ends up scrolled past (over-scroll).
const SECTION_TRANSITION_MS = 400;

interface CollapsibleSectionProps {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  /** Controlled open state. Omit to let the section manage its own state. */
  open?: boolean;
  /** Fires with the next open state whenever the header is clicked. */
  onOpenChange?: (open: boolean) => void;
  animationDelay?: number;
  extraClassName?: string;
  children: React.ReactNode;
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

function CollapsibleSection({
  icon,
  iconBg,
  title,
  subtitle,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  animationDelay = 0.1,
  extraClassName,
  children,
}: CollapsibleSectionProps) {
  const isControlled = openProp !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = isControlled ? openProp : internalOpen;

  function handleToggle() {
    const next = !isOpen;
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: animationDelay, duration: 0.4 }}
      className={cn(
        "rounded-2xl border bg-card overflow-hidden",
        extraClassName,
      )}
    >
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center justify-between gap-3 p-4 md:p-6 hover:bg-muted/30 transition-colors text-left"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={`rounded-lg p-2 shrink-0 ${iconBg}`}>{icon}</div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display font-semibold text-base md:text-lg">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 ease-out",
            isOpen && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              duration: SECTION_TRANSITION_MS / 1000,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 md:px-6 md:pb-6">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

export interface LearningBullet {
  label: string;
  text: string;
}

export interface DayContent {
  title: string;
  tagline: string;
  module: string;
  difficulty: string;
  estimatedMinutes: number;
  deliverableFormat: string;
  learning: {
    summary: string;
    bullets: LearningBullet[];
  };
  tool?: {
    name: string;
    type: string;
    description: string;
    setupTitle: string;
    setupSteps: string[];
    linkUrl: string;
    linkLabel: string;
  };
  task: {
    title: string;
    steps: string[];
    solutionVideoUrl?: string;
  };
  solutionVideoUrl?: string;
  resources?: string[];
  promptTemplate: string;
  engagement: {
    type: string;
    description: string;
    hashtag: string;
  };
  deliverable: {
    description: string;
    format: string;
  };
}

interface Props {
  dayNumber: number;
  content: DayContent;
  enrollmentId: string;
  /** Seeded from DailyTask.resources when passed by the parent page */
  resources?: string[];
  existingSubmission?: { githubUrl: string; linkedinUrl: string } | null;
  canSubmit?: boolean;
}

export function DayPage({
  dayNumber,
  content,
  enrollmentId,
  resources: resourcesProp,
  existingSubmission,
  canSubmit = true,
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
  const [promptOpen, setPromptOpen] = useState(true);
  const [videoOpen, setVideoOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [milestoneDialogDay, setMilestoneDialogDay] =
    useState<ClaudeMilestoneDay | null>(null);

  const solutionVideoUrl =
    content.solutionVideoUrl ?? content.task.solutionVideoUrl;
  const resources = resourcesProp ?? content.resources ?? [];

  const scrollToSection = (id: string) => {
    // Two frames gives React/Framer Motion time to paint the section's open
    // state before we measure and scroll to it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document
          .getElementById(id)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  };

  function handlePromptOpenChange(next: boolean) {
    setPromptOpen(next);
    if (!next) {
      // Wait for Prompt Template to finish closing — otherwise its shrinking
      // height keeps shifting "Tutorial Video" upward while we're mid-scroll.
      setTimeout(() => {
        setVideoOpen(true);
        scrollToSection("tutorial-video-section");
      }, SECTION_TRANSITION_MS);
    }
  }

  function handleVideoOpenChange(next: boolean) {
    setVideoOpen(next);
    if (!next) {
      // Same reasoning: let "Tutorial Video" finish closing before opening/
      // scrolling to "Your Task".
      setTimeout(() => {
        setTaskOpen(true);
        scrollToSection("your-task-section");
      }, SECTION_TRANSITION_MS);
    }
  }

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(content.promptTemplate);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
      handlePromptOpenChange(false);
    } catch {
      toast.error("Could not copy. Select the text manually");
    }
  };

  function handleMoreClick() {
    setTaskOpen(true);
    scrollToSection("your-task-section");
  }

  const handleSubmit = async () => {
    if (!confirmed) {
      return;
    }

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
            ? `Day ${dayNumber} submitted! +${result.synergyAwarded} synergy 🔥`
            : `Day ${dayNumber} submitted! 🔥`;
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
        router.push(
          `/dashboard?challenge=${encodeURIComponent(enrollmentId)}`,
        );
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
    <div className="min-h-screen">
      {milestoneDialogDay != null ? (
        <ClaudeSharePromptDialog
          open
          day={milestoneDialogDay}
          onOpenChange={(open) => {
            if (!open) {
              setMilestoneDialogDay(null);
              router.push(
                `/dashboard?challenge=${encodeURIComponent(enrollmentId)}`,
              );
            }
          }}
        />
      ) : null}
      <main className="container mx-auto max-w-3xl space-y-6 px-4 py-6 md:px-6 md:py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-3"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{content.module}</span>
          </div>

          <div className="flex items-baseline gap-3">
            <span className="font-display text-sm font-bold tracking-wider text-primary uppercase">
              Day {dayNumber}
            </span>
          </div>

          <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
            {content.title}
          </h1>
          <p className="text-base text-muted-foreground italic md:text-lg">
            {content.tagline}
          </p>

          <button
            type="button"
            onClick={handleMoreClick}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            More
            <ChevronDown className="h-3.5 w-3.5" />
          </button>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
              <Award className="h-3 w-3" />
              {content.difficulty}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs">
              <Clock className="h-3 w-3" />
              {content.estimatedMinutes} min
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs">
              <FileOutput className="h-3 w-3" />
              Deliverable: {content.deliverableFormat}
            </span>
          </div>
        </motion.div>

        <CollapsibleSection
          icon={<FileCode className="h-5 w-5 text-violet-500" />}
          iconBg="bg-violet-500/10"
          title="Prompt Template"
          open={promptOpen}
          onOpenChange={handlePromptOpenChange}
          animationDelay={0.05}
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => void handleCopyPrompt()}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
            >
              {copiedPrompt ? (
                <>
                  <Check className="h-4 w-4 text-emerald-500" />
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

          <pre className="overflow-x-auto rounded-xl border bg-muted/50 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap md:text-sm">
            {content.promptTemplate}
          </pre>
        </CollapsibleSection>

        {solutionVideoUrl ? (
          <div id="tutorial-video-section" className="scroll-mt-20">
          <CollapsibleSection
            icon={<PlayCircle className="h-5 w-5 text-red-500" />}
            iconBg="bg-red-500/10"
            title="Tutorial Video"
            subtitle="Step-by-step video guide"
            open={videoOpen}
            onOpenChange={handleVideoOpenChange}
            animationDelay={0.15}
          >
            {solutionVideoUrl.includes("REPLACE_WITH") ? (
              <p className="text-sm text-muted-foreground">
                Tutorial Video video coming soon. Check back shortly.
              </p>
            ) : (
              <div className="space-y-3">
                {(() => {
                  const videoId = getYoutubeVideoId(solutionVideoUrl);
                  if (!videoId) return null;
                  return (
                    <div className="w-full overflow-hidden rounded-xl border bg-black shadow-sm">
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
                  className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600"
                >
                  <PlayCircle className="h-4 w-4" />
                  Watch on YouTube
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </CollapsibleSection>
          </div>
        ) : null}

        {content.tool ? (
          <CollapsibleSection
            icon={<Wrench className="h-5 w-5 text-orange-500" />}
            iconBg="bg-orange-500/10"
            title="Tool of the Day"
            subtitle={content.tool.name}
            animationDelay={0.2}
            extraClassName="border-2 border-orange-500/20 bg-gradient-to-br from-orange-500/5 to-pink-500/5"
          >
            <p className="mb-3 text-xs text-muted-foreground">
              {content.tool.type}
            </p>
            <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
              {content.tool.description}
            </p>

            <div className="mb-4 rounded-xl border bg-background/60 p-4">
              <h3 className="mb-3 text-sm font-semibold">
                {content.tool.setupTitle}
              </h3>
              <ol className="space-y-2">
                {content.tool.setupSteps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500/10 text-[10px] font-bold text-orange-600 dark:text-orange-400">
                      {i + 1}
                    </div>
                    <span className="flex-1 text-sm text-muted-foreground">
                      {step}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <a
              href={content.tool.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-600"
            >
              {content.tool.linkLabel}
              <ExternalLink className="h-3 w-3" />
            </a>
          </CollapsibleSection>
        ) : null}

        <div id="your-task-section" className="scroll-mt-20">
        <CollapsibleSection
          icon={<ListChecks className="h-5 w-5 text-emerald-500" />}
          iconBg="bg-emerald-500/10"
          title={content.task.title}
          open={taskOpen}
          onOpenChange={setTaskOpen}
          animationDelay={0.24}
        >
          <ol className="space-y-3">
            {content.task.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {i + 1}
                </div>
                <span className="pt-0.5 text-sm leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </CollapsibleSection>
        </div>

        <CollapsibleSection
          icon={<Lightbulb className="h-5 w-5 text-amber-500" />}
          iconBg="bg-amber-500/10"
          title="What You'll Learn"
          animationDelay={0.28}
        >
          <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
            {content.learning.summary}
          </p>

          <ol className="space-y-2.5">
            {content.learning.bullets.map((bullet, i) => (
              <li key={i} className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-xs font-bold text-amber-600 dark:text-amber-400">
                  {i + 1}
                </div>
                <div className="flex-1 text-sm">
                  <span className="font-semibold">{bullet.label}:</span>
                  <span className="text-muted-foreground"> {bullet.text}</span>
                </div>
              </li>
            ))}
          </ol>
        </CollapsibleSection>

        {resources.length > 0 ? (
          <CollapsibleSection
            icon={<BookOpen className="h-5 w-5 text-sky-500" />}
            iconBg="bg-sky-500/10"
            title="Resources"
            animationDelay={0.32}
          >
            <ul className="space-y-2">
              {resources.map((url, i) => {
                let label = url;
                try {
                  const u = new URL(url);
                  label = u.hostname.replace("www.", "") + u.pathname;
                  if (label.endsWith("/")) label = label.slice(0, -1);
                } catch {
                  // fall back to raw URL if parsing fails
                }

                return (
                  <li key={i}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-sky-600 hover:underline dark:text-sky-400"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="break-all">{label}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </CollapsibleSection>
        ) : null}

        <CollapsibleSection
          icon={<Share2 className="h-5 w-5 text-pink-500" />}
          iconBg="bg-pink-500/10"
          title="LinkedIn Post Guidelines"
          subtitle={content.engagement.type}
          animationDelay={0.36}
        >
          <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
            {content.engagement.description}
          </p>

          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-pink-500/10 px-3 py-1 font-mono text-xs font-semibold text-pink-600 dark:text-pink-400">
            <Tag className="h-3 w-3" />
            {content.engagement.hashtag}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 shrink-0"
              fill="#0A66C2"
              aria-hidden
            >
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
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
        </CollapsibleSection>

        <CollapsibleSection
          icon={<FileOutput className="h-5 w-5 text-blue-500" />}
          iconBg="bg-blue-500/10"
          title="Your Deliverable"
          animationDelay={0.4}
        >
          <p className="text-sm text-muted-foreground">
            {content.deliverable.description}
          </p>
          <span className="mt-2 inline-block font-mono text-xs font-semibold text-muted-foreground">
            Format: {content.deliverable.format}
          </span>
        </CollapsibleSection>

        {canSubmit ? (
          <div className="rounded-2xl border bg-card p-6 space-y-5">
            <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <input
                id="confirm-task"
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={submitting}
                className="mt-0.5 size-4 shrink-0 rounded border border-input accent-primary"
              />
              <label htmlFor="confirm-task" className="text-sm font-medium leading-snug">
                I confirm I have completed today&apos;s task.
              </label>
            </div>

            <div className="space-y-4">
              <p className="text-sm font-medium text-muted-foreground">
                Add proof (optional, earns more synergy)
              </p>
              <div className="space-y-2">
                <label htmlFor="github-url" className="text-sm font-medium">
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
                <p className="text-xs text-muted-foreground">Optional · +5 synergy</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="linkedin-url" className="text-sm font-medium">
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
                <p className="text-xs text-muted-foreground">Optional · +8 synergy</p>
              </div>
            </div>

            <Button
              onClick={() => void handleSubmit()}
              disabled={submitting || !confirmed}
              className="w-full gap-2 sm:w-auto"
            >
              <Send className="h-4 w-4" />
              {submitting ? "Submitting..." : `Submit Day ${dayNumber}`}
            </Button>
          </div>
        ) : (
          <div className="rounded-2xl border bg-card p-6 space-y-4">
            {existingSubmission &&
            (existingSubmission.githubUrl || existingSubmission.linkedinUrl) ? (
              <div className="space-y-3 text-sm">
                {existingSubmission.githubUrl ? (
                  <div className="space-y-1">
                    <p className="font-medium text-muted-foreground">GitHub</p>
                    <a
                      href={existingSubmission.githubUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                    >
                      {existingSubmission.githubUrl}
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  </div>
                ) : null}
                {existingSubmission.linkedinUrl ? (
                  <div className="space-y-1">
                    <p className="font-medium text-muted-foreground">LinkedIn</p>
                    <a
                      href={existingSubmission.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                    >
                      {existingSubmission.linkedinUrl}
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  </div>
                ) : null}
              </div>
            ) : null}
            <p className="text-sm text-muted-foreground">
              Submissions for this day are closed. You&apos;re viewing it for
              reference.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
