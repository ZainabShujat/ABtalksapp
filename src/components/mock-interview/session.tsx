"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Mic } from "lucide-react";
import {
  abandonMockInterviewAction,
  finishMockInterviewAction,
  startMockInterviewAction,
  submitMockAnswerAction,
} from "@/app/actions/mock-interview-actions";
import type {
  ClientQuestion,
  FinishAttemptData,
} from "@/features/interview/platform/service";
import {
  InterviewRoom,
  type RoomCopy,
} from "@/components/interview/cohort/interview-room";
import { MicCheck } from "@/components/interview/cohort/mic-check";
import {
  createEventCollector,
  type EventCollector,
} from "@/features/interview/proctoring/collector";
import {
  CameraManager,
  type CameraState,
} from "@/features/interview/proctoring/camera";
import { attachProctorListeners } from "@/features/interview/proctoring/listeners";
import { candidateMessageOf } from "@/features/interview/proctoring/types";
import { CameraPreview } from "@/components/mock-interview/camera-preview";
import {
  ProctorWarnings,
  type ProctorWarning,
} from "@/components/mock-interview/proctor-warning";
import {
  DevProctorPanel,
  isProctorDebugEnabled,
} from "@/components/mock-interview/dev-proctor-panel";
import "@/components/interview/cohort/interview.css";

/**
 * How long a pause ends the candidate's turn in a conversational interview.
 *
 * The cohort uses 10s. That is right for an assessment where being cut off
 * mid-thought costs someone a milestone, and wrong for a practice conversation
 * where the cost of waiting is that it stops feeling like one.
 */
const CONVERSATIONAL_SILENCE_MS = 4_500;

/**
 * A `useSyncExternalStore` subscription to something that never changes.
 *
 * Module scope so its identity is stable; an inline arrow would resubscribe on
 * every render.
 */
const subscribeToNothing = () => () => {};

/**
 * The candidate's path through one mock interview: brief → room → done.
 *
 * Mirrors `components/interview/cohort/interview-session.tsx` in shape, and
 * reuses `InterviewRoom` and `MicCheck` outright. The room is shared rather
 * than forked — the only difference between the two interviews at this layer is
 * WHICH server actions run and WHICH speech endpoint is called, which is exactly
 * what the injection seam exists to express.
 *
 * This component owns no interview logic. It starts an attempt through the real
 * Server Action and hands the id to the room.
 */

type Stage =
  | { name: "brief" }
  | {
      name: "live";
      attemptId: string;
      question: ClientQuestion;
      /** Full opening line + first question, as the server composed it. */
      openingPrompt: string;
      durationSec: number;
    }
  | { name: "done"; result: FinishAttemptData };

export function MockInterviewSession({
  domainSlug,
  domainLabel,
  minAnsweredToScore,
}: {
  domainSlug: string;
  /** Shown as the room's title once the interview is live. */
  domainLabel: string;
  /**
   * Answers needed before finishing produces a report. Passed down from the
   * server's exported constant rather than written as a literal anywhere in the
   * UI, so the number cannot drift from the rule the service enforces. Used by
   * the room's exit dialog; the page states it in prose.
   */
  minAnsweredToScore: number;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ name: "brief" });
  const [starting, setStarting] = useState(false);
  const [micVerified, setMicVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ------------------------------------------------------------ proctoring */

  /**
   * PROCTORING IS LAYERED AROUND THE ROOM, NEVER INSIDE IT.
   *
   * `InterviewRoom` is shared with the cohort interview, which has no camera and
   * no proctoring, so none of this may reach it. Everything below hangs off the
   * three things this component already owns: the actions it injects, the
   * lifecycle of the `live` stage, and its own overlays. The room is passed the
   * same props it was passed before — the wrapped `submitAnswerAction` has the
   * identical signature, and the extra field is added inside it.
   *
   * The events are ADVISORY. They are recorded and shown; they do not gate
   * starting, answering or finishing, and no score is derived from them.
   */
  const [warnings, setWarnings] = useState<ProctorWarning[]>([]);
  const [cameraState, setCameraState] = useState<CameraState>({
    status: "idle",
    stream: null,
    message: null,
  });

  // Built once, via a lazy `useState` initialiser rather than a ref. Both are
  // mutable machinery rather than rendered data, but a ref may not be read
  // during render, and the room needs the collector in a `useCallback` that
  // renders. Lazy state gives one instance for the life of the component and is
  // legal to read here — re-creating either on a render would drop events the
  // candidate had already generated, or orphan a live camera track.
  const [collector] = useState<EventCollector>(() =>
    createEventCollector({
      onEvent: (event) => {
        // Only NEW events arrive here — the collector swallows the coalesced
        // ones — so one alt-tab is one toast, not four.
        const message = candidateMessageOf(event.kind);
        if (!message || event.severity === "info") return;
        const raisedAt = Date.now();
        setWarnings((prev) => [
          ...prev.slice(-4),
          {
            id: raisedAt + prev.length,
            raisedAt,
            message,
            severity: event.severity,
          },
        ]);
      },
    }),
  );

  const [camera] = useState<CameraManager>(
    () => new CameraManager(collector, setCameraState),
  );

  /**
   * Whether the development simulator is showing.
   *
   * `useSyncExternalStore` rather than an effect, because the answer depends on
   * `window.location`, which does not exist while the page is rendered on the
   * server. The server snapshot is `false` and the client snapshot is the real
   * gate, so the two agree at hydration instead of mismatching. Nothing
   * subscribes: the query string cannot change without a navigation.
   */
  const debugPanel = useSyncExternalStore(
    subscribeToNothing,
    isProctorDebugEnabled,
    () => false,
  );

  // Browser signals are watched only while an interview is actually live.
  // Attaching them on the brief screen would record tab switches made while
  // someone was reading the page, which is not an interview event.
  useEffect(() => {
    if (stage.name !== "live") return;
    return attachProctorListeners(collector);
  }, [stage.name, collector]);

  // Release the device and the buffer whatever ends this component — finishing,
  // abandoning, or navigating away mid-answer.
  useEffect(() => {
    return () => {
      camera.dispose();
      collector.destroy();
    };
  }, [camera, collector]);

  // Memoised because `InterviewRoom` lists them in `useCallback` dependencies.
  // Inline arrows would take a new identity on every render and needlessly
  // rebuild the room's speak/send callbacks mid-interview.
  const submitAnswerAction = useCallback(
    (input: { interviewId: string; questionId: string; answerText: string }) =>
      submitMockAnswerAction({
        attemptId: input.interviewId,
        questionId: input.questionId,
        answerText: input.answerText,
        // THE INJECTION SEAM, used exactly as intended. The room hands over the
        // three fields it has always handed over; the proctoring buffer is
        // attached here, on its way out. There is no separate upload and no
        // polling — events ride the turn they belong to, into the
        // `MockInterviewTurn.clientEvents` column that already existed for them.
        //
        // `drain` empties the buffer, so a retried turn cannot double-count and
        // a long answer cannot resend what the previous answer already carried.
        clientEvents: collector.drain(),
      }),
    [collector],
  );
  const finishAction = useCallback(
    (input: { interviewId: string }) =>
      finishMockInterviewAction({ attemptId: input.interviewId }),
    [],
  );
  /**
   * Wording for THIS interview.
   *
   * Derived from the domain rather than written per interview, so every future
   * domain adapts by existing rather than by someone remembering to add copy.
   * The cohort's defaults are false here in three specific ways and each is
   * corrected: a practice candidate submitted no work to read through, holds no
   * milestone, and does not return to the programme dashboard.
   */
  const roomCopy = useMemo<RoomCopy>(
    () => ({
      preparing: `Hang tight — I'm putting your ${domainLabel} questions together.`,
      endPastHalfway:
        "You're more than halfway through, so ending now will score what you've answered and generate your report. Questions you haven't reached count as unanswered, and this attempt will be marked complete.",
      endBeforeHalfway:
        "Nothing is counted against you, so you can start this interview again whenever you like.",
      notScored:
        "This attempt was not scored, so it has not been counted. You can start it again whenever you like.",
      // What a person does between hearing an answer and replying. "Evaluating
      // your answer" narrates the machinery at the candidate mid-conversation.
      processingLabel: "Thinking",
    }),
    [domainLabel],
  );

  const abandonAction = useCallback(
    (input: { interviewId: string }) =>
      abandonMockInterviewAction({ attemptId: input.interviewId }),
    [],
  );

  async function begin() {
    setStarting(true);
    setError(null);

    // Camera request fired, DELIBERATELY NOT AWAITED.
    //
    // `getUserMedia` does not resolve until the person answers the permission
    // prompt — and a prompt that is ignored never resolves at all. Awaiting it
    // would mean a candidate who does not notice the dialog can never start an
    // interview that does not need a camera to run. So the request races the
    // attempt: whichever way it lands, it lands as a proctoring event and a
    // preview tile, and the interview opens either way. `MicCheck` remains the
    // only real device gate, exactly as before.
    void camera.start();

    // The slug is sent, but the server re-resolves it against the domain
    // registry before opening anything — this value cannot start an interview
    // that is not published.
    const started = await startMockInterviewAction({ domainSlug });
    setStarting(false);

    if (!started.ok) {
      setError(started.message);
      return;
    }

    setStage({
      name: "live",
      attemptId: started.data.attemptId,
      question: started.data.question,
      openingPrompt: started.data.prompt,
      durationSec: started.data.durationSec,
    });
  }

  /* --------------------------------------------------------------- brief */

  if (stage.name === "brief") {
    // DELIBERATELY MINIMAL. This renders inside the domain detail page, which
    // already states the title, the duration, the question count, the format and
    // the scoring floor. Repeating any of that here read as the page stuttering:
    // the same three facts twice, a few hundred pixels apart. What is left is
    // the only thing the page cannot provide — the microphone check and the
    // button that opens an attempt.
    return (
      <div className="interview-room">
        <MicCheck onResultAction={setMicVerified} />

        {error ? (
          <p className="mt-5 text-[13px] text-[#C9282B]" role="status">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void begin()}
            disabled={starting || !micVerified}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[12px] bg-[#E05226] px-6 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#C9411C] disabled:cursor-not-allowed disabled:bg-[#E0E0E0] disabled:text-[#8F8F8F]"
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

          {!micVerified ? (
            <span className="text-[13px] text-[#8F8F8F]">
              Run the microphone check to begin.
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- live */

  if (stage.name === "live") {
    return (
      <>
        {/* Overlays, not room children. `InterviewRoom` has no slot for these
            and is not being given one — it is shared with the cohort, which has
            no camera and no proctoring. Both are fixed to the viewport and
            neither takes pointer events, so the room's own layout and controls
            are untouched. */}
        <CameraPreview state={cameraState} />
        <ProctorWarnings warnings={warnings} />
        {debugPanel ? (
          <DevProctorPanel collector={collector} cameraStatus={cameraState.status} />
        ) : null}

        <InterviewRoom<FinishAttemptData>
          interviewId={stage.attemptId}
          title={domainLabel}
          firstQuestion={stage.question}
          openingPrompt={stage.openingPrompt}
          durationSec={stage.durationSec}
          minAnsweredToScore={minAnsweredToScore}
          // 4.5s, not the cohort's 10s. A conversational interview cannot afford
          // ten seconds of dead air after every answer — that pause alone is what
          // makes an exchange feel like a form being processed rather than a
          // person listening. The cohort keeps its own value, which was raised
          // deliberately and is not ours to revert.
          silenceMs={CONVERSATIONAL_SILENCE_MS}
          roomCopy={roomCopy}
          // The platform's actions and speech endpoint. The room itself is
          // unchanged and does not know which interview it is conducting.
          submitAnswerAction={submitAnswerAction}
          finishAction={finishAction}
          abandonAction={abandonAction}
          ttsEndpoint="/api/mock-interview/tts"
          onFinishedAction={(result) => {
            // The interview is over; the camera has no further reason to be on.
            camera.stop();
            setStage({ name: "done", result });
          }}
          onAbandonedAction={() => {
            camera.stop();
            setStage({ name: "brief" });
            router.refresh();
          }}
        />
      </>
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
        No score here on purpose, matching the cohort: the first thing someone
        sees after being assessed should be that it landed safely, not a number
        with no context. The report explains itself and is one click away.
      */}
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--iv-text-muted)]">
        Your answers have been assessed. The report covers how you scored on each
        part of the rubric, with the evidence behind every observation.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {stage.result.reportReady ? (
          <Link
            href={`/mock-interviews/${stage.result.domainSlug}/attempt/${stage.result.attemptId}/report`}
            className="inline-flex h-11 items-center rounded-[12px] border border-[var(--iv-accent)]/50 bg-[var(--iv-accent)]/15 px-5 text-[14px] font-semibold text-[var(--iv-text)] transition-colors hover:bg-[var(--iv-accent)]/25"
          >
            View your report
          </Link>
        ) : null}
        <Link
          href="/mock-interviews/history"
          className="text-[14px] text-[var(--iv-text-muted)] underline underline-offset-4 transition-colors hover:text-[var(--iv-text)]"
        >
          All attempts
        </Link>
      </div>
    </div>
  );
}
