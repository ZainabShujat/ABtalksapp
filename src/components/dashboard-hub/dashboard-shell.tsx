"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardHeader, type HeaderSectionNavItem } from "./dashboard-header";
import { DashboardSidebar } from "./dashboard-sidebar";
import { DashboardFooter } from "./dashboard-footer";

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
};

export function DashboardShell({
  user,
  isAdmin,
  children,
  collapsible = false,
  showSectionNav = true,
  sectionNavItems,
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
    <div className="theme-abtalks-light theme-abtalks-orange flex min-h-svh bg-[#FBF9F7] font-content text-black">
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

      <div className="flex min-h-svh min-w-0 flex-1 flex-col">
        <DashboardHeader
          isAdmin={isAdmin}
          menuOpen={mobileOpen}
          onMenuClick={() => setMobileOpen(true)}
          showSectionNav={showSectionNav}
          sectionNavItems={sectionNavItems}
        />
        <div className="flex-1 overflow-x-hidden scroll-smooth">{children}</div>
        <DashboardFooter />
      </div>
    </div>
  );
}
