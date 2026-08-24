"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCookieConsent,
  type CookieChoice,
} from "@/components/legal/cookie-consent-provider";

/**
 * Bottom-corner cookie banner.
 * Mobile: compact card (short copy, tight padding, smaller buttons) so it
 * does not dominate the screen. Desktop: slightly roomier CodeSignal-style card.
 *
 * Not a dialog: no overlay, no focus trap. Ignoring it means no attribution
 * cookies until a choice is made (middleware gates on consent).
 */
export function CookieConsentModal() {
  const { isOpen, choice, decide, close } = useCookieConsent();
  const [pending, setPending] = useState<CookieChoice | null>(null);

  // Only closable once a choice exists — i.e. when reopened from /cookies.
  const dismissible = choice !== null;

  useEffect(() => {
    if (!isOpen || !dismissible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, dismissible, close]);

  if (!isOpen) return null;

  async function onChoose(next: CookieChoice) {
    setPending(next);
    try {
      await decide(next);
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;

  return (
    <div
      role="region"
      aria-label="Cookie choices"
      className={cn(
        // Mobile: ~18rem (slightly roomier than 16.5); desktop: up to 21rem.
        "fixed z-100 w-[min(calc(100%-1.5rem),18rem)] sm:w-[min(calc(100%-2rem),21rem)]",
        "left-3 right-auto sm:left-4",
        // Clear mobile bottom nav without floating too high.
        "bottom-[4.5rem] sm:bottom-5 md:bottom-6",
        "overflow-hidden rounded-lg border border-border/80 bg-background shadow-xl sm:rounded-xl sm:shadow-2xl",
        "theme-abtalks-orange",
      )}
    >
      <div className="h-1 w-full bg-primary sm:h-1.5" aria-hidden="true" />

      <div className="p-3.5 sm:p-4">
        <div className="flex items-start gap-2">
          {/* Short line on mobile; slightly fuller on sm+ */}
          <p className="flex-1 text-xs leading-snug text-muted-foreground sm:text-[13px] sm:leading-relaxed">
            <span className="sm:hidden">
              We use cookies for sign-in and optional attribution.{" "}
              <Link
                href="/cookies"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Details
              </Link>
              .
            </span>
            <span className="hidden sm:inline">
              This site uses cookies for essential sign-in, and optional ones for
              referrals and share attribution.{" "}
              <Link
                href="/terms"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Terms
              </Link>
              {" · "}
              <Link
                href="/privacy"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Privacy
              </Link>
              {" · "}
              <Link
                href="/cookies"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Cookie details
              </Link>
              .
            </span>
          </p>
          {dismissible && (
            <button
              type="button"
              onClick={close}
              aria-label="Close cookie choices"
              className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:p-1"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:mt-3 sm:gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onChoose("limited")}
            className={cn(
              "inline-flex h-9 items-center justify-center rounded-md border border-border sm:h-9",
              "bg-background px-2.5 text-[11px] font-semibold tracking-wide uppercase sm:px-3 sm:text-xs",
              "text-foreground transition-colors hover:bg-muted",
              "focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-60",
              choice === "limited" && "ring-1 ring-primary/50",
            )}
          >
            {pending === "limited" ? "…" : "Limited"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onChoose("essential")}
            className={cn(
              "inline-flex h-9 items-center justify-center rounded-md border border-border sm:h-9",
              "bg-background px-2.5 text-[11px] font-semibold tracking-wide uppercase sm:px-3 sm:text-xs",
              "text-foreground transition-colors hover:bg-muted",
              "focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-60",
              choice === "essential" && "ring-1 ring-primary/50",
            )}
          >
            {pending === "essential" ? "…" : "Reject all"}
          </button>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => onChoose("all")}
          className={cn(
            "mt-1.5 flex h-9 w-full items-center justify-center rounded-md sm:mt-2 sm:h-10",
            "bg-primary px-2.5 text-[11px] font-semibold tracking-wide uppercase sm:px-3 sm:text-xs",
            "text-primary-foreground transition-colors hover:bg-primary/90",
            "focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-60",
            choice === "all" &&
              "ring-2 ring-primary/40 ring-offset-2 ring-offset-background",
          )}
        >
          {pending === "all" ? "…" : "Accept all"}
        </button>
      </div>
    </div>
  );
}
