"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Bookmark, Briefcase, ClipboardCheck, FolderKanban, Menu, UserCheck, X } from "lucide-react";
import { RecruiterAccountMenu } from "@/components/hire/recruiter-account-menu";
import { CreditBalancePill } from "@/components/hire/credit-balance-pill";
import { useHireAuth } from "@/components/hire/hire-auth-provider";
import { useHireDesk } from "@/components/hire/hire-desk-context";
import { HireJourney } from "@/components/hire/hire-journey";
import { HireSidebar } from "@/components/hire/hire-sidebar";
import { HireTalentPod } from "@/components/hire/hire-talent-pod";
import { projectIdFromPath, scopePodRows } from "@/components/hire/shortlist-scope";
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
import type { RecruiterAccountSnapshot } from "@/features/hire/recruiter-account-types";
import { hireZoomFor } from "@/components/hire/hire-zoom";
import { cn } from "@/lib/utils";

export function HireChrome({
  account,
  credits,
  podRows,
  unreadMessages,
  projects,
  children,
}: {
  account: RecruiterAccountSnapshot | null;
  /** Null when this visitor has no recruiter workspace to have a balance in. */
  credits: { balanceMinor: number; currency: string } | null;
  /** Every shortlist row the recruiter has, tagged with its project; scoped below. */
  podRows: CartRow[];
  /** T-232: unread outreach replies, resolved server-side in the layout. */
  unreadMessages: number;
  /** Plan 133: the recruiter's projects, for switching in the nav card. */
  projects: { id: string; label: string; updatedAt: string }[];
  children: React.ReactNode;
}) {
  const { approved, openAuth } = useHireAuth();
  const { view, landing, openPod, closePod, openSaved } = useHireDesk();
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

  // Screen 2's scale (see hire-zoom.ts). The layout's inline script covers a
  // full page load; this covers resizing and arriving by client navigation.
  useEffect(() => {
    const fit = () =>
      document.documentElement.style.setProperty(
        "--hire-zoom",
        String(hireZoomFor(window.innerWidth)),
      );
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const pathname = usePathname();
  // Plan 133: the header shortlist is the OPEN project's, never a union of
  // projects. Off-project it is the legacy saved list, which belongs to none.
  // The count is taken from the same scoped array the panel renders.
  const openProjectId = projectIdFromPath(pathname);
  const scopedRows = scopePodRows(podRows, openProjectId);
  const openProjectLabel = openProjectId
    ? (projects.find((p) => p.id === openProjectId)?.label ?? "This project")
    : null;
  const cartCount = approved ? scopedRows.length + overlayCount : guestCount;
  // The desk is `/hire` itself and a project at `/hire/<id>`. Every other
  // `/hire/<page>` is a plain page and must NOT get the project-desk shell.
  //
  // Derived from `projectIdFromPath` rather than a second hardcoded list of
  // exclusions kept in this file: the two lists drifted, which is how
  // `/hire/jobs` ended up rendering inside the desk while `/hire/jobs/new`
  // did not. `shortlist-scope.ts` owns that list now — one place to add a
  // route, and it is already unit-tested.
  const desk = pathname === "/hire" || Boolean(openProjectId);
  // Any desk route, not just `/hire`: "New search" inside a project returns
  // `/hire/[id]` to screen 1 without leaving the project.
  const isLanding = desk && landing && view === "scout";
  // Everything on the desk after the landing is the results screen (Figma
  // 1585:46): nav card left, results over the composer, profile panel right.
  const isResults = desk && !isLanding;

  // Phones (≤900px) hide the nav card, so it becomes a drawer behind a menu
  // button. Only offered where a sidebar is actually rendered below.
  const hasNav = isResults || (!desk && Boolean(account));
  const [navOpen, setNavOpen] = useState(false);
  const [navPath, setNavPath] = useState(pathname);
  if (pathname !== navPath) {
    setNavPath(pathname);
    setNavOpen(false);
  }

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    // A link or "New search" inside the drawer closes it, including links to
    // the page already open, which the pathname check above cannot see.
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest(".hire-side a[href], .hire-side .hire-side__new")) {
        setNavOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [navOpen]);

  const [seenCartCount, setSeenCartCount] = useState(cartCount);
  if (cartCount !== seenCartCount) {
    setSeenCartCount(cartCount);
    if (podDismissed && (cartCount === 0 || cartCount > seenCartCount)) {
      setPodDismissed(false);
    }
  }

  return (
    <div
      className={cn(
        "hire-app",
        desk && "hire-app--desk",
        isLanding && "hire-app--landing",
        isResults && "hire-app--results",
        hasNav && "hire-app--has-nav",
        hasNav && navOpen && "hire-app--nav-open",
      )}
    >
      {/* The green field is its OWN layer, not the landing's background, so
          the two screens can cross-fade through it instead of the page
          swapping colour in one frame. It is painted on both screens and
          simply faded out on the results side. */}
      {desk && (
        <div className="hire-field" aria-hidden="true">
          {/* Light-green blobs (moving) interleaved with the static dark
              layers in the ORIGINAL gradient's paint order, so screen 1 is
              exactly as bright as the design — just no longer still. */}
          {(["a", "d", "b"] as const).map((g) => (
            <span key={g} className={`hire-field__glow hire-field__glow--${g}`}>
              <span className="hire-field__glow-y">
                <span className="hire-field__glow-core" />
              </span>
            </span>
          ))}
          <span className="hire-field__shade hire-field__shade--low" />
          <span className="hire-field__glow hire-field__glow--c">
            <span className="hire-field__glow-y">
              <span className="hire-field__glow-core" />
            </span>
          </span>
          <span className="hire-field__shade hire-field__shade--high" />
        </div>
      )}

      <header className="hire-app__header">
        {hasNav && (
          <button
            type="button"
            className="hire-menu-btn"
            aria-label={navOpen ? "Close menu" : "Open menu"}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((v) => !v)}
          >
            <Menu className="hire-menu-btn__icon" aria-hidden="true" />
          </button>
        )}
        <Link href="/" className="hire-app__brand" aria-label="ABTalks home">
          <span className="hire-app__logo">
            {/* The same stacked-wordmark swap runs on the desk AND on plain
                /hire/* pages (requests, jobs, messages, settings, …) so the
                header brand reads identically once the user is inside Hire.
                The dark wordmark shows on every non-landing page; the light
                one is only revealed while `.hire-app--landing` is on (screen
                1's green field). Swapping the <Image> at the JS boundary
                instead of crossfading here made the header change a frame
                ahead of the background. */}
            <span className="hire-app__logo-swap">
              <Image
                src="/hire/abtalks-wordmark.png"
                alt={isLanding ? "ABTalks" : ""}
                aria-hidden={!isLanding || undefined}
                width={342}
                height={67}
                priority
                className="hire-app__logo-img hire-app__logo-img--light"
              />
              <Image
                src="/hire/abtalks-wordmark-dark.png"
                alt={isLanding ? "" : "ABTalks"}
                aria-hidden={isLanding || undefined}
                width={346}
                height={81}
                priority
                className="hire-app__logo-img hire-app__logo-img--dark"
              />
            </span>
          </span>
        </Link>

        <nav className="hire-app__nav">
          {/* Screen 1 carries the wordmark and Sign in only (Figma 1570:438):
              the workspace's pills belong to the dashboard, and sat over the
              green hero after the master merge dropped this guard.

              `isResults`, not `!isLanding`: Save for later and Shortlist are
              toggles for the desk's side panels, and those panels only exist
              inside the desk. On Search history, Messages or Settings the
              panel has nowhere to render, so the buttons did nothing — and
              worse, the click still set `view` on the shared desk context, so
              the desk opened parked the next time you went back to it. */}
          {isResults && (
            <>
              <button
                type="button"
                className={cn(
                  "hire-hbtn",
                  starCount > 0 && "has-count",
                  view === "saved" && "is-current",
                )}
                aria-current={view === "saved" ? "page" : undefined}
                title="Kept on this device — nothing is sent to our team from here"
                onClick={() => (view === "saved" ? closePod() : openSaved())}
              >
                <Bookmark className="hire-hbtn__svg" aria-hidden="true" />
                <span>Save for later</span>
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
                <UserCheck className="hire-hbtn__svg" aria-hidden="true" />
                <span>Shortlist</span>
                {cartCount > 0 && (
                  <span className="hire-hbtn__count">{cartCount}</span>
                )}
              </button>
            </>
          )}
          {/* Credits and Assessments are plain navigation/information and are
              correct on every page except the hero, so they keep the wider
              guard. */}
          {!isLanding && (
            <>
              {credits ? (
                <CreditBalancePill
                  balanceMinor={credits.balanceMinor}
                  currency={credits.currency}
                />
              ) : null}
              <Link
                href="/hire/jobs"
                className={cn(
                  "hire-hbtn",
                  "hire-hbtn--label",
                  pathname.startsWith("/hire/jobs") && "is-current",
                )}
                aria-current={
                  pathname.startsWith("/hire/jobs") ? "page" : undefined
                }
              >
                <Briefcase className="hire-hbtn__svg" aria-hidden="true" />
                <span>Jobs</span>
              </Link>
              <Link
                href="/hire/assessments"
                className={cn(
                  "hire-hbtn",
                  "hire-hbtn--label",
                  pathname === "/hire/assessments" && "is-current",
                )}
                aria-current={pathname === "/hire/assessments" ? "page" : undefined}
              >
                <ClipboardCheck className="hire-hbtn__svg" aria-hidden="true" />
                <span>Assessments</span>
              </Link>
            </>
          )}
          {account ? (
            <>
              {isLanding && (
                <Link
                  href="/hire/projects"
                  className={cn(
                    "hire-hbtn",
                    "hire-hbtn--label",
                    "hire-hbtn--landing-projects",
                    pathname.startsWith("/hire/projects") && "is-current",
                  )}
                  title="Your past searches, grouped by project"
                >
                  <FolderKanban className="hire-hbtn__svg" aria-hidden="true" />
                  <span>Search history</span>
                </Link>
              )}
              <RecruiterAccountMenu account={account} />
            </>
          ) : (
            <button
              type="button"
              onClick={() => openAuth("nav")}
              className="hire-signin"
            >
              Sign in
            </button>
          )}
        </nav>
      </header>

      {desk ? (
        <main className="hire-workspace">
          {isResults && (
            <HireSidebar
              account={account}
              unreadMessages={unreadMessages}
              projects={projects}
              openProjectId={openProjectId}
            />
          )}
          {/* On desktop the results screen hides this rail behind the nav card;
              phones keep its compact step strip. */}
          {!isLanding && <HireJourney />}
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
              <HireTalentPod
                serverRows={scopedRows}
                scopeLabel={
                  openProjectLabel
                    ? `Project: ${openProjectLabel}`
                    : approved
                      ? "Saved candidates — not part of any project"
                      : undefined
                }
              />
            </div>
          )}
          {view === "saved" && (
            <div className="hire-pod-region">
              <HireSavedLater />
            </div>
          )}
        </main>
      ) : (
        /* Every non-desk /hire page — Projects, Messages, Settings, Assessments,
           Evidence — renders inside the SAME shell as the desk: one header
           above, one sidebar beside. Before this they were bare centred
           containers, so moving between /hire and /hire/messages felt like
           moving between two products.

           The candidate detail rail is deliberately NOT here: it belongs to
           the results grid and has nothing to show on a Settings page. */
        <main className="hire-shell">
          {account && (
            /* The rail holds the nav card at its designed 281px. The desk
               cancels its own shell zoom to match this (see hire-scout.css),
               so the sidebar is one size everywhere rather than 211px on the
               results screen and 281px here. */
            <div className="hire-shell__rail">
              <HireSidebar
                account={account}
                unreadMessages={unreadMessages}
                projects={projects}
                // No project is "open" on a plain page, so the sidebar lists
                // projects without pretending one of them is current.
                openProjectId={null}
              />
            </div>
          )}
          <div className="hire-shell__content">{children}</div>
        </main>
      )}

      {hasNav && navOpen && (
        <button
          type="button"
          className="hire-nav-scrim"
          aria-label="Close menu"
          tabIndex={-1}
          onClick={() => setNavOpen(false)}
        />
      )}

      {/* Same reasoning as the header pills: this bar's "View Shortlist"
          opens the desk panel, so off the desk it led nowhere. */}
      {cartCount > 0 && !podDismissed && view === "scout" && isResults && (
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
