"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { decideEngagementAction } from "@/app/actions/hire-request-actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Decision = "IN_REVIEW" | "CONTACT_SHARED" | "DECLINED" | "CLOSED";

const ACTIONS: { decision: Decision; label: string; variant: "default" | "outline" | "ghost" }[] = [
  { decision: "IN_REVIEW", label: "Start review", variant: "outline" },
  { decision: "CONTACT_SHARED", label: "Share contact", variant: "default" },
  { decision: "DECLINED", label: "Decline", variant: "outline" },
  { decision: "CLOSED", label: "Close", variant: "ghost" },
];

export function EngagementDecision({
  engagementId,
  status,
}: {
  engagementId: string;
  status: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function decide(decision: Decision) {
    // Sharing contact is the irreversible one — it hands a real person's
    // details to a recruiter, and there is no taking that back.
    if (
      decision === "CONTACT_SHARED" &&
      !window.confirm(
        "Share this candidate's name and email with the recruiter? This cannot be undone.",
      )
    ) {
      return;
    }

    startTransition(async () => {
      const res = await decideEngagementAction({
        engagementId,
        decision,
        note: note.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setNote("");
      toast.success(`Marked ${res.data.status.toLowerCase().replace("_", " ")}.`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
        placeholder="Reply to the recruiter (optional, posted to the thread)…"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
      />
      <div className="flex flex-wrap gap-2">
        {ACTIONS.filter((a) => a.decision !== status).map((a) => (
          <button
            key={a.decision}
            type="button"
            disabled={pending}
            onClick={() => decide(a.decision)}
            className={cn(
              buttonVariants({ variant: a.variant, size: "sm" }),
              "gap-1.5 disabled:opacity-50",
            )}
          >
            {pending && (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            )}
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
