"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A real microphone test, before the interview starts.
 *
 * It measures the actual input level through a Web Audio analyser rather than
 * asking the candidate to trust that the browser permission prompt was enough.
 * Permission granted and audio arriving are different things: a muted device, a
 * hardware switch, or the wrong default input all pass the permission check and
 * then record silence.
 *
 * That distinction matters here more than in most apps. A candidate who
 * discovers a dead microphone three questions into a one-attempt assessment has
 * lost the attempt, not just a minute.
 *
 * No audio leaves the browser. Nothing is uploaded, transcribed or stored — the
 * analyser reads the level locally and the stream is torn down when the check
 * ends.
 */

type State = "idle" | "requesting" | "listening" | "passed" | "denied";

/** Above this the meter counts as real speech rather than room noise. */
const SPEECH_THRESHOLD = 0.06;
/** Consecutive frames above the threshold before the check passes. */
const FRAMES_TO_PASS = 8;

export function MicCheck({
  onResultAction,
}: {
  /** Reports whether the microphone produced audio. Never blocks the interview. */
  onResultAction: (working: boolean) => void;
}) {
  const [state, setState] = useState<State>("idle");
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const loudFramesRef = useRef(0);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setState("requesting");
    loudFramesRef.current = 0;
    setPeak(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const buffer = new Float32Array(analyser.fftSize);
      setState("listening");

      const tick = () => {
        analyser.getFloatTimeDomainData(buffer);

        // RMS: loudness as heard, rather than whichever sample happened to be
        // largest. A single click should not pass a microphone test.
        let sum = 0;
        for (const sample of buffer) sum += sample * sample;
        const rms = Math.sqrt(sum / buffer.length);

        setLevel(rms);
        setPeak((p) => Math.max(p, rms));

        if (rms >= SPEECH_THRESHOLD) loudFramesRef.current += 1;
        else loudFramesRef.current = Math.max(0, loudFramesRef.current - 1);

        if (loudFramesRef.current >= FRAMES_TO_PASS) {
          setState("passed");
          onResultAction(true);
          stop();
          return;
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setState("denied");
      onResultAction(false);
      stop();
    }
  }, [onResultAction, stop]);

  const bars = 14;
  const active = Math.round(Math.min(1, level / 0.25) * bars);

  return (
    <div className="rounded-[14px] border border-[var(--iv-border)] bg-[var(--iv-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[14px] font-medium text-[var(--iv-text)]">
            Microphone check
          </p>
          <p className="mt-0.5 text-[12px] text-[var(--iv-text-muted)]">
            {state === "idle" && "Confirm we can hear you before the interview starts."}
            {state === "requesting" && "Waiting for microphone permission…"}
            {state === "listening" && "Say a few words — anything at all."}
            {state === "passed" && "We can hear you clearly."}
            {state === "denied" &&
              "No microphone available. You can still answer by typing."}
          </p>
        </div>

        {state === "passed" ? (
          <span className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#1A7F37]/40 bg-[#1A7F37]/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#1A7F37]">
            Working
          </span>
        ) : state === "denied" ? (
          <span className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#9A6700]/40 bg-[#9A6700]/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#9A6700]">
            Unavailable
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={state === "requesting" || state === "listening"}
            className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[var(--iv-border)] bg-[var(--iv-surface-raised)] px-3.5 text-[13px] text-[var(--iv-text)] transition-colors hover:border-[var(--iv-accent)]/60 disabled:opacity-60"
          >
            <Mic className="size-4" strokeWidth={1.75} />
            {state === "listening" ? "Listening…" : "Test microphone"}
          </button>
        )}
      </div>

      {state === "listening" || state === "passed" ? (
        <div className="mt-3 flex items-end gap-[3px]" aria-hidden="true">
          {Array.from({ length: bars }, (_, i) => (
            <span
              key={i}
              className={cn(
                "block w-[4px] rounded-full transition-[height,background-color] duration-75",
                i < active ? "bg-[#1A7F37]" : "bg-white/10",
              )}
              style={{ height: i < active ? 6 + i * 1.6 : 6 }}
            />
          ))}
          <span className="ml-3 font-mono text-[11px] tabular-nums text-[var(--iv-text-faint)]">
            peak {(peak * 100).toFixed(0)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
