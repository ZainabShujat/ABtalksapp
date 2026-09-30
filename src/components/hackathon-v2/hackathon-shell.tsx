"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DashboardSidebar } from "@/components/dashboard-hub/dashboard-sidebar";
import { NotificationBellButton } from "@/components/shared/notification-bell-button";

export type HackathonShellUser = {
  name: string;
  email: string;
  image: string | null;
};

type Props = {
  headerCta: ReactNode;
  user: HackathonShellUser;
  /** `/hackathon` is a public route — guests get a Log in link, not a user tile. */
  isAuthed: boolean;
  children: ReactNode;
};

/**
 * Hackathon landing shell. The nav column is the shared ABTalks
 * `DashboardSidebar` — same one `/dashboard`, `/jobs` and `/profile` render —
 * so this route can't drift from the rest of the app. Only the header is
 * local, because it carries the hackathon registration CTA.
 */
export function HackathonShell({
  headerCta,
  user,
  isAuthed,
  children,
}: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeSidebar();
    }
    if (!sidebarOpen) return;
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sidebarOpen, closeSidebar]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    function onWide(e: MediaQueryListEvent) {
      if (e.matches) closeSidebar();
    }
    mq.addEventListener("change", onWide);
    return () => mq.removeEventListener("change", onWide);
  }, [closeSidebar]);

  return (
    <div className="theme-abtalks-light theme-abtalks-brand ab-shell">
      <DashboardSidebar
        user={user}
        mobileOpen={sidebarOpen}
        onNavigate={closeSidebar}
        signedIn={isAuthed}
      />

      {sidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-label="Close menu"
          onClick={closeSidebar}
        />
      ) : null}

      <div className="ab-body">
        <header className="ab-header">
          <button
            className="ab-icon-btn ab-header__menu"
            type="button"
            aria-label="Open navigation"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          <div className="ab-header__right">
            <Link className="ab-header__link" href="/events">
              <svg viewBox="0 0 24 24" aria-hidden>
                <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
                <path d="M3.5 9.5h17M8 3.5V6M16 3.5V6" />
              </svg>
              <span>Discover events</span>
            </Link>
            {/* The real bell (was a static, click-dead SVG button, so no
                notification ever opened on /hackathon). Renders nothing for
                signed-out guests. */}
            {isAuthed ? <NotificationBellButton className="ab-icon-btn" /> : null}
            {headerCta}
          </div>
        </header>

        <main className="ab-content hk" id="ab-main">
          {children}
        </main>
      </div>
    </div>
  );
}
