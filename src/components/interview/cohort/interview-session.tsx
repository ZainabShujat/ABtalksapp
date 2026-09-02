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
import { PROGRAM_AI_COHORT_BASE } from "@/features/program/constants";
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
  | {
    name: "live";
    interviewId: string;
    question: ClientQuestion;
    /** Full opening line + first question, as the server composed it. */
    openingPrompt?: string;
  }
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
  /**
   * Set only when the microphone check has recorded speech AND had it
   * transcribed. The interview cannot be started until it has: a candidate
   * whose audio never reaches the transcriber would otherwise spend their one
   * attempt finding that out.
   */
  const [micVerified, setMicVerified] = useState(false);
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
      openingPrompt: started.data.prompt,
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
            This milestone can be taken once.
          </li>
        </ul>

        <div className="mt-7">
          <MicCheck onResultAction={setMicVerified} />
        </div>

        {error ? (
          <p className="mt-5 text-[13px] text-[#C9282B]" role="status">
            {error}
          </p>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void begin()}
            disabled={starting || !micVerified}
            className="inline-flex h-11 items-center gap-2 rounded-[12px] border border-[var(--iv-accent)]/50 bg-[var(--iv-accent)]/15 px-5 text-[14px] font-semibold text-[var(--iv-text)] transition-colors hover:bg-[var(--iv-accent)]/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {starting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Starting…
              </>
            ) : (
              <>
                <Mic className="size-4" strokeWidth={1.75} /> Start interview
              </>
            )}
          </button>
          <Link
            href={`${PROGRAM_AI_COHORT_BASE}/dashboard`}
            className="text-[14px] text-[var(--iv-text-muted)] underline underline-offset-4 transition-colors hover:text-[var(--iv-text)]"
          >
            Not now
          </Link>
        </div>

        {!micVerified ? (
          <p className="mt-3 text-[13px] text-[var(--iv-text-muted)]">
            Run the microphone check above to start. It confirms we can hear and
            transcribe you, so you don&apos;t spend your one attempt discovering
            otherwise.
          </p>
        ) : null}
      </div>
    );
  }

  // The cohort's interruption callback was DELETED, not merely unwired.
  //
  // Leaving it in place after the props were removed made it both dead code and
  // a conditionally-called hook — it sat after the `brief` early return, so
  // React's rules-of-hooks lint failed on it. The server side
  // (`recordCohortInterruption`, the provider method, the action and its
  // schema) is deliberately kept; re-enabling barge-in here means restoring
  // this callback and passing the three props below.

  /* ---------------------------------------------------------------- live */

  if (stage.name === "live") {
    return (
      <InterviewRoom
        interviewId={stage.interviewId}
        title={title}
        firstQuestion={stage.question}
        openingPrompt={stage.openingPrompt}
        candidateName={candidateName.split(" ")[0] ?? "You"}
        // DELIBERATELY NOT PASSING `allowBargeIn` OR `thinkingLine`.
        //
        // Both were briefly switched on here and that was wrong. This is the
        // once-per-lifetime graded cohort interview, and plan 106 is scoped to
        // the mock platform precisely because the two have different arguments:
        // a practice conversation should feel like a conversation, while an
        // assessment has a real claim that every candidate should hear the same
        // complete question. Turning barge-in on here would also have opened
        // the microphone during interviewer speech on the graded path, which is
        // the exact risk the half-duplex design was protecting against.
        //
        // The server side (`recordCohortInterruption`, the provider method, the
        // action and its schema) is kept and is deliberately dormant: it is
        // coherent, tested by the same invariant tests, and is what a later
        // decision to enable this would need. Reaching it requires passing the
        // two props below this line, which is a product decision, not a tidy-up.
        //
        //   allowBargeIn / onInterruptionAction / thinkingLine — NOT PASSED.
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
        <CheckCircle2 className="size-5 text-[#1A7F37]" strokeWidth={1.75} />
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
          href={`${PROGRAM_AI_COHORT_BASE}/cohort-interview/${blueprint}/report`}
          className="inline-flex h-11 items-center rounded-[12px] border border-[var(--iv-accent)]/50 bg-[var(--iv-accent)]/15 px-5 text-[14px] font-semibold text-[var(--iv-text)] transition-colors hover:bg-[var(--iv-accent)]/25"
        >
          View interview report
        </Link>
        <Link
          href={`${PROGRAM_AI_COHORT_BASE}/dashboard`}
          className="text-[14px] text-[var(--iv-text-muted)] underline underline-offset-4 transition-colors hover:text-[var(--iv-text)]"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
