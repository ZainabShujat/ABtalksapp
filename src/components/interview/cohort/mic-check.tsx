"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Mic, TriangleAlert } from "lucide-react";
import { MIN_AUDIO_BYTES } from "@/features/interview/voice-contract";

/**
 * The gate in front of the interview.
 *
 * It used to measure loudness only: a couple of loud frames and the check
 * passed. That tested a microphone, not the pipeline — a candidate could sail
 * through it and then discover mid-interview that nothing they said was being
 * transcribed, having already spent their one attempt.
 *
 * So the check now proves the WHOLE path: record five seconds, upload it
 * through the same `/api/interview/stt` endpoint the interview uses, and pass
 * only if real words come back. The interview cannot be started until it does.
 *
 * Amplitude is still shown live, because a candidate needs to see the meter
 * move to know the microphone is on at all — but it decides nothing.
 */

/** How long the candidate is recorded for. Long enough to say a sentence. */
const RECORD_MS = 5_000;

/**
 * Words the transcript must contain to count.
 *
 * One recognised word can be noise resolving to "you" or "the". Three is a
 * short spoken phrase, which is what the interview will actually receive.
 */
const MIN_WORDS = 3;

type State =
  | "idle"
  | "requesting"
  | "recording"
  | "checking"
  | "passed"
  | "failed"
  | "denied";

export function MicCheck({
  onResultAction,
}: {
  /**
   * True only when speech was recorded AND transcribed. The interview is
   * blocked until this has been true at least once.
   */
  onResultAction: (verified: boolean) => void;
}) {
  const [state, setState] = useState<State>("idle");
  const [level, setLevel] = useState(0);
  const [remaining, setRemaining] = useState(RECORD_MS / 1000);
  const [heard, setHeard] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setState("requesting");
    setProblem(null);
    setHeard(null);
    setLevel(0);
    setRemaining(RECORD_MS / 1000);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // The meter. Purely informational — it tells the candidate the microphone
      // is live while they speak, and has no say in whether the check passes.
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);

      const tick = () => {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const sample of buffer) sum += sample * sample;
        setLevel(Math.sqrt(sum / buffer.length));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        stream.getTracks().forEach((t) => t.stop());
        setState("checking");

        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });

        // Below this the recording is container headers and nothing else —
        // the same floor the interview uses, so the check fails here rather
        // than at the provider.
        if (blob.size < MIN_AUDIO_BYTES) {
          setState("failed");
          setProblem("That recording came through empty. Check your microphone is not muted, then try again.");
          onResultAction(false);
          return;
        }

        try {
          const form = new FormData();
          form.append("audio", blob, "check.webm");
          const res = await fetch("/api/interview/stt", { method: "POST", body: form });
          const raw = await res.text();

          let json:
            | { ok: true; data: { text: string; english?: boolean } }
            | { ok: false; message: string }
            | null = null;
          try {
            json = JSON.parse(raw);
          } catch {
            json = null;
          }

          if (!json) {
            setState("failed");
            setProblem(`Transcription failed (HTTP ${res.status}). Try again, or ask for help if it keeps failing.`);
            onResultAction(false);
            return;
          }

          if (!json.ok) {
            setState("failed");
            setProblem(json.message);
            onResultAction(false);
            return;
          }

          const text = json.data.text.trim();
          const words = text.split(/\s+/).filter(Boolean).length;

          if (words < MIN_WORDS) {
            setState("failed");
            setProblem("I could only make out a word or two. Try again, speaking a full sentence.");
            onResultAction(false);
            return;
          }

          // The interview is English-only, and a candidate who fails that here
          // learns it now rather than halfway through their one attempt.
          if (json.data.english === false) {
            setState("failed");
            setProblem("This interview is conducted in English. Try the check again, speaking English.");
            onResultAction(false);
            return;
          }

          setHeard(text);
          setState("passed");
          onResultAction(true);
        } catch (err) {
          setState("failed");
          setProblem(
            `Could not reach the transcription service (${
              err instanceof Error ? err.message : "network error"
            }).`,
          );
          onResultAction(false);
        }
      };

      recorder.start(1000);
      setState("recording");

      // Countdown, purely so the five seconds do not feel indefinite.
      for (let s = 1; s <= RECORD_MS / 1000; s++) {
        timersRef.current.push(
          setTimeout(() => setRemaining(RECORD_MS / 1000 - s), s * 1000),
        );
      }
      timersRef.current.push(
        setTimeout(() => {
          if (recorderRef.current?.state === "recording") {
            recorderRef.current.stop();
          }
        }, RECORD_MS),
      );
    } catch {
      setState("denied");
      setProblem("No microphone available. Check your browser permissions and try again.");
      onResultAction(false);
      stop();
    }
  }, [onResultAction, stop]);

  const bars = 14;
  const active = Math.round(Math.min(1, level / 0.25) * bars);
  const busy = state === "requesting" || state === "recording" || state === "checking";

  return (
    <div className="rounded-[14px] border border-[var(--iv-border)] bg-[var(--iv-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-[var(--iv-text)]">
            Microphone check
          </p>
          <p className="mt-0.5 text-[12px] text-[var(--iv-text-muted)]">
            {state === "idle" &&
              "Record five seconds so we can confirm we hear you. Required before you start."}
            {state === "requesting" && "Waiting for microphone permission…"}
            {state === "recording" &&
              `Recording — say a full sentence. ${remaining}s left.`}
            {state === "checking" && "Checking that we can transcribe it…"}
            {state === "passed" && "We can hear you clearly."}
            {(state === "failed" || state === "denied") &&
              "The check did not pass yet."}
          </p>
        </div>

        {state === "passed" ? (
          <span className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#1A7F37]/40 bg-[#1A7F37]/10 px-2.5 py-1 text-[12px] font-semibold text-[#1A7F37]">
            <Check className="size-3.5" /> Ready
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] border border-[var(--iv-border)] px-3.5 text-[13px] font-medium text-[var(--iv-text)] transition-colors hover:border-[var(--iv-accent)]/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state === "checking" ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Checking…
              </>
            ) : (
              <>
                <Mic className="size-4" strokeWidth={1.75} />
                {state === "recording"
                  ? `${remaining}s`
                  : state === "idle"
                    ? "Test microphone"
                    : "Try again"}
              </>
            )}
          </button>
        )}
      </div>

      {(state === "recording" || state === "checking") && (
        <div className="mt-3 flex items-end gap-1" aria-hidden>
          {Array.from({ length: bars }).map((_, i) => (
            <span
              key={i}
              className={`w-1.5 rounded-full transition-all duration-75 ${
                i < active ? "bg-[var(--iv-accent)]" : "bg-[var(--iv-border)]"
              }`}
              style={{ height: `${6 + i * 1.4}px` }}
            />
          ))}
        </div>
      )}

      {heard ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="text-[12px] text-[var(--iv-text-muted)]">
            Heard:{" "}
            <span className="text-[var(--iv-text)]">&ldquo;{heard}&rdquo;</span>
          </p>
          {/* Transcription can pass the check and still be wrong. The candidate
              is the only one who knows what they said, so they get to reject
              it: audio that comes back garbled here will come back garbled
              during the interview, and they should find that out now. */}
          <button
            type="button"
            onClick={() => {
              setHeard(null);
              setState("idle");
              setProblem(
                "No problem. Try again — speak a little slower, and closer to the microphone.",
              );
              onResultAction(false);
            }}
            className="text-[12px] text-[var(--iv-text-muted)] underline underline-offset-4 transition-colors hover:text-[var(--iv-text)]"
          >
            That&apos;s not what I said
          </button>
        </div>
      ) : null}

      {problem ? (
        <p
          className="mt-3 flex items-start gap-2 text-[12px] text-[#C9282B]"
          role="status"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {problem}
        </p>
      ) : null}
    </div>
  );
}
