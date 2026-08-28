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
  const isDashboard = pathname === "/dashboard";
  const isLanding = pathname === "/";
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
        isLightOnlyRoute && "theme-abtalks-light",
        !isHackathon && !isDashboard && "pb-16 md:pb-0",
        isMarketplace && "bg-[#030712]",
        isHackathon && "bg-black",
      )}
    >
      {children}
    </main>
  );
}
