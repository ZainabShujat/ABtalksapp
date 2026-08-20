"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Mic } from "lucide-react";
import { startInterviewAction } from "@/app/actions/interview-actions";
import {
  BLUEPRINT_LABEL,
  type InterviewBlueprintKey,
} from "@/features/interview/cohort/blueprint";
import type {
  ClientQuestion,
  FinishInterviewData,
} from "@/features/interview/service";
import { InterviewRoom } from "@/components/interview/cohort/interview-room";
import { MicCheck } from "@/components/interview/cohort/mic-check";
import "./interview.css";

/**
 * The candidate's path through one milestone interview: brief → room → done.
 *
 * Deliberately three states and no more. The earlier prototype had seven
 * (intro, consent, device check, ready, live, completion, result) driven by a
 * mock hook; most of them asked the candidate to acknowledge something before
 * anything real happened. Microphone permission is requested by the browser at
 * the moment it is needed, which is both the honest place for it and the only
 * place a permission prompt actually works.
 *
 * This component owns no interview logic. It starts an attempt through the
 * real Server Action and hands the id to the room.
 */

type Stage =
  | { name: "brief" }
  | { name: "live"; interviewId: string; question: ClientQuestion }
  | { name: "done"; result: FinishInterviewData };

export function InterviewSession({
  blueprint,
  candidateName,
  questionCount,
  durationSec,
}: {
  blueprint: InterviewBlueprintKey;
  candidateName: string;
  /** Used only for the "about N questions" framing, never as a progress bar. */
  questionCount: number;
  durationSec: number;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ name: "brief" });
  const [starting, setStarting] = useState(false);
  /**
   * Null until the candidate runs the check. Recorded but never enforced —
   * a failed microphone must not block a milestone that can be answered by
   * typing.
   */
  const [micWorking, setMicWorking] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const title = BLUEPRINT_LABEL[blueprint];
  const minutes = Math.round(durationSec / 60);

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

    setStage({
      name: "live",
      interviewId: started.data.interviewId,
      question: started.data.question,
    });
  }

  /* --------------------------------------------------------------- brief */

  if (stage.name === "brief") {
    return (
      <div className="interview-room mx-auto w-full max-w-2xl py-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--iv-text-faint)]">
          AI Cohort
        </p>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-[var(--iv-text)] md:text-3xl">
          {title}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--iv-text-muted)]">
          A spoken technical interview about the work you have already submitted
          in this cohort. The interviewer asks about what you built, and will
          follow up on your answers.
        </p>

        <ul className="mt-6 space-y-2.5 text-[14px] text-[var(--iv-text-muted)]">
          <li className="flex gap-3">
            <span className="text-[var(--iv-text-faint)]">•</span>
            Around {minutes} minutes, roughly {questionCount} questions plus
            follow-ups.
          </li>
          <li className="flex gap-3">
            <span className="text-[var(--iv-text-faint)]">•</span>
            Answer out loud. Your microphone is requested when you start.
          </li>
          <li className="flex gap-3">
            <span className="text-[var(--iv-text-faint)]">•</span>
            You can type instead at any point.
          </li>
          <li className="flex gap-3">
            <span className="text-[var(--iv-text-faint)]">•</span>
            This milestone can be taken once.
          </li>
        </ul>

        <div className="mt-7">
          <MicCheck onResultAction={setMicWorking} />
        </div>

        {error ? (
          <p className="mt-5 text-[13px] text-[#F98080]" role="status">
            {error}
          </p>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void begin()}
            disabled={starting}
            className="inline-flex h-11 items-center gap-2 rounded-[12px] border border-[var(--iv-accent)]/50 bg-[var(--iv-accent)]/15 px-5 text-[14px] font-semibold text-[var(--iv-text)] transition-colors hover:bg-[var(--iv-accent)]/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {starting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Starting…
              </>
            ) : (
              <>
                <Mic className="size-4" strokeWidth={1.75} />{" "}
                {micWorking === false ? "Start interview (typing)" : "Start interview"}
              </>
            )}
          </button>
          <Link
            href="/program/dashboard"
            className="text-[14px] text-[var(--iv-text-muted)] underline underline-offset-4 transition-colors hover:text-[var(--iv-text)]"
          >
            Not now
          </Link>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- live */

  if (stage.name === "live") {
    return (
      <InterviewRoom
        interviewId={stage.interviewId}
        title={title}
        firstQuestion={stage.question}
        candidateName={candidateName.split(" ")[0] ?? "You"}
        onFinishedAction={(result) => setStage({ name: "done", result })}
        onAbandonedAction={() => {
          setStage({ name: "brief" });
          router.refresh();
        }}
      />
    );
  }

  /* ---------------------------------------------------------------- done */

  return (
    <div className="interview-room mx-auto w-full max-w-2xl py-10">
      <div className="flex items-center gap-2.5">
        <CheckCircle2 className="size-5 text-[#6AE276]" strokeWidth={1.75} />
        <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--iv-text)]">
          Interview complete
        </h1>
      </div>

      {/*
        No score here on purpose. The candidate has just spent fifteen minutes
        being assessed; the first thing they see should be that it landed
        safely, not a number they have no context for yet. The report explains
        itself, and it is one click away.
      */}
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--iv-text-muted)]">
        Your interview has been recorded and assessed. The full report covers
        module performance, competencies and the evidence behind each
        observation.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link
          href={`/program/cohort-interview/${blueprint}/report`}
          className="inline-flex h-11 items-center rounded-[12px] border border-[var(--iv-accent)]/50 bg-[var(--iv-accent)]/15 px-5 text-[14px] font-semibold text-[var(--iv-text)] transition-colors hover:bg-[var(--iv-accent)]/25"
        >
          View interview report
        </Link>
        <Link
          href="/program/dashboard"
          className="text-[14px] text-[var(--iv-text-muted)] underline underline-offset-4 transition-colors hover:text-[var(--iv-text)]"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
