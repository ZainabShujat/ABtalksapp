"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { requestCohortTrainAction } from "@/app/actions/hire-actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function GapReport({
  requestId,
  overallGap,
  alertWhenAvailable,
}: {
  requestId: string;
  overallGap: string;
  alertWhenAvailable: boolean;
}) {
  const [pending, start] = useTransition();

  return (
    <section className="space-y-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-5">
      <h2 className="font-display text-lg font-semibold">No strong matches yet</h2>
      <p className="text-sm leading-relaxed text-foreground/90">{overallGap}</p>
      <p className="text-xs text-muted-foreground">
        Your requirement is saved as demand. When members complete verified work
        on this stack, we can re-run Scout or alert you.
      </p>
      <button
        type="button"
        disabled={pending || alertWhenAvailable}
        className={cn(buttonVariants(), "disabled:opacity-50")}
        onClick={() => {
          start(async () => {
            const res = await requestCohortTrainAction(requestId);
            if (!res.ok) toast.error(res.message);
            else toast.success("Training request saved for the program team.");
          });
        }}
      >
        {alertWhenAvailable
          ? "Training request saved"
          : "Train this cohort for me"}
      </button>
    </section>
  );
}
