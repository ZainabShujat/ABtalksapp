"use client";

import { useEffect, useRef } from "react";
import { VideoOff } from "lucide-react";
import type { CameraState } from "@/features/interview/proctoring/camera";

/**
 * The candidate's own camera, in the corner, for the length of the interview.
 *
 * Two jobs, in this order. First, it is the visible half of proctoring: someone
 * being recorded should be able to see that they are, and see exactly what is
 * being seen. A silent camera would be the same feature with the honesty taken
 * out. Second, it lets them fix their own framing without leaving the page.
 *
 * It is NOT a gate and it is NOT load-bearing. When the camera is blocked or
 * broken this renders a plain "video off" tile and says so, and the interview
 * carries on around it — see the rule at the top of `proctoring/camera.ts`.
 *
 * Fixed to the viewport corner rather than placed in the room's layout, so that
 * `InterviewRoom` needs no slot for it and stays untouched.
 */
export function CameraPreview({ state }: { state: CameraState }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Assigned imperatively: `srcObject` takes a MediaStream, which has no
    // attribute form and cannot be expressed as a JSX prop.
    video.srcObject = state.stream;
    if (state.stream) {
      // Autoplay can still be refused. It costs the preview, nothing else.
      void video.play().catch(() => {});
    }

    return () => {
      video.srcObject = null;
    };
  }, [state.stream]);

  const live = state.status === "active" && state.stream !== null;
  const dot =
    live
      ? { color: "#1A7F37", label: "Camera on" }
      : state.status === "requesting"
        ? { color: "#E0A526", label: "Starting camera" }
        : state.status === "denied" || state.status === "error"
          ? { color: "#C9282B", label: "Camera off" }
          : { color: "#8F8F8F", label: "Camera off" };

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-40 w-[168px] overflow-hidden rounded-[12px] border border-black/10 bg-[#111111] shadow-lg sm:w-[200px]"
      aria-live="polite"
    >
      <div className="relative aspect-[4/3] w-full">
        {live ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            // Mirrored, like every video-call self-view. An unmirrored preview
            // makes people correct their framing the wrong way.
            className="size-full scale-x-[-1] object-cover"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1.5 bg-[#1C1C1C] px-3 text-center">
            <VideoOff className="size-5 text-[#8F8F8F]" strokeWidth={1.75} />
            <p className="text-[11px] leading-tight text-[#8F8F8F]">
              {state.status === "requesting" ? "Starting camera…" : "Camera off"}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 bg-black/60 px-2.5 py-1.5">
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: dot.color }}
        />
        <span className="truncate text-[10px] font-medium text-white/80">
          {dot.label}
        </span>
      </div>
    </div>
  );
}
