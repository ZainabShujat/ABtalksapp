"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Stage 3 — camera and microphone check.
 *
 * Local only: the mic stream drives a level meter in the page and is never
 * recorded or transmitted. Phase 1 interviews are typed, so this stage confirms
 * the hardware works ahead of the voice interview that lands later.
 */
export function StageDeviceCheck({
  onBack,
  onReadyAction,
}: {
  onBack: () => void;
  onReadyAction: () => void;
}) {
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const [micOn, setMicOn] = useState(false);
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  async function enableMic() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        const pct = Math.min(100, Math.round((avg / 128) * 100));
        setLevel(pct);
        setPeak((p) => Math.max(p, pct));
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
      setMicOn(true);
    } catch {
      setError(
        "We could not open your microphone. Allow microphone access, then try again.",
      );
    }
  }

  const heard = peak >= 12;

  return (
    <div>
      <section className="border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
        <span className="kicker">Camera and mic</span>
        <h2 className="mt-3 text-[24px] font-extrabold leading-7 tracking-[-0.01em]">
          Check your setup before you start
        </h2>
        <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
          Say a sentence out loud and watch the meter move. Nothing is recorded
          here — the meter reads your microphone locally so you know it works.
        </p>

        <div className="mt-6 flex items-center gap-4">
          {micOn ? (
            <Mic className="size-5 text-primary" strokeWidth={2} aria-hidden />
          ) : (
            <MicOff
              className="size-5 text-foreground/40"
              strokeWidth={2}
              aria-hidden
            />
          )}
          <div className="h-3 w-full max-w-[520px] border-2 border-[hsl(var(--divider)/0.4)]">
            <div
              className="h-full bg-primary transition-[width] duration-75"
              style={{ width: `${level}%` }}
            />
          </div>
        </div>

        <p className="mt-3 text-[15px] leading-6 text-foreground/70">
          {micOn
            ? heard
              ? "Microphone is working."
              : "Waiting to hear you — say something."
            : "Microphone is off."}
        </p>

        {error && (
          <p className="mt-5 border-2 border-[hsl(var(--destructive))] px-4 py-3 text-[15px] leading-6 text-destructive">
            {error}
          </p>
        )}

        {!micOn && (
          <div className="mt-6">
            <Button type="button" onClick={() => void enableMic()}>
              Turn on microphone
            </Button>
          </div>
        )}

        <hr className="rule2 my-7" />

        <span className="kicker">What happens next</span>
        <ol className="mt-4 space-y-3 text-[15.5px] leading-7 text-foreground/78">
          <li>
            <strong className="font-extrabold text-foreground">01</strong> — You
            answer ten questions drawn from challenge days you finished.
          </li>
          <li>
            <strong className="font-extrabold text-foreground">02</strong> — The
            interviewer may follow up once on a topic when an answer leaves
            something open.
          </li>
          <li>
            <strong className="font-extrabold text-foreground">03</strong> —
            Leaving early discards the attempt. Your challenge days are not
            spent unless you finish.
          </li>
        </ol>
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          type="button"
          disabled={!heard}
          onClick={() => {
            stop();
            onReadyAction();
          }}
        >
          Start the interview
        </Button>
      </div>
    </div>
  );
}
