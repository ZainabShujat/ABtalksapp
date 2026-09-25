"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VideoRegistrationForm } from "@/components/hackathon-video/registration-form";
import { cn } from "@/lib/utils";

type Prefill = { fullName: string; email: string };

type Props = {
  /** True when the visitor has a live session (any Google-authed user). */
  isAuthed: boolean;
  /** True only when a `HackathonVideoRegistration` row already exists. */
  registered: boolean;
  /** Whether the event is still accepting registrations (config + time). */
  registrationOpen: boolean;
  /** Read from the session for the identity echo. Null when unauth. */
  prefill: Prefill | null;
  /** Visual variant — landing header uses "pill", hero uses "cta". */
  variant?: "pill" | "cta";
  /** Full-width button (for stacked mobile layouts). */
  fullWidth?: boolean;
};

/**
 * The single "Register" surface for VideoThon.
 *
 * State machine:
 * - Guest + registration open   → button that fires `signIn("google")` with
 *                                 callback back to `/hackathon`, so the landing
 *                                 auto-opens the form dialog when they return.
 * - Auth + no registration row  → button that opens the form dialog inline.
 * - Auth + registration row     → link to `/hackathon/dashboard`.
 * - Registration closed         → disabled "Registration closed" pill.
 *
 * Auto-open behavior: when the landing renders with `isAuthed && !registered`
 * (i.e. immediately after Google callback), the effect below opens the dialog
 * automatically. This is what makes the "sign in → form" flow feel seamless.
 */
export function VideothonRegisterCTA({
  isAuthed,
  registered,
  registrationOpen,
  prefill,
  variant = "cta",
  fullWidth,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [signingIn, startSignIn] = useTransition();

  const label = registered
    ? "Go to dashboard"
    : registrationOpen
      ? isAuthed
        ? "Complete registration"
        : "Register now"
      : "Registration closed";

  // Two different button systems on purpose:
  //   - variant="pill" renders in the shell's `.ab-header` (OUTSIDE `.vt`), so
  //     it uses the shell's own `ab-btn ab-btn--primary ab-header__cta` classes
  //     — these are defined in `hackathon-v2.css` and already sized for the
  //     header rail (36px tall, brand-colored). Using `.vt-btn` here breaks
  //     because the CSS variables it depends on live under `.vt` only.
  //   - variant="cta" lives inside the hero (INSIDE `.vt`), so `.vt-btn` works.
  const className = cn(
    variant === "pill"
      ? "ab-btn ab-btn--primary ab-header__cta vt-mono-cta"
      : "vt-btn",
    variant === "cta" && "vt-btn--primary vt-btn--lg",
    fullWidth && "vt-btn--full",
  );

  if (registered) {
    return (
      <Link href="/hackathon/dashboard" className={className}>
        {label} <span aria-hidden>→</span>
      </Link>
    );
  }

  if (!registrationOpen) {
    return (
      <button type="button" className={className} disabled>
        {label}
      </button>
    );
  }

  if (!isAuthed) {
    return (
      <button
        type="button"
        className={className}
        disabled={signingIn}
        onClick={() => {
          startSignIn(() => {
            // Carrying the current `?s=...` attribution slug through the OAuth
            // round-trip: the cookie is only written by the middleware on
            // subsequent visits with a slug, so the callback URL preserves it.
            const sourceSlug = params.get("s");
            const callback = sourceSlug
              ? `/hackathon?s=${encodeURIComponent(sourceSlug)}`
              : "/hackathon";
            void signIn("google", { callbackUrl: callback });
          });
        }}
      >
        {signingIn ? "Redirecting…" : label}
      </button>
    );
  }

  // Auth + no registration row → open the dialog inline.
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="vt-dialog">
          <DialogHeader className="vt-dialog__head">
            <DialogTitle className="vt-dialog__title">
              Register for VideoThon
            </DialogTitle>
            <DialogDescription className="vt-dialog__sub">
              Solo entry, individual competition. Fill this once and you're in.
            </DialogDescription>
          </DialogHeader>
          <div className="vt-dialog__body">
            {prefill ? (
              <VideoRegistrationForm
                prefill={prefill}
                onSuccess={() => {
                  setOpen(false);
                  // Reload so the landing re-runs with the fresh registration
                  // row and swaps the CTA to "Go to dashboard".
                  router.refresh();
                }}
              />
            ) : (
              <p className="vt-form__error">Reload the page to continue.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
