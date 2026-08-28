"use client";

import { usePathname } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";

function isFixedLightRoute(pathname: string): boolean {
  if (
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/dashboard" ||
    pathname === "/claude" ||
    pathname.startsWith("/claude/day/") ||
    pathname.startsWith("/r/") ||
    pathname.startsWith("/program/day/")
  ) {
    return true;
  }

  return [
    "/program/dashboard",
    "/program/curriculum",
    "/program/interview",
    "/program/leaderboard",
    "/program/videos",
  ].includes(pathname);
}

export function RouteThemeToaster() {
  const pathname = usePathname();

  return isFixedLightRoute(pathname) ? <Toaster theme="light" /> : <Toaster />;
}
