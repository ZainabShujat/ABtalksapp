"use client";

import type { GuestSearchTab } from "@/components/hire/guest-matches-store";
import { cn } from "@/lib/utils";

export function SearchTabs({
  tabs,
  activeId,
  onSelect,
}: {
  tabs: GuestSearchTab[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  if (tabs.length < 2) return null;

  return (
    <div
      role="tablist"
      aria-label="Searches"
      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
    >
      {tabs.map((tab, i) => {
        const selected = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.id)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium",
              "transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none",
              selected
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {tab.label || `Search ${i + 1}`}
          </button>
        );
      })}
    </div>
  );
}
