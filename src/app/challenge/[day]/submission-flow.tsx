"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DailyTask, Domain } from "@prisma/client";
import confetti from "canvas-confetti";
import {
  Calendar,
  CheckCircle,
  CheckCircle2,
  Flame,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitDayAction } from "@/app/actions/submission-actions";

type Props = {
  dayNumber: number;
  /** When set, submissions target this enrollment (multi-track users). */
  enrollmentId?: string;
  task: Pick<DailyTask, "title" | "problemStatement">;
  userDomain: Domain;
  isRelaxable?: boolean;
  canSubmit?: boolean;
};

function RelaxationBanner({ dayNumber }: { dayNumber: number }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <p className="font-medium">Catch-up day</p>
      <p className="mt-1 text-amber-900/90 dark:text-amber-100/90">
        You&apos;re submitting for Day {dayNumber}, a past day inside your
        5-day relaxation window. This will mark Day {dayNumber} green on your
        heatmap and heal your current streak.
      </p>
    </div>
  );
}

export function SubmissionFlow({
  dayNumber,
  enrollmentId,
  task,
  userDomain,
  isRelaxable = false,
  canSubmit = true,
}: Props) {
  const [step, setStep] = useState<"form" | "success">("form");
  const [githubUrl, setGithubUrl] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successStreak, setSuccessStreak] = useState(0);
  const [successDaysCompleted, setSuccessDaysCompleted] = useState(0);

  useEffect(() => {
    if (step !== "success") return;
    const colors = ["#6366f1", "#818cf8", "#34d399", "#fbbf24", "#f472b6"];
    void confetti({
      particleCount: 72,
      spread: 70,
      origin: { y: 0.68 },
      ticks: 140,
      scalar: 0.95,
      colors,
      disableForReducedMotion: true,
    });
    const t1 = window.setTimeout(() => {
      void confetti({
        particleCount: 28,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.65 },
        colors,
        disableForReducedMotion: true,
      });
    }, 350);
    const t2 = window.setTimeout(() => {
      void confetti({
        particleCount: 28,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.65 },
        colors,
        disableForReducedMotion: true,
      });
    }, 700);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [step]);

  const challengeQs = enrollmentId
    ? `?challenge=${encodeURIComponent(enrollmentId)}`
    : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("githubUrl", githubUrl);
      fd.append("linkedinUrl", linkedinUrl);
      fd.append("dayNumber", String(dayNumber));
      fd.append("confirmed", "true");
      if (enrollmentId) fd.append("enrollmentId", enrollmentId);
      const res = await submitDayAction(fd);
      if (!res.ok) {
        setError(res.message);
        toast.error(res.message);
        return;
      }
      setSuccessStreak(res.newStreak);
      setSuccessDaysCompleted(res.daysCompleted);
      setStep("success");
      const synergyMsg =
        res.synergyAwarded !== undefined
          ? `Day ${dayNumber} complete! +${res.synergyAwarded} synergy`
          : `Day ${dayNumber} complete!`;
      toast.success(synergyMsg);
    } finally {
      setIsSubmitting(false);
    }
  }

  const daysRemaining = Math.max(0, 60 - successDaysCompleted);
  const journeyPct = Math.min(100, Math.round((successDaysCompleted / 60) * 100));
  const completedDay60 = dayNumber === 60;

  if (step === "success") {
    if (completedDay60) {
      return (
        <div className="w-full space-y-10 py-4">
          <div className="flex flex-col items-center space-y-6 text-center">
            <div
              className="flex size-28 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/50"
              aria-hidden
            >
              <span className="text-6xl leading-none">🏆</span>
            </div>
            <div className="space-y-3">
              <h2 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
                60 Day Challenge Complete!
              </h2>
              <p className="text-lg text-muted-foreground">
                You&apos;re now Ready for Interview
              </p>
              <p className="text-base text-muted-foreground">
                Recruiters can now find your profile
              </p>
            </div>
          </div>

          <div className="flex justify-center">
            <Link
              href="/profile"
              className={cn(
                buttonVariants({ variant: "default", size: "lg" }),
                "h-12 min-w-[220px] px-8 text-base font-medium",
              )}
            >
              View Your Profile
            </Link>
          </div>
        </div>
      );
    }

    return (
      <div className="w-full space-y-10 py-2">
        <div className="flex flex-col items-center space-y-6 text-center">
          <div
            className="flex size-28 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/50"
            aria-hidden
          >
            <CheckCircle2 className="size-20 text-emerald-500" strokeWidth={1.75} />
          </div>
          <div className="space-y-3">
            <h2 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
              Day {dayNumber} Complete! 🎉
            </h2>
            <p className="text-lg text-muted-foreground">
              You showed up. That&apos;s what counts.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="border-border/50 p-0 shadow-sm">
            <CardContent className="space-y-3 p-8">
              <Flame
                className="size-8 text-orange-500"
                strokeWidth={2}
                aria-hidden
              />
              <p className="font-display text-4xl font-bold tabular-nums">
                {successStreak}
              </p>
              <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
                Day streak
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/50 p-0 shadow-sm">
            <CardContent className="space-y-3 p-8">
              <CheckCircle
                className="size-8 text-emerald-500"
                strokeWidth={2}
                aria-hidden
              />
              <p className="font-display text-4xl font-bold tabular-nums">
                {successDaysCompleted}
                <span className="text-2xl font-semibold text-muted-foreground">
                  {" "}
                  / 60
                </span>
              </p>
              <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
                Days completed
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/50 p-0 shadow-sm">
            <CardContent className="space-y-3 p-8">
              <Calendar
                className="size-8 text-blue-500"
                strokeWidth={2}
                aria-hidden
              />
              <p className="font-display text-4xl font-bold tabular-nums">
                {daysRemaining}
              </p>
              <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
                Days to go
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-2">
          <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-primary-foreground transition-all duration-500"
              style={{ width: `${journeyPct}%` }}
            />
          </div>
          <p className="text-center text-sm text-muted-foreground">
            {journeyPct}% of your 60-day journey
          </p>
        </div>

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <Link
            href={`/dashboard${challengeQs}`}
            className={cn(
              buttonVariants({ variant: "default", size: "lg" }),
              "h-12 min-w-[200px] px-8 text-base font-medium",
            )}
          >
            Back to Dashboard
          </Link>
          {dayNumber < 60 ? (
            <Link
              href={`/challenge/${dayNumber + 1}${challengeQs}`}
              className={cn(
                buttonVariants({ variant: "secondary", size: "lg" }),
                "h-12 min-w-[200px] px-8 text-base font-medium",
              )}
            >
              View Day {dayNumber + 1}
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {canSubmit && isRelaxable ? (
        <RelaxationBanner dayNumber={dayNumber} />
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{task.title}</CardTitle>
          <CardDescription>
            Day {dayNumber} · {userDomain}
          </CardDescription>
        </CardHeader>
        <CardContent className="max-w-none space-y-3 text-sm leading-relaxed whitespace-pre-wrap [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
          <ReactMarkdown>{task.problemStatement}</ReactMarkdown>
        </CardContent>
      </Card>

      {canSubmit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Submit your solution</CardTitle>
            <CardDescription>
              Confirm you completed today&apos;s task. GitHub and LinkedIn are
              optional proof for bonus synergy.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <input
                  id="confirm-task"
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  disabled={isSubmitting}
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
                  <Label htmlFor="githubUrl">GitHub URL</Label>
                  <Input
                    id="githubUrl"
                    name="githubUrl"
                    type="url"
                    placeholder="GitHub commit or repo URL"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    autoComplete="off"
                    disabled={isSubmitting}
                    aria-invalid={!!error}
                  />
                  <p className="text-xs text-muted-foreground">Optional · +5 synergy</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="linkedinUrl">LinkedIn URL</Label>
                  <Input
                    id="linkedinUrl"
                    name="linkedinUrl"
                    type="url"
                    placeholder="https://www.linkedin.com/posts/…"
                    value={linkedinUrl}
                    onChange={(e) => setLinkedinUrl(e.target.value)}
                    autoComplete="off"
                    disabled={isSubmitting}
                  />
                  <p className="text-xs text-muted-foreground">Optional · +8 synergy</p>
                </div>
              </div>

              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={isSubmitting || !confirmed}>
                {isSubmitting ? "Submitting…" : `Submit Day ${dayNumber}`}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Submissions for this day are closed — viewing for reference.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
