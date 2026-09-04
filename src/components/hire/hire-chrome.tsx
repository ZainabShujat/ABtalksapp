"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { RecruiterAccountMenu } from "@/components/hire/recruiter-account-menu";
import { useHireAuth } from "@/components/hire/hire-auth-provider";
import { useHireDesk } from "@/components/hire/hire-desk-context";
import { HireJourney, HireRail } from "@/components/hire/hire-journey";
import { HireTalentPod } from "@/components/hire/hire-talent-pod";
import { HireSavedLater } from "@/components/hire/hire-saved-later";
import type { CartRow } from "@/components/hire/shortlist-cart";
import {
  guestCartNonProgram,
  readGuestCart,
} from "@/components/hire/guest-cart";
import {
  DESK_SHORTLIST_EVENT,
  readDeskShortlist,
} from "@/components/hire/desk-shortlist";
import { signOutAction } from "@/app/actions/auth-actions";
import type { RecruiterAccountSnapshot } from "@/features/hire/recruiter-account-types";
import { cn } from "@/lib/utils";

export function HireChrome({
  account,
  serverCartCount,
  pendingName,
  podRows,
  children,
}: {
  account: RecruiterAccountSnapshot | null;
  serverCartCount: number;
  pendingName: string | null;
  podRows: CartRow[];
  children: React.ReactNode;
}) {
  const { approved, openAuth, authEnabled } = useHireAuth();
  const { view, started, openPod, closePod, openSaved } = useHireDesk();
  const [guestCount, setGuestCount] = useState(0);
  const [overlayCount, setOverlayCount] = useState(0);
  const [starCount, setStarCount] = useState(0);
  const [podDismissed, setPodDismissed] = useState(false);

  useEffect(() => {
    const sync = () => {
      setGuestCount(readGuestCart().length);
      setOverlayCount(guestCartNonProgram().length);
      setStarCount(readDeskShortlist().length);
    };
    sync();
    window.addEventListener("abtalks-hire-cart", sync);
    window.addEventListener(DESK_SHORTLIST_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("abtalks-hire-cart", sync);
      window.removeEventListener(DESK_SHORTLIST_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const cartCount = approved ? serverCartCount + overlayCount : guestCount;
  const pathname = usePathname();
  const desk =
    pathname === "/hire" ||
    (/^\/hire\/[^/]+$/.test(pathname ?? "") &&
      pathname !== "/hire/evidence" &&
      pathname !== "/hire/requests" &&
      pathname !== "/hire/matches");

  const [seenCartCount, setSeenCartCount] = useState(cartCount);
  if (cartCount !== seenCartCount) {
    setSeenCartCount(cartCount);
    if (podDismissed && (cartCount === 0 || cartCount > seenCartCount)) {
      setPodDismissed(false);
    }
  }

  return (
    <div className={cn("hire-app", desk && "hire-app--desk")}>
      <header className="hire-app__header">
        <Link href="/" className="hire-app__brand" aria-label="ABTalks home">
          <span className="hire-app__logo">
            <Image
              src="/landing/abtalks-logo-mark.png"
              alt="ABTalks"
              width={561}
              height={168}
              priority
            />
          </span>
          <span className="hire-app__badge">Hire</span>
        </Link>

        <nav className="hire-app__nav">
          <button
            type="button"
            className={cn(
              "hire-hbtn",
              starCount > 0 && "has-count",
              view === "saved" && "is-current",
            )}
            aria-current={view === "saved" ? "page" : undefined}
            title="Kept on this device. Nothing is sent to our team from here"
            onClick={() => (view === "saved" ? closePod() : openSaved())}
          >
            <span className="hire-hbtn__icon hire-hbtn__icon--list" aria-hidden="true">
              <img src="/hire/shortlist.jpg" alt="" width={14} height={18} />
            </span>
            <span>Save for Later</span>
            {starCount > 0 && (
              <span className="hire-hbtn__count">{starCount}</span>
            )}
          </button>
          <button
            type="button"
            className={cn(
              "hire-hbtn",
              cartCount > 0 && "has-count",
              view === "pod" && "is-current",
            )}
            aria-current={view === "pod" ? "page" : undefined}
            onClick={() => (view === "pod" ? closePod() : openPod())}
          >
            <span className="hire-hbtn__icon hire-hbtn__icon--pod" aria-hidden="true">
              <img src="/hire/talentpod.jpg" alt="" width={18} height={20} />
            </span>
            <span>Shortlist</span>
            {cartCount > 0 && (
              <span className="hire-hbtn__count">{cartCount}</span>
            )}
          </button>
          {account ? (
            <RecruiterAccountMenu account={account} />
          ) : pendingName ? (
            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded-lg px-2 py-1 text-left text-xs"
                title="Application pending review"
              >
                <span className="block font-medium">{pendingName}</span>
                <span className="text-muted-foreground">Pending · Sign out</span>
              </button>
            </form>
          ) : authEnabled ? (
            <>
              <button
                type="button"
                onClick={() => openAuth("nav")}
                className="hire-signin"
              >
                Sign in
              </button>
            </>
          ) : null}
        </nav>
      </header>

      {desk ? (
        /* Two layouts, one tree.
           Landing: the journey sits beside the desk as a 300px column.
           Working: that column collapses and the same journey reappears as the
           compact rail above the desk — the layout the phone has always used —
           so the workspace takes the full width once there is something in it.
           `is-started` drives both, and the collapse is a width transition on
           the slot rather than a display swap, so it is one movement. */
        <main className={cn("hire-workspace", started && "is-started")}>
          <div className="hire-journey-slot">
            <HireJourney />
          </div>
          <div className="hire-workspace__main">
            <HireRail />
            <div
              className={cn(
                "hire-scout-region",
                view !== "scout" && "is-parked",
              )}
            >
              {children}
            </div>
            {view === "pod" && (
              <div className="hire-pod-region">
                <HireTalentPod serverRows={podRows} />
              </div>
            )}
            {view === "saved" && (
              <div className="hire-pod-region">
                <HireSavedLater />
              </div>
            )}
          </div>
        </main>
      ) : (
        <div className="hire-plain">{children}</div>
      )}

      {cartCount > 0 && !podDismissed && view === "scout" && (
        <div className="hire-podbar" role="status">
          <span className="hire-podbar__icon" aria-hidden="true">
            <img src="/hire/talentpod.jpg" alt="" width={18} height={20} />
          </span>
          <span>
            {cartCount} in Shortlist
            {starCount > 0 && (
              <>
                <span className="hire-podbar__dot" aria-hidden="true">
                  {" · "}
                </span>
                {starCount} saved for later
              </>
            )}
          </span>
          <button type="button" onClick={openPod}>
            View Shortlist
          </button>
          <button
            type="button"
            className="hire-podbar__close"
            aria-label="Dismiss"
            onClick={() => setPodDismissed(true)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
