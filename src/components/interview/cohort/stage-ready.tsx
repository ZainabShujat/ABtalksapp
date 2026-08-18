"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export function StageReady({
  onBack,
  onBeginAction,
}: {
  onBack: () => void;
  onBeginAction: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    
    // We request the camera again just for the self-view.
    // In a real app, you might pass the stream down from a higher level context.
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" } })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
      })
      .catch(() => {});

    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div>
      <section className="border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
        <span className="kicker">Ready to start</span>
        <h2 className="mt-3 text-[24px] font-extrabold leading-7 tracking-[-0.01em]">
          Final confirmation
        </h2>

        <div className="mt-6 flex flex-col md:flex-row gap-8">
            <div className="w-full md:w-1/3">
                <div className="aspect-square bg-muted/30 rounded-full overflow-hidden border-4 border-muted relative max-w-[200px] mx-auto">
                    <video
                        ref={videoRef}
                        muted
                        playsInline
                        className="h-full w-full object-cover"
                    />
                </div>
            </div>

            <div className="flex-1 space-y-6 flex flex-col justify-center">
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex gap-3 text-amber-600">
                    <AlertCircle className="size-5 shrink-0 mt-0.5" />
                    <div>
                        <h4 className="font-bold text-sm">One Attempt Only</h4>
                        <p className="text-sm mt-1 opacity-90">
                            Once you begin, you cannot pause or restart. Ensure you have 15 minutes of uninterrupted time.
                        </p>
                    </div>
                </div>

                <ul className="space-y-2 text-[14px] text-foreground/80 font-medium">
                    <li>• Ensure you are in a quiet room.</li>
                    <li>• Close unnecessary tabs and applications.</li>
                    <li>• The interview will automatically request fullscreen mode.</li>
                </ul>
            </div>
        </div>
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={onBack}>
          Wait, go back
        </Button>
        <Button
          type="button"
          className="bg-accent-600 hover:bg-accent-700 text-white"
          onClick={() => {
            // Future: requestFullscreen() here
            onBeginAction();
          }}
        >
          Begin Interview
        </Button>
      </div>
    </div>
  );
}
