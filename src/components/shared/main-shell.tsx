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

  useEffect(() => {
    document.body.classList.toggle("marketplace-page", isMarketplace);
    return () => document.body.classList.remove("marketplace-page");
  }, [isMarketplace]);

  return (
    <main
      className={cn(
        "flex-1",
        !isHackathon && "pb-16 md:pb-0",
        isMarketplace && "bg-[#030712]",
        isHackathon && "bg-black",
      )}
    >
      {children}
    </main>
  );
}
