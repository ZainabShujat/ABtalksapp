"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Lock, Trophy } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  abandonInterviewAction,
  finishInterviewAction,
  startInterviewAction,
  submitInterviewAnswerAction,
} from "@/app/actions/interview-actions";
import { BLUEPRINT_LABEL } from "@/features/interview/cohort/blueprint";
import type {
  ClientQuestion,
  CohortInterviewOverview,
  FinishInterviewData,
} from "@/features/interview/service";

/**
 * TEMPORARY text runner for the AI Cohort milestone interview.
 *
 * This exists to prove the backend vertical slice end to end — start → question
 * → answer → evaluate → follow-up/next → finish → score — with a real member,
 * a real attempt row and real evidence extraction. It is NOT the shipping
 * experience: V1 is voice-based with camera and proctoring, and this component
 * is expected to be replaced by the voice runner rather than restyled.
 *
 * What it deliberately does NOT hold: the plan, the question list, the state
 * machine, evidence, scores, or eligibility. It knows only the single question
 * currently on the floor, because every turn is a server round-trip.
 */

type Line = {
  role: "interviewer" | "candidate";
  text: string;
  followUp?: boolean;
};

export function CohortInterviewRunner({
  overview,
  memberName,
}: {
  overview: CohortInterviewOverview;
  memberName: string;
}) {
  const router = useRouter();
  const { blueprint, eligibility, questionCount, result } = overview;

  const [live, setLive] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [question, setQuestion] = useState<ClientQuestion | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [finalResult, setFinalResult] = useState<FinishInterviewData | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  const idRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines, scoring]);

  const finish = useCallback(
    async (id: string) => {
      setScoring(true);
      const res = await finishInterviewAction({ interviewId: id });
      setScoring(false);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setFinalResult(res.data);
      setQuestion(null);
      router.refresh();
    },
    [router],
  );

  async function begin() {
    setStarting(true);
    setError(null);

    // The blueprint is sent, but the server re-derives eligibility before
    // opening anything — this value cannot unlock a milestone on its own.
    const started = await startInterviewAction({ blueprint });
    setStarting(false);

    if (!started.ok) {
      setError(started.message);
      return;
    }

    idRef.current = started.data.interviewId;
    setQuestion(started.data.question);
    setLines([{ role: "interviewer", text: started.data.question.text }]);
    setLive(true);
  }

  function send() {
    const id = idRef.current;
    const text = answer.trim();
    if (!id || !question || text.length === 0 || pending) return;

    setError(null);
    setLines((prev) => [...prev, { role: "candidate", text }]);
    setAnswer("");

    startTransition(async () => {
      const turn = await submitInterviewAnswerAction({
        interviewId: id,
        questionId: question.id,
        answerText: text,
      });

      if (!turn.ok) {
        setError(turn.message);
        return;
      }

      if (turn.data.prompt) {
        setLines((prev) => [
          ...prev,
          {
            role: "interviewer",
            text: turn.data.prompt as string,
            followUp: turn.data.isFollowUp,
          },
        ]);
      }

      if (turn.data.finished) {
        setQuestion(null);
        await finish(id);
        return;
      }

      if (turn.data.question) setQuestion(turn.data.question);
    });
  }

  async function leave() {
    const id = idRef.current;
    if (id) await abandonInterviewAction({ interviewId: id });
    router.push("/program/dashboard");
  }

  /* ------------------------------------------------------------- result */

  if (finalResult) {
    return (
      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {BLUEPRINT_LABEL[blueprint]}
          </h1>
        </header>
        <div className="rounded-xl border p-6">
          <div className="flex items-center gap-2">
            <Trophy className="size-5 text-amber-500" />
            <p className="font-display text-3xl font-bold">
              {finalResult.scores.overallScore}/100
            </p>
            <span className="text-sm text-muted-foreground">overall</span>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {finalResult.scores.perCompetency.map((entry) => (
              <div
                key={entry.competency}
                className="rounded-lg border px-3 py-2"
              >
                <p className="text-xs text-muted-foreground">
                  {entry.competency.replace(/_/g, " ").toLowerCase()}
                </p>
                <p className="font-display text-lg font-bold">
                  {entry.score}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {entry.tier.toLowerCase()}
                  </span>
                </p>
              </div>
            ))}
          </div>
          {finalResult.scores.summary && (
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {finalResult.scores.summary}
            </p>
          )}
        </div>
        <Link
          href="/program/dashboard"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  /* --------------------------------------------------------------- live */

  if (live) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-sm font-medium">
            {question
              ? `Question ${question.order} of ${question.totalQuestions}`
              : "Wrapping up"}
          </p>
          <button
            type="button"
            onClick={() => void leave()}
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            Leave without finishing
          </button>
        </div>

        <div className="rounded-xl border">
          <div className="max-h-[46vh] space-y-5 overflow-y-auto px-5 py-5">
            {lines.map((line, i) => (
              <div key={i}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {line.role === "interviewer"
                    ? line.followUp
                      ? "Follow-up"
                      : "Interviewer"
                    : "You"}
                </p>
                <p className="mt-1 text-sm leading-relaxed">{line.text}</p>
              </div>
            ))}
            {(pending || scoring) && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {scoring ? "Scoring your interview" : "Considering your answer"}
              </p>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t px-5 py-4">
            <label htmlFor="answer" className="text-sm font-medium">
              Your answer
            </label>
            <textarea
              id="answer"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={5}
              disabled={!question || pending || scoring}
              placeholder="Answer in your own words. Specifics from what you actually built count for more than definitions."
              className="mt-2 w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm leading-relaxed outline-none disabled:opacity-50"
            />
            {error && (
              <p className="mt-2 text-sm text-destructive">{error}</p>
            )}
            <div className="mt-3 flex items-center gap-3">
              <Button
                type="button"
                onClick={send}
                disabled={
                  !question || answer.trim().length === 0 || pending || scoring
                }
              >
                Send answer
              </Button>
              <span className="text-xs text-muted-foreground">
                Ctrl or Cmd + Enter
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* --------------------------------------------------------------- gate */

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          {BLUEPRINT_LABEL[blueprint]}
        </h1>
        <p className="text-sm text-muted-foreground">
          Hi {memberName} — {questionCount} standardized questions drawn from the
          cohort curriculum you have completed. Every candidate at this milestone
          answers the same questions, and it can be taken once.
        </p>
      </header>

      {eligibility.state === "locked" && (
        <div className="flex items-start gap-3 rounded-xl border p-6">
          <Lock className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">Not available yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {eligibility.reason} You have passed {eligibility.passedCount} of{" "}
              {eligibility.needed} required days.
            </p>
          </div>
        </div>
      )}

      {eligibility.state === "taken" && (
        <div className="flex items-start gap-3 rounded-xl border p-6">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-500" />
          <div>
            <p className="font-medium">Already completed</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {result?.overallScore !== null && result?.overallScore !== undefined
                ? `You scored ${result.overallScore}/100 overall.`
                : "Your result is being scored."}
              {result?.summary ? ` ${result.summary}` : ""}
            </p>
          </div>
        </div>
      )}

      {(eligibility.state === "ready" || eligibility.state === "in_progress") && (
        <div className="space-y-4 rounded-xl border p-6">
          {eligibility.state === "in_progress" && (
            <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm">
              You have an interview open. Continuing picks up where you left off
              — it does not start a new attempt.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Answers are typed for now. The voice experience lands in the next
            phase; nothing about how you are scored changes.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" onClick={() => void begin()} disabled={starting}>
            {starting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Preparing
              </>
            ) : eligibility.state === "in_progress" ? (
              "Resume interview"
            ) : (
              "Start interview"
            )}
          </Button>
        </div>
      )}

      <Link
        href="/program/dashboard"
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        Back to dashboard
      </Link>
    </div>
  );
}
