"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { placeEngagementRequestAction } from "@/app/actions/hire-request-actions";
import { useHireAuth } from "@/components/hire/hire-auth-provider";
import { savePendingCheckout } from "@/components/hire/pending-checkout";
import { markRequested } from "@/components/hire/desk-requested";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS_COPY: Record<string, string> = {
  SUBMITTED: "Request sent",
  IN_REVIEW: "With our team",
  CONTACT_SHARED: "Contact shared",
  DECLINED: "Declined",
  CLOSED: "Closed",
};

type Props = {
  /** `PROGRAM:<id>` / `CLAUDE:<id>` — resolved server-side against its own
   *  table, so this is a name for a candidate and never a key to reach one. */
  candidateRef: string;
  requestId?: string;
  /** Status of the recruiter's existing live request, if there is one. */
  existingStatus?: string | null;
  publicId: string;
  className?: string;
};

export function RequestIntroButton({
  candidateRef,
  requestId,
  existingStatus,
  publicId,
  className,
}: Props) {
  const router = useRouter();
  const { approved, pending: approvalPending, openAuth } = useHireAuth();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(existingStatus ?? null);
  const [pending, startTransition] = useTransition();

  if (status) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
          status === "CONTACT_SHARED"
            ? "bg-primary/10 text-primary"
            : status === "DECLINED"
              ? "bg-muted text-muted-foreground"
              : "bg-amber-500/10 text-amber-900 dark:text-amber-100",
        )}
      >
        <Lock className="size-3" aria-hidden="true" />
        {STATUS_COPY[status] ?? status}
      </span>
    );
  }

  function submit() {
    if (!approved) {
      if (approvalPending) {
        toast.error("Your recruiter application is still being reviewed.");
        return;
      }
      savePendingCheckout({
        candidateRefs: [candidateRef],
        note: note.trim() || undefined,
      });
      openAuth("checkout");
      return;
    }
    startTransition(async () => {
      const res = await placeEngagementRequestAction({
        candidateRef,
        requestId,
        note: note.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setStatus(res.data.status);
      markRequested([candidateRef]);
      setOpen(false);
      toast.success(`Request sent for ${publicId}. Our team will pick it up.`);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          if (!approved) {
            if (approvalPending) {
              toast.error("Your recruiter application is still being reviewed.");
              return;
            }
            savePendingCheckout({ candidateRefs: [candidateRef] });
            openAuth("checkout");
            return;
          }
          setOpen(true);
        }}
        className={cn(
          // The one action that moves the business. It sat in the same
          // outline treatment as "View", so on a dark card all three read as
          // the same disabled-looking grey and nothing invited a click.
          buttonVariants({ variant: "default", size: "lg" }),
          "gap-1.5 shadow-sm",
          className,
        )}
      >
        <MessageSquarePlus className="size-3.5" aria-hidden="true" />
        Request an intro
      </button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-lg border bg-muted/40 p-3">
      <label
        htmlFor={`note-${candidateRef}`}
        className="text-xs font-medium"
      >
        Anything our team should know? <span className="text-muted-foreground">(optional)</span>
      </label>
      <textarea
        id={`note-${candidateRef}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="e.g. we'd interview this week, budget is flexible for the right person"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}
        >
          {pending && (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          )}
          Send request
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setOpen(false)}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          Cancel
        </button>
        <p className="text-xs text-muted-foreground">
          {publicId} stays anonymous until our team confirms.
        </p>
      </div>
    </div>
  );
}
