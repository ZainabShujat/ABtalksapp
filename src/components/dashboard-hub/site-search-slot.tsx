"use client";

import { useSiteSearch } from "@/components/dashboard-hub/site-search-host";
import { DashboardSearch } from "@/components/dashboard-hub/dashboard-search";
import { cn } from "@/lib/utils";

type SiteSearchSlotProps = {
  className?: string;
};

/**
 * In-flow desktop search mount point.
 * Place immediately before the notification bell when one exists:
 * [...tabs/actions] → Search → Notification → [trailing CTAs].
 * With no bell: [...tabs] → Search → [Synergy / account / CTA].
 */
export function SiteSearchSlot({ className }: SiteSearchSlotProps) {
  const search = useSiteSearch();

  if (!search?.enabled || !search.items) return null;

  return (
    <div className={cn("hidden shrink-0 md:block", className)}>
      <DashboardSearch items={search.items} />
    </div>
  );
}
