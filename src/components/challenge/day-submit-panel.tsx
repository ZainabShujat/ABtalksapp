"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Send } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { submitDayAction } from "@/app/actions/submission-actions";
import { useSynergy } from "@/components/shared/synergy-provider";
import { ClaudeSharePromptDialog } from "@/components/claude/claude-share-prompt-dialog";
import { CLAUDE_DAY0_SHARE_PENDING_KEY } from "@/components/claude/claude-day0-share-prompt";
import {
  isClaudeMilestoneDay,
  type ClaudeMilestoneDay,
} from "@/lib/claude-linkedin-prompts";
import { dsButtonVariants } from "@/components/design/ds-button";
import { trackHref, type TrackConfig } from "@/components/challenge/track-config";
import { cn } from "@/lib/utils";

type Props = {
  track: TrackConfig;
  dayNumber: number;
  enrollmentId: string;
  existingSubmission?: { githubUrl: string; linkedinUrl: string } | null;
  /** True only when the user may create a new submission (not View-only). */
  canSubmit: boolean;
};

/** Submit form + view-only fallback, shared by both day views. */
export function DaySubmitPanel({
  track,
  dayNumber,
  enrollmentId,
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
  const [milestoneDialogDay, setMilestoneDialogDay] =
    useState<ClaudeMilestoneDay | null>(null);

  const backHref = trackHref(track, enrollmentId);

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

  if (!canSubmit) {
    return (
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
                  <ExternalLink className="mt-0.5 size-3.5 shrink-0" aria-hidden />
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
                  <ExternalLink className="mt-0.5 size-3.5 shrink-0" aria-hidden />
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
          className={cn(dsButtonVariants({ size: "sm" }), "mt-4 inline-flex")}
        >
          Back to {track.label}
        </Link>
      </section>
    );
  }

  return (
    <>
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
    </>
  );
}
