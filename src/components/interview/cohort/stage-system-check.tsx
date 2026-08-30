"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MonitorCheck, Wifi, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type CheckStatus = "pending" | "checking" | "pass" | "fail";

/**
 * SCREEN 3 — Device Check.
 *
 * Professional pre-interview readiness check. Microphone visualizer actually
 * reacts to sound. Browser and network checks are informational. No proctoring.
 */
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

  const [micStatus, setMicStatus] = useState<CheckStatus>("pending");
  const [browserStatus, setBrowserStatus] = useState<CheckStatus>("pending");
  const [networkStatus, setNetworkStatus] = useState<CheckStatus>("pending");
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

  // Check browser and network on mount
  useEffect(() => {
    // Browser check
    const hasMediaDevices = !!(navigator.mediaDevices?.getUserMedia);
    const hasWebRTC = !!(window.RTCPeerConnection);
    const hasSpeech = !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    setBrowserStatus(hasMediaDevices && hasWebRTC && hasSpeech ? "pass" : "fail");

    // Network check
    setNetworkStatus(navigator.onLine ? "pass" : "fail");
    const handleOnline = () => setNetworkStatus("pass");
    const handleOffline = () => setNetworkStatus("fail");
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  async function enableDevices() {
    setError(null);
    setMicStatus("checking");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      streamRef.current = stream;

      // Audio analysis
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
      setMicStatus("pass");
    } catch {
      setError(
        "We could not access your microphone. Please allow permissions and try again.",
      );
      setMicStatus("fail");
    }
  }

  const heard = peak >= 12;
  const allGood =
    micStatus === "pass" &&
    browserStatus === "pass" &&
    networkStatus === "pass" &&
    heard;

  function StatusIcon({ status }: { status: CheckStatus }) {
    if (status === "pass")
      return (
        <span className="flex size-6 items-center justify-center bg-emerald-500/15 text-emerald-600">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      );
    if (status === "fail")
      return (
        <span className="flex size-6 items-center justify-center bg-red-500/15 text-red-500">
          <X className="size-3.5" strokeWidth={3} />
        </span>
      );
    if (status === "checking")
      return (
        <span className="flex size-6 items-center justify-center">
          <span className="size-3 rounded-full border-2 border-foreground/20 border-t-primary animate-spin" />
        </span>
      );
    return (
      <span className="flex size-6 items-center justify-center bg-foreground/5 text-foreground/30">
        <span className="size-2 rounded-full bg-current" />
      </span>
    );
  }

  const checks = [
    { label: "Microphone", sublabel: micStatus === "pass" ? "Connected" : micStatus === "fail" ? "Denied" : "Pending", status: micStatus, icon: Mic },
    { label: "Browser", sublabel: browserStatus === "pass" ? "Supported" : "Unsupported", status: browserStatus, icon: MonitorCheck },
    { label: "Network", sublabel: networkStatus === "pass" ? "Connected" : "Offline", status: networkStatus, icon: Wifi },
  ];

  return (
    <div style={{ animation: "iv-fade-in 0.4s ease-out" }}>
      <section className="rounded-xl border bg-card p-6 md:p-8 shadow-sm">
        <div className="inline-block rounded bg-primary/10 px-2 py-1 text-xs font-bold uppercase tracking-wider text-primary mb-4">
          System check
        </div>
        <h2 className="text-2xl font-extrabold tracking-tight">
          Verify your setup
        </h2>
        <p className="mt-2 max-w-[64ch] text-[15.5px] leading-7 text-muted-foreground">
          The interview uses voice. Check that your microphone and connection are working before you begin.
        </p>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left: mic visualizer */}
          <div className="flex flex-col justify-center rounded-lg border bg-muted/40 p-6">
            <div className="flex items-center gap-3">
              <Mic
                className={`size-6 ${micStatus === "pass" ? "text-primary" : "text-muted-foreground/60"}`}
                strokeWidth={2}
              />
              <div className="h-4 w-full rounded-full bg-background overflow-hidden border">
                <div
                  className="h-full bg-primary transition-[width] duration-75"
                  style={{ width: `${level}%` }}
                />
              </div>
            </div>
            <p className="mt-4 text-sm text-center font-medium text-muted-foreground">
              {micStatus === "pass"
                ? heard
                  ? "Microphone is picking up sound."
                  : "Speak out loud to test your microphone."
                : "Enable your device to test the microphone."}
            </p>
          </div>

          {/* Right: Checklist */}
          <div className="space-y-0">
            {checks.map((check) => (
              <div
                key={check.label}
                className="flex items-center gap-4 border-b py-4 last:border-b-0"
              >
                <StatusIcon status={check.status} />
                <div className="flex-1 min-w-0">
                  <span className="block text-[15px] font-bold leading-5">
                    {check.label}
                  </span>
                  <span className="block text-[13px] text-muted-foreground mt-0.5">
                    {check.sublabel}
                  </span>
                </div>
                <check.icon className="size-4 text-muted-foreground/50 shrink-0" strokeWidth={1.5} />
              </div>
            ))}

            {micStatus === "pending" && (
              <div className="mt-5">
                <Button type="button" onClick={() => void enableDevices()} className="w-full font-bold">
                  Enable Microphone
                </Button>
              </div>
            )}
          </div>
        </div>

        {error && (
          <p className="mt-5 rounded-md bg-destructive/10 px-4 py-3 text-[15px] leading-6 text-destructive font-medium border border-destructive/20">
            {error}
          </p>
        )}
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={onBack} className="font-bold">
          Back
        </Button>
        <Button
          type="button"
          disabled={!allGood}
          className="font-bold"
          onClick={() => {
            stop();
            onReadyAction();
          }}
        >
          Everything looks good
        </Button>
      </div>
    </div>
  );
}
