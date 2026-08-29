"use client";

import { type ReactNode, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Collapsible section card shared by every track's day page. */
export function DaySection({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  /**
   * A rendered element, not a component reference — server components render
   * this card, and a function prop cannot cross the RSC boundary.
   */
  icon: ReactNode;
  /** The primary section (the task itself) opens on load. */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <section className="overflow-hidden rounded-[12px] border border-[#E0E0E0] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      <h2>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-[#FBF9F7] focus-visible:ring-2 focus-visible:ring-[#E05226] focus-visible:ring-inset md:px-5 md:py-5"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#FFECE3] [&_svg]:size-4 [&_svg]:text-[#E05226]">
              {icon}
            </span>
            <span className="font-heading text-base font-semibold text-[#111111] md:text-lg">
              {title}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "size-5 shrink-0 text-[#8F8F8F] transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </h2>
      {open ? (
        <div
          id={panelId}
          className="border-t border-[#E0E0E0] px-4 py-4 md:px-5 md:py-5"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}
