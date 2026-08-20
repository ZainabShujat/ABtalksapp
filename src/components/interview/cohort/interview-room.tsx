"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  abandonInterviewAction,
  finishInterviewAction,
  submitInterviewAnswerAction,
} from "@/app/actions/interview-actions";
import type {
  ClientQuestion,
  FinishInterviewData,
} from "@/features/interview/service";

/**
 * The interview room.
 *
 * A presentation layer over the existing interview system — nothing here
 * simulates an interviewer. Every candidate answer goes through
 * `submitInterviewAnswerAction`, which reaches the LangGraph agent, the depth
 * ladder and the evidence store exactly as a typed answer does. What the room
 * adds is the sense of being *in* an interview: whose turn it is, what was
 * said, and one obvious way to answer.
 *
 * Two rules shape the layout:
 *
 *   1. The transcript is the page. Controls sit in their own bar beneath it and
 *      never overlap it, because a candidate mid-thought must be able to
 *      re-read the question.
 *   2. Assessment vocabulary never reaches the screen. The system knows about
 *      ESCALATE, REDIRECT, evidence counts and scores; the candidate sees a
 *      person asking a harder question, or steering them back. Showing the
 *      machinery would turn an interview into a test being marked in public.
 */

type Turn = {
  role: "interviewer" | "candidate";
  text: string;
};

type Phase = "idle" | "listening" | "processing" | "speaking";

const PHASE_COPY: Record<Phase, { label: string; hint: string }> = {
  idle: { label: "Your turn", hint: "Tap the microphone and answer out loud." },
  listening: { label: "Listening", hint: "Tap again when you have finished." },
  processing: { label: "Evaluating your answer", hint: "One moment." },
  speaking: { label: "Interviewer speaking", hint: "" },
};

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function InterviewRoom({
  interviewId,
  title,
  firstQuestion,
  candidateName,
  onFinishedAction,
  onAbandonedAction,
}: {
  interviewId: string;
  title: string;
  firstQuestion: ClientQuestion;
  candidateName: string;
  onFinishedAction: (data: FinishInterviewData) => void;
  onAbandonedAction: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([
    { role: "interviewer", text: firstQuestion.text },
  ]);
  const [question, setQuestion] = useState<ClientQuestion | null>(firstQuestion);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [micUnavailable, setMicUnavailable] = useState(false);
  const [typed, setTyped] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [closing, setClosing] = useState(false);
  const [usingBrowserVoice, setUsingBrowserVoice] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  /**
   * Progress through the CORE spine, straight from the server.
   *
   * Counted in core questions rather than turns, because follow-ups and deep
   * probes add turns without advancing the assessment — a turn-based bar would
   * tell someone on question three that they were nearly done.
   */
  const [progress, setProgress] = useState({ answered: 0, total: 0, ratio: 0 });

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const spokenRef = useRef<string | null>(null);

  /* ------------------------------------------------------------- timing */

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, phase]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioRef.current?.pause();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

  /* -------------------------------------------------------------- voice */

  /**
   * Speaks the interviewer's most recent line.
   *
   * Server synthesis first; the browser's own voice when no speech service is
   * configured. The words are identical either way — they come from the
   * server's transcript — so the fallback is a real spoken question rather than
   * a stand-in. Silence would change the assessment: an interview you read is
   * not the interview this is meant to be.
   */
  const speak = useCallback(
    async (text: string) => {
      if (spokenRef.current === text) return;
      spokenRef.current = text;
      setPhase("speaking");

      const viaBrowser = () =>
        new Promise<void>((resolve) => {
          if (typeof window === "undefined" || !window.speechSynthesis) {
            resolve();
            return;
          }
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 0.98;
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          window.speechSynthesis.speak(utterance);
        });

      try {
        const res = await fetch("/api/interview/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interviewId }),
        });

        if (res.ok) {
          const url = URL.createObjectURL(await res.blob());
          const audio = new Audio(url);
          audioRef.current = audio;
          await audio.play();
          await new Promise<void>((resolve) => {
            audio.onended = () => resolve();
            audio.onerror = () => resolve();
          });
          URL.revokeObjectURL(url);
        } else {
          setUsingBrowserVoice(true);
          await viaBrowser();
        }
      } catch {
        setUsingBrowserVoice(true);
        await viaBrowser();
      } finally {
        setPhase("idle");
      }
    },
    [interviewId],
  );

  // Speak the opening question once the room mounts.
  //
  // Deferred by a tick rather than called in the effect body: `speak` sets
  // state immediately, and doing that synchronously inside an effect triggers a
  // cascading render. The delay is imperceptible and the audio still starts
  // within the user gesture that opened the room, which is what browsers
  // require before they will play anything.
  useEffect(() => {
    const id = setTimeout(() => void speak(firstQuestion.text), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------- answering */

  const send = useCallback(
    async (answerText: string) => {
      const text = answerText.trim();
      if (!question || text.length === 0) return;

      setTurns((prev) => [...prev, { role: "candidate", text }]);
      setPhase("processing");
      setError(null);

      const turn = await submitInterviewAnswerAction({
        interviewId,
        questionId: question.id,
        answerText: text,
      });

      if (!turn.ok) {
        setError(turn.message);
        setPhase("idle");
        return;
      }

      // `prompt` is whatever the interviewer says next — a follow-up, a deeper
      // question, a redirect, or the next question with its acknowledgement.
      // The room does not care which; it is all just the interviewer talking.
      if (turn.data.prompt) {
        setTurns((prev) => [
          ...prev,
          { role: "interviewer", text: turn.data.prompt! },
        ]);
      }
      setQuestion(turn.data.question);
      setProgress(turn.data.progress);

      if (turn.data.finished) {
        setClosing(true);
        const finished = await finishInterviewAction({ interviewId });
        setClosing(false);
        if (finished.ok) onFinishedAction(finished.data);
        else setError(finished.message);
        return;
      }

      if (turn.data.prompt) void speak(turn.data.prompt);
      else setPhase("idle");
    },
    [interviewId, question, onFinishedAction, speak],
  );

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });

        setPhase("processing");
        const form = new FormData();
        form.append("audio", blob, "answer.webm");

        try {
          const res = await fetch("/api/interview/stt", {
            method: "POST",
            body: form,
          });
          const json = (await res.json()) as
            | { ok: true; data: { text: string } }
            | { ok: false; message: string };

          if (!json.ok) {
            // The recording is lost but the turn is not spent — the candidate
            // simply answers again, by voice or by typing.
            setError(json.message);
            setPhase("idle");
            return;
          }
          await send(json.data.text);
        } catch {
          setError(
            "Could not reach the transcription service. You can type your answer instead.",
          );
          setPhase("idle");
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setPhase("listening");
    } catch {
      setMicUnavailable(true);
      setError("Microphone unavailable. You can type your answers instead.");
      setPhase("idle");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  async function endInterview() {
    stopRecording();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    await abandonInterviewAction({ interviewId });
    onAbandonedAction();
  }

  // Past the halfway mark the warning changes, because the consequence changes:
  // the attempt is spent either way, but a candidate who has answered most of
  // the spine is giving up something substantial and deserves to be told so
  // plainly rather than nudged through a generic confirm.
  const pastHalfway = progress.total > 0 && progress.ratio >= 0.5;

  const busy = phase === "processing" || phase === "speaking" || closing;
  const copy = PHASE_COPY[phase];

  /* --------------------------------------------------------------- view */

  return (
    <div className="interview-room flex min-h-[calc(100svh-9rem)] flex-col">
      {confirmExit ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="iv-exit-title"
        >
          <div className="w-full max-w-md rounded-[16px] border border-[var(--iv-border)] bg-[#050C21] p-6">
            <h2
              id="iv-exit-title"
              className="font-display text-lg font-bold text-[var(--iv-text)]"
            >
              End interview?
            </h2>

            {pastHalfway ? (
              <p className="mt-3 text-[14px] leading-relaxed text-[var(--iv-text-muted)]">
                You&apos;re more than halfway through this assessment. If you end
                the session now, your current progress will not be resumable and
                you&apos;ll lose this attempt.
              </p>
            ) : (
              <p className="mt-3 text-[14px] leading-relaxed text-[var(--iv-text-muted)]">
                Your progress will not be saved and this attempt will not be
                assessed. You can start a fresh interview from the dashboard.
              </p>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setConfirmExit(false)}
                className="inline-flex h-10 items-center rounded-[10px] border border-[var(--iv-accent)]/50 bg-[var(--iv-accent)]/15 px-4 text-[14px] font-semibold text-[var(--iv-text)] transition-colors hover:bg-[var(--iv-accent)]/25"
              >
                Continue interview
              </button>
              <button
                type="button"
                onClick={() => void endInterview()}
                className="inline-flex h-10 items-center rounded-[10px] border border-[#F98080]/40 px-4 text-[14px] text-[#F98080] transition-colors hover:bg-[#F98080]/10"
              >
                {pastHalfway ? "End & lose attempt" : "End interview"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------- header */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--iv-border)] pb-4">
        <div className="min-w-0">
          <h1 className="font-display text-lg font-bold tracking-tight text-[var(--iv-text)] md:text-xl">
            {title}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--iv-text-muted)]">
            Technical interview • AI Cohort
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#6AE276]/40 bg-[#6AE276]/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#6AE276]">
            <span className="iv-dot size-1.5 rounded-full bg-[#6AE276]" />
            Live
          </span>
          <span
            className="font-mono text-[13px] tabular-nums text-[var(--iv-text-faint)]"
            aria-label="Elapsed time"
          >
            {formatClock(elapsed)}
          </span>
          <button
            type="button"
            onClick={() => setConfirmExit(true)}
            className="rounded-[8px] border border-[var(--iv-border)] px-3 py-1.5 text-[13px] text-[var(--iv-text-muted)] transition-colors hover:border-white/30 hover:text-[var(--iv-text)]"
          >
            End interview
          </button>
        </div>
      </header>

      {/* --------------------------------------------------- transcript */}
      <div className="flex-1 overflow-y-auto py-8">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
          {turns.map((turn, i) => {
            const isLatest = i >= turns.length - 2;
            return (
              <div key={i} className={cn("iv-enter", !isLatest && "iv-turn-past")}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--iv-text-faint)]">
                  {turn.role === "interviewer" ? "AI Interviewer" : candidateName}
                </p>

                {turn.role === "interviewer" ? (
                  <p className="whitespace-pre-line text-[17px] leading-[1.65] text-[var(--iv-text)] md:text-[19px]">
                    {turn.text}
                  </p>
                ) : (
                  <div className="rounded-[12px] border border-[var(--iv-border-soft)] bg-[var(--iv-surface-raised)] px-4 py-3">
                    <p className="whitespace-pre-line text-[15px] leading-relaxed text-[var(--iv-text-muted)]">
                      {turn.text}
                    </p>
                  </div>
                )}
              </div>
            );
          })}

          {phase === "processing" || closing ? (
            <p className="text-[13px] text-[var(--iv-text-faint)]">
              {closing ? "Completing your interview…" : "Evaluating your answer…"}
            </p>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ----------------------------------------------------- controls */}
      <div className="sticky bottom-0 border-t border-[var(--iv-border)] bg-[#040A12]/95 pt-5 pb-6 backdrop-blur">
        <div className="mx-auto w-full max-w-2xl">
          {error ? (
            <p className="mb-4 text-[13px] text-[#F98080]" role="status">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col items-center gap-3">
            <div className="text-center">
              <p className="text-[13px] font-semibold text-[var(--iv-text)]">
                {copy.label}
                {phase === "speaking" ? (
                  <span className="ml-2 inline-flex items-end gap-[2px] align-middle">
                    {[0, 1, 2, 3].map((i) => (
                      <span
                        key={i}
                        className="iv-bar block w-[2px] origin-bottom rounded-full bg-[var(--iv-accent)]"
                        style={{ height: 12, animationDelay: `${i * 110}ms` }}
                      />
                    ))}
                  </span>
                ) : null}
              </p>
              {copy.hint ? (
                <p className="mt-0.5 text-[12px] text-[var(--iv-text-faint)]">
                  {copy.hint}
                </p>
              ) : null}
            </div>

            {!micUnavailable ? (
              <div className="relative">
                {phase === "listening" ? (
                  <span className="iv-listening-ring pointer-events-none absolute inset-0 rounded-full border border-[#6AE276]/50" />
                ) : null}
                <button
                  type="button"
                  disabled={busy || !question}
                  onClick={phase === "listening" ? stopRecording : startRecording}
                  aria-label={
                    phase === "listening" ? "Stop recording" : "Record answer"
                  }
                  className={cn(
                    "relative flex size-14 items-center justify-center rounded-full border transition-all duration-200",
                    phase === "listening"
                      ? "border-[#6AE276]/60 bg-[#6AE276]/15 text-[#6AE276]"
                      : "border-[var(--iv-border)] bg-[var(--iv-surface-raised)] text-[var(--iv-text)] hover:border-[var(--iv-accent)]/60",
                    (busy || !question) && "cursor-not-allowed opacity-40",
                  )}
                >
                  {phase === "listening" ? (
                    <Square className="size-5 fill-current" />
                  ) : (
                    <Mic className="size-5" strokeWidth={1.75} />
                  )}
                </button>
              </div>
            ) : null}

            {usingBrowserVoice ? (
              <p className="text-[11px] text-[var(--iv-text-faint)]">
                Using your browser&apos;s voice — no speech service is configured.
              </p>
            ) : null}
          </div>

          {/* Typing is a fallback, and always present: a shared room, a bad
              connection or a denied microphone must not cost someone their one
              attempt at a milestone. */}
          <div className="mt-5">
            <label
              htmlFor="iv-typed"
              className="text-[12px] text-[var(--iv-text-faint)]"
            >
              Prefer typing?
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="iv-typed"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy && typed.trim()) {
                    const t = typed;
                    setTyped("");
                    void send(t);
                  }
                }}
                disabled={busy || !question}
                placeholder="Type your answer…"
                className="min-w-0 flex-1 rounded-[10px] border border-[var(--iv-border)] bg-[var(--iv-surface)] px-3.5 py-2.5 text-[14px] text-[var(--iv-text)] outline-none transition-colors placeholder:text-[var(--iv-text-faint)] focus:border-[var(--iv-accent)]/70 disabled:opacity-40"
              />
              <button
                type="button"
                disabled={busy || !question || typed.trim().length === 0}
                onClick={() => {
                  const t = typed;
                  setTyped("");
                  void send(t);
                }}
                className="shrink-0 rounded-[10px] border border-[var(--iv-border)] bg-[var(--iv-surface-raised)] px-4 text-[14px] font-medium text-[var(--iv-text)] transition-colors hover:border-[var(--iv-accent)]/60 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
