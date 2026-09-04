"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function MainShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMarketplace =
    pathname === "/marketplace" || pathname.startsWith("/marketplace/");
  const isHackathon =
    pathname === "/hackathon" || pathname.startsWith("/hackathon/");
  const isDashboardShellRoute =
    pathname === "/dashboard" || pathname === "/profile";
  const isLanding = pathname === "/";
  /**
   * `pb-16` below reserves room for the fixed mobile BottomNav. That component
   * returns null on /workshop (see its own hide list), so on this route the
   * padding was 64px of blank page under the footer and nothing else.
   */
  const isWorkshop =
    pathname === "/workshop" || pathname.startsWith("/workshop/");
  const isLightOnlyRoute = !isMarketplace && !isHackathon;

  useEffect(() => {
    document.body.classList.toggle("marketplace-page", isMarketplace);
    return () => document.body.classList.remove("marketplace-page");
  }, [isMarketplace]);

  useEffect(() => {
    document.body.classList.toggle("landing-page", isLanding);
    return () => document.body.classList.remove("landing-page");
  }, [isLanding]);

  return (
    <main
      className={cn(
        "flex-1",
        isLightOnlyRoute && "theme-abtalks-light theme-abtalks-orange",
        !isHackathon && !isDashboardShellRoute && !isWorkshop && "pb-16 md:pb-0",
        isMarketplace && "bg-[#030712]",
        isHackathon && "bg-black",
      )}
    >
      {children}
    </main>
  );
}
