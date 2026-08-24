"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { toast } from "sonner";
import { acceptCurrentLegalVersionsAction } from "@/app/actions/legal-actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "abtalks-reconsent-dismissed";

export function ConsentRefreshBanner({
  needsReconsent,
}: {
  needsReconsent: boolean;
}) {
  const [accepted, setAccepted] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  });
  const [isPending, startTransition] = useTransition();

  if (!needsReconsent || accepted || dismissed) return null;

  function accept() {
    startTransition(async () => {
      const result = await acceptCurrentLegalVersionsAction();
      if (result.ok) {
        setAccepted(true);
        toast.success("Thanks — your acceptance has been recorded.");
      } else {
        toast.error(result.message ?? "Could not record your acceptance");
      }
    });
  }

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  return (
    <div className="theme-abtalks-orange relative mb-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3.5 pr-10">
      <p className="text-sm font-medium text-foreground">
        We&apos;ve updated our Terms and Privacy Policy
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        We now publish our registered entity and Grievance Officer, and have
        clarified how certificates, recruiter introductions, and Synergy Points
        work. Please review and accept to continue.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={accept}
          disabled={isPending}
          className={cn(buttonVariants({ size: "sm" }), "disabled:opacity-60")}
        >
          {isPending ? "Saving…" : "I accept"}
        </button>
        <Link
          href="/terms"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Terms
        </Link>
        <Link
          href="/privacy"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Privacy Policy
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss until next session"
        className="absolute top-3 right-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
