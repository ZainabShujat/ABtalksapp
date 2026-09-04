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
      className="-mx-1 flex gap-5 overflow-x-auto px-1"
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
            /* Text tabs, not pills. A row of outlined capsules above a list of
               outlined cards is the same shape twice; an underline says which
               search you are looking at without adding another container. */
            className={cn(
              "shrink-0 border-b-2 px-1 pb-1.5 pt-1 text-sm",
              "transition-colors duration-150 ease-out",
              "focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none",
              selected
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label || `Search ${i + 1}`}
          </button>
        );
      })}
    </div>
  );
}
