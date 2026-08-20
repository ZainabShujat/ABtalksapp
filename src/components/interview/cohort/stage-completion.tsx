"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

/**
 * Interview completion transition.
 *
 * "Assessment complete. Your interview report is being prepared."
 * Does NOT immediately dump a scorecard.
 */
export function StageCompletion({
  onViewReport,
}: {
  onViewReport: () => void;
}) {
  const [ready, setReady] = useState(false);

  // Simulate brief processing before showing the CTA
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 2500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="min-h-[70vh] flex items-center justify-center"
      style={{ animation: "iv-fade-in 0.6s ease-out" }}
    >
      <div className="text-center max-w-[48ch] mx-auto px-6">
        <div
          className="mx-auto mb-6 flex size-16 items-center justify-center border-2 border-[hsl(var(--divider)/0.4)] bg-primary/10"
          style={{ animation: "iv-check-in 0.5s ease-out 0.3s both" }}
        >
          <CheckCircle2 className="size-7 text-primary" strokeWidth={1.5} />
        </div>

        <span className="kicker" style={{ display: "inline-block" }}>
          Complete
        </span>

        <h1 className="mt-4 text-[clamp(28px,3.6vw,42px)] font-extrabold leading-[1.1] tracking-[-0.02em]">
          Interview complete.
        </h1>

        <p className="mt-4 text-[16px] leading-7 text-foreground/65">
          Your responses have been evaluated across five competencies.
        </p>

        {!ready ? (
          <div className="mt-8 flex items-center justify-center gap-2 text-[14px] text-foreground/45">
            <span className="size-3 rounded-full border-2 border-foreground/15 border-t-primary animate-spin" />
            Your interview report is being prepared...
          </div>
        ) : (
          <div className="mt-8" style={{ animation: "iv-fade-in 0.4s ease-out" }}>
            <Button
              type="button"
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 text-[15px] font-bold"
              onClick={onViewReport}
            >
              View Assessment
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
