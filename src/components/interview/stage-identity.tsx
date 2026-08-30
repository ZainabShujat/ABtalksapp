"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Stage 2 — identity check.
 *
 * Deliberately local-only: the frame is drawn to a canvas in the page and never
 * uploaded, transmitted, or persisted. No blob storage, no PII retention, no
 * server round-trip. Real identity verification (document capture, liveness,
 * retention windows) is a separate compliance-bearing feature and is NOT what
 * this is — this stage exists to prove the journey's shape.
 */
export function StageIdentity({
  candidateName,
  onBack,
  onVerifiedAction,
}: {
  candidateName: string;
  onBack: () => void;
  onVerifiedAction: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [captured, setCaptured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  async function enableCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      setError(
        "We could not open your camera. Allow camera access in your browser, then try again.",
      );
    }
  }

  function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setCaptured(true);
    stop();
    setCameraOn(false);
  }

  function retake() {
    setCaptured(false);
    setConfirmed(false);
    void enableCamera();
  }

  return (
    <div>
      <section className="border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
        <span className="kicker">Identity</span>
        <h2 className="mt-3 text-[24px] font-extrabold leading-7 tracking-[-0.01em]">
          Confirm it is you, {candidateName.split(" ")[0]}
        </h2>
        <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
          Take a still so the interview is attributable to you. The image stays
          in this browser tab — you are not uploading it, and we do not store it.
          Close the tab and it is gone.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="border-2 border-[hsl(var(--divider)/0.4)] bg-[hsl(var(--muted))]">
            <div className="relative aspect-[4/3] w-full overflow-hidden">
              <video
                ref={videoRef}
                muted
                playsInline
                className="h-full w-full object-cover"
                style={{ display: cameraOn && !captured ? "block" : "none" }}
              />
              <canvas
                ref={canvasRef}
                className="h-full w-full object-cover"
                style={{ display: captured ? "block" : "none" }}
              />
              {!cameraOn && !captured && (
                <div className="flex h-full w-full items-center justify-start px-5">
                  <Camera
                    className="size-8 text-foreground/40"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                </div>
              )}
            </div>
          </div>

          <div>
            <ul className="space-y-3 text-[15.5px] leading-7 text-foreground/78">
              <li className="flex gap-3">
                <ShieldCheck
                  className="mt-1 size-4 shrink-0 text-primary"
                  strokeWidth={2}
                  aria-hidden
                />
                <span>
                  The still never leaves your device. There is no upload step.
                </span>
              </li>
              <li className="flex gap-3">
                <ShieldCheck
                  className="mt-1 size-4 shrink-0 text-primary"
                  strokeWidth={2}
                  aria-hidden
                />
                <span>
                  Your interview transcript and scores are separate from this
                  check.
                </span>
              </li>
              <li className="flex gap-3">
                <ShieldCheck
                  className="mt-1 size-4 shrink-0 text-primary"
                  strokeWidth={2}
                  aria-hidden
                />
                <span>You decide who sees your result afterwards.</span>
              </li>
            </ul>

            {error && (
              <p className="mt-5 border-2 border-[hsl(var(--destructive))] px-4 py-3 text-[15px] leading-6 text-destructive">
                {error}
              </p>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              {!cameraOn && !captured && (
                <Button type="button" onClick={() => void enableCamera()}>
                  Turn on camera
                </Button>
              )}
              {cameraOn && !captured && (
                <Button type="button" onClick={capture}>
                  Take the still
                </Button>
              )}
              {captured && (
                <Button type="button" variant="outline" onClick={retake}>
                  Retake
                </Button>
              )}
            </div>

            {captured && (
              <label className="mt-5 flex cursor-pointer items-start gap-3 text-[15.5px] leading-7">
                <input
                  type="checkbox"
                  className="mt-1.5 size-4 shrink-0 border-2 accent-[hsl(var(--primary))]"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  This is me, and I am taking this interview myself.
                </span>
              </label>
            )}
          </div>
        </div>
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          type="button"
          disabled={!captured || !confirmed}
          onClick={onVerifiedAction}
        >
          <Check className="size-4" strokeWidth={2} aria-hidden />
          Continue to camera and mic
        </Button>
      </div>
    </div>
  );
}
