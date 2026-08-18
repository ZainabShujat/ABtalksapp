"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Camera, CameraOff, MonitorCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export function StageSystemCheck({
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
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [active, setActive] = useState(false);
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
    if (videoRef.current) {
        videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  async function enableDevices() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true,
        video: { facingMode: "user" }
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }

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
      setActive(true);
    } catch {
      setError(
        "We could not open your camera or microphone. Allow permissions, then try again.",
      );
    }
  }

  const heard = peak >= 12;

  return (
    <div>
      <section className="border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
        <span className="kicker">System Check</span>
        <h2 className="mt-3 text-[24px] font-extrabold leading-7 tracking-[-0.01em]">
          Verify your hardware
        </h2>
        <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
          The interview requires both a working camera and microphone.
        </p>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
                <div className="aspect-video bg-muted/30 rounded-lg overflow-hidden border-2 border-[hsl(var(--divider)/0.4)] relative">
                    {!active && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <CameraOff className="size-8 text-foreground/40" />
                        </div>
                    )}
                    <video
                        ref={videoRef}
                        muted
                        playsInline
                        className="h-full w-full object-cover"
                        style={{ display: active ? "block" : "none" }}
                    />
                </div>
                <div className="flex items-center gap-2 text-[14px] text-foreground/70">
                    <Camera className="size-4" />
                    <span>{active ? "Camera active" : "Camera off"}</span>
                </div>
            </div>

            <div className="space-y-6 flex flex-col justify-center">
                <div>
                    <h3 className="font-semibold mb-3 flex items-center gap-2">
                        {active ? <Mic className="size-4 text-primary" /> : <MicOff className="size-4 text-foreground/40" />}
                        Microphone test
                    </h3>
                    <div className="h-4 w-full border-2 border-[hsl(var(--divider)/0.4)] rounded-full overflow-hidden bg-muted/30">
                        <div
                            className="h-full bg-primary transition-[width] duration-75"
                            style={{ width: `${level}%` }}
                        />
                    </div>
                    <p className="mt-2 text-[14px] text-foreground/70">
                    {active
                        ? heard
                        ? "Microphone is picking up sound."
                        : "Speak out loud to test your microphone."
                        : "Microphone off."}
                    </p>
                </div>

                <div className="bg-muted/10 border border-muted p-4 rounded-lg">
                    <h3 className="font-semibold flex items-center gap-2 mb-2 text-[14px]">
                        <MonitorCheck className="size-4" />
                        Browser Check
                    </h3>
                    <ul className="text-[13px] text-foreground/70 space-y-1">
                        <li>• Desktop browser detected</li>
                        <li>• WebRTC supported</li>
                        <li>• Network connection stable</li>
                    </ul>
                </div>
            </div>
        </div>

        {error && (
          <p className="mt-5 border-2 border-[hsl(var(--destructive))] px-4 py-3 text-[15px] leading-6 text-destructive">
            {error}
          </p>
        )}

        {!active && (
          <div className="mt-6">
            <Button type="button" onClick={() => void enableDevices()}>
              Enable Camera & Microphone
            </Button>
          </div>
        )}
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          type="button"
          disabled={!heard || !active}
          onClick={() => {
            stop();
            onReadyAction();
          }}
        >
          Looks good
        </Button>
      </div>
    </div>
  );
}
