"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { recordSampleDemandAction } from "@/app/actions/hire-actions";
import { useHireAuth } from "@/components/hire/hire-auth-provider";
import { savePendingDemand } from "@/components/hire/pending-demand";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { JobSpec } from "@/lib/validations/hire";

export type SampleDemand = {
  spec: JobSpec;
  requestId?: string | null;
  alreadyRecorded?: boolean;
};

/**
 * The banner and the demand button on a sample card.
 *
 * The banner is not dismissible and not a tooltip — a recruiter who mistakes
 * this for a person is the failure this exists to prevent. The button is the
 * feature: it is how unmet demand reaches the board admin already reads.
 */
export function SampleCardNotice({
  spec,
  requestId,
  alreadyRecorded = false,
}: SampleDemand) {
  const { signedIn, openAuth } = useHireAuth();
  const [recorded, setRecorded] = useState(alreadyRecorded);
  const [pending, startTransition] = useTransition();

  function capture() {
    if (recorded || pending) return;
    if (!signedIn) {
      savePendingDemand({ spec });
      openAuth("checkout");
      return;
    }
    startTransition(async () => {
      const res = await recordSampleDemandAction(
        requestId ? { requestId } : { spec },
      );
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setRecorded(true);
    });
  }

  return (
    <div className="space-y-3">
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900 dark:text-amber-100">
        <strong className="font-semibold">Sample profile.</strong> Nobody in
        the pool matches this yet. Tell us and we&apos;ll find or train someone
        — you&apos;ll hear from us when they exist.
      </p>
      {recorded ? (
        <p className="text-sm font-medium">Noted — we&apos;ll be in touch.</p>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={capture}
          className={cn(buttonVariants(), "disabled:opacity-50")}
        >
          Tell ABTalks I need this
        </button>
      )}
    </div>
  );
}
