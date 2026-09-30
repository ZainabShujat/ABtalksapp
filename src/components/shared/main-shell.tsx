"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { showsBottomNav } from "@/components/shared/bottom-nav-routes";

export function MainShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  /*
   * The padding is the nav's own answer, not a second opinion.
   *
   * This used to keep its own list of routes purely to reserve `pb-16` for
   * the fixed BottomNav, and the two lists drifted: 38 routes reserved 64px
   * for a bar that never rendered, and /assessments rendered the bar on top
   * of its side panel. Asking `showsBottomNav` means the space is reserved
   * exactly when something occupies it.
   */
  const reservesBottomNav = showsBottomNav(pathname);

  /** Drives the `landing-page` body class. Unrelated to the nav. */
  const isLanding = pathname === "/";

  useEffect(() => {
    document.body.classList.toggle("landing-page", isLanding);
    return () => document.body.classList.remove("landing-page");
  }, [isLanding]);

  // Design System v2 is light-only: every route, Marketplace and Hackathon
  // included, renders on the one forest-green light theme.
  return (
    <main
      className={cn(
        "theme-abtalks-light theme-abtalks-brand flex-1",
        reservesBottomNav && "pb-16 md:pb-0",
      )}
    >
      {children}
    </main>
  );
}
