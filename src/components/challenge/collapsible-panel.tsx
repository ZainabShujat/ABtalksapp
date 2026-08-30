"use client";

import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  title: string;
  icon: LucideIcon;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
};

export function CollapsiblePanel({
  id,
  title,
  icon: Icon,
  open,
  onOpenChange,
  children,
  className,
}: Props) {
  const panelId = `${id}-panel`;

  return (
    <div
      id={id}
      className={cn(
        "scroll-mt-24 rounded-[12px] border border-[#E0E0E0] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]",
        className,
      )}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left focus-visible:ring-2 focus-visible:ring-[#E05226] focus-visible:ring-offset-4 focus-visible:outline-none"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
      >
        <span className="flex items-center gap-2.5">
          <Icon className="size-5 text-[#111111]" aria-hidden />
          <span className="font-heading text-xl leading-[26px] font-semibold text-[#111111]">
            {title}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-5 text-[#8F8F8F] transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div id={panelId} className="border-t border-[#E0E0E0] px-6 py-6">
          {children}
        </div>
      ) : null}
    </div>
  );
}
