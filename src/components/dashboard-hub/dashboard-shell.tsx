"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardHeader } from "./dashboard-header";
import { DashboardSidebar } from "./dashboard-sidebar";
import { DashboardFooter } from "./dashboard-footer";

export type DashboardShellUser = {
  name: string;
  email: string;
  image: string | null;
};

type DashboardShellProps = {
  user: DashboardShellUser;
  isAdmin: boolean;
  children: React.ReactNode;
};

export function DashboardShell({
  user,
  isAdmin,
  children,
}: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  useEffect(() => {
    if (!mobileOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeMobile();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, closeMobile]);

  return (
    <div className="flex min-h-svh bg-[#FBF9F7] font-content text-black">
      <DashboardSidebar
        user={user}
        mobileOpen={mobileOpen}
        onNavigate={closeMobile}
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
        />
        <div className="flex-1 overflow-x-hidden scroll-smooth">{children}</div>
        <DashboardFooter />
      </div>
    </div>
  );
}
