"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardHeader, type HeaderSectionNavItem } from "./dashboard-header";
import { DashboardSidebar } from "./dashboard-sidebar";
import { DashboardFooter } from "./dashboard-footer";
import { cn } from "@/lib/utils";

const CLAUDE_SIDEBAR_COLLAPSED_KEY = "abtalks.claudeSidebarCollapsed";

export type DashboardShellUser = {
  name: string;
  email: string;
  image: string | null;
};

type DashboardShellProps = {
  user: DashboardShellUser;
  isAdmin: boolean;
  children: React.ReactNode;
  /** When true, desktop sidebar can collapse to icon-only (Claude routes). Default false. */
  collapsible?: boolean;
  /** Hide hub section anchors in the header. Default true. Ignored when sectionNavItems is set. */
  showSectionNav?: boolean;
  /** Custom header section links (Claude Days / FAQs / …). */
  sectionNavItems?: HeaderSectionNavItem[];
  /** Extra classes on the header/footer content pane. */
  contentClassName?: string;
};

export function DashboardShell({
  user,
  isAdmin,
  children,
  collapsible = false,
  showSectionNav = true,
  sectionNavItems,
  contentClassName,
}: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  useEffect(() => {
    if (!collapsible) return;
    try {
      setCollapsed(window.localStorage.getItem(CLAUDE_SIDEBAR_COLLAPSED_KEY) === "1");
    } catch {
      // ignore
    }
  }, [collapsible]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(
          CLAUDE_SIDEBAR_COLLAPSED_KEY,
          next ? "1" : "0",
        );
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeMobile();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, closeMobile]);

  return (
    <div className="theme-abtalks-light theme-abtalks-brand flex min-h-svh bg-[#F4F4F4] font-content text-black">
      <DashboardSidebar
        user={user}
        mobileOpen={mobileOpen}
        onNavigate={closeMobile}
        collapsible={collapsible}
        collapsed={collapsible ? collapsed : false}
        onToggleCollapse={collapsible ? toggleCollapsed : undefined}
      />

      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-label="Close menu"
          onClick={closeMobile}
        />
      ) : null}

      <div className="flex h-svh min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* The footer lives INSIDE the scroller. Outside it, the column is
            viewport-height and the footer sits below the fold forever — which
            is why it read as pinned in place. `min-h-full` keeps it at the
            bottom when a page is short, and lets it scroll into view when the
            page is long. */}
        <div
          className={cn(
            "abt-content-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto scroll-smooth",
            contentClassName,
          )}
        >
          {/* The header is sticky INSIDE the scroller so page content passes
              beneath it and the frosted glass has something to blur — the
              same treatment as the landing and workshop headers. */}
          <DashboardHeader
            isAdmin={isAdmin}
            menuOpen={mobileOpen}
            onMenuClick={() => setMobileOpen(true)}
            showSectionNav={showSectionNav}
            sectionNavItems={sectionNavItems}
          />
          <div className="flex min-h-[calc(100%-55px)] flex-col">
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
            <DashboardFooter />
          </div>
        </div>
      </div>
    </div>
  );
}
