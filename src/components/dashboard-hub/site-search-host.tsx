"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import type { HubSearchItem } from "@/features/dashboard/hub-search-index";

function isHirePath(pathname: string): boolean {
  return pathname === "/hire" || pathname.startsWith("/hire/");
}

type SiteSearchContextValue = {
  items: HubSearchItem[];
  enabled: boolean;
};

const SiteSearchContext = createContext<SiteSearchContextValue | null>(null);

export function useSiteSearch(): SiteSearchContextValue | null {
  return useContext(SiteSearchContext);
}

type SiteSearchProviderProps = {
  items: HubSearchItem[];
  children: ReactNode;
};

/**
 * Supplies the search catalog to header slots (in-flow only).
 * No fixed fallback — slot-less pages simply omit search.
 * Hidden on `/hire` and below `md` (slot CSS).
 */
export function SiteSearchProvider({ items, children }: SiteSearchProviderProps) {
  const pathname = usePathname();
  const enabled = !isHirePath(pathname);

  const value = useMemo(
    () => ({ items, enabled }),
    [items, enabled],
  );

  useEffect(() => {
    if (!enabled) return;
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const el = document.getElementById(hash);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [enabled, pathname]);

  return (
    <SiteSearchContext.Provider value={value}>
      {children}
    </SiteSearchContext.Provider>
  );
}
