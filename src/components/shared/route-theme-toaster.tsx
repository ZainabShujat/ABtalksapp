"use client";

import { usePathname } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";

function isLightOnlyRoute(pathname: string): boolean {
  return !(
    pathname === "/marketplace" ||
    pathname.startsWith("/marketplace/") ||
    pathname === "/hackathon" ||
    pathname.startsWith("/hackathon/")
  );
}

export function RouteThemeToaster() {
  const pathname = usePathname();

  return isLightOnlyRoute(pathname) ? <Toaster theme="light" /> : <Toaster />;
}
