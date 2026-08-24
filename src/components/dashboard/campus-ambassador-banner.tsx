"use client";

import { useState } from "react";
import { Users, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "abtalks-ca-onboarding-dismissed";
const ONBOARDING_URL = "https://abtalksca.netlify.app/";

export function CampusAmbassadorBanner({
  alreadyApplied,
}: {
  alreadyApplied: boolean;
}) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  });

  if (dismissed) return null;

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  return (
    <div className="relative border-b bg-primary/5">
      <div className="mx-auto flex max-w-6xl items-start justify-between gap-3 px-4 py-2.5 pr-10 md:items-center md:px-6">
        <div className="flex min-w-0 flex-1 items-start gap-2 md:items-center">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-primary md:mt-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {alreadyApplied
                ? "Complete your Campus Ambassador onboarding."
                : "Want to be a campus ambassador for your college?"}
            </p>
            <p className="text-sm text-muted-foreground">
              {alreadyApplied
                ? "You already expressed interest here. Finish enrollment on the official form."
                : "Complete onboarding on the official form."}
            </p>
          </div>
        </div>

        <a
          href={ONBOARDING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ size: "sm" }), "shrink-0")}
        >
          <span className="hidden sm:inline">Complete onboarding</span>
          <span className="sm:hidden">Enroll</span>
        </a>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss until next session"
        className="absolute top-2.5 right-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:top-3 md:right-4"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
