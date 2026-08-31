"use client";

import { useId, useState, type ReactNode } from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import { AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  description?: string;
  /** Drives the header icon only. Never a permission or a gate. */
  complete: boolean;
  /** Shown next to the title when incomplete. */
  hint?: string | null;
  defaultOpen?: boolean;
  /** Right-aligned summary when collapsed, e.g. "3 roles". */
  summary?: string | null;
  children: ReactNode;
};

/**
 * One collapsible section of the detailed profile.
 *
 * The status icon reports completeness and nothing else — it is guidance for
 * the candidate, not a signal that anything is locked or hidden.
 */
export function ProfileSection({
  title,
  description,
  complete,
  hint,
  defaultOpen = false,
  summary,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const headingId = useId();

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className="rounded-2xl border bg-card text-card-foreground shadow-sm"
    >
      <Collapsible.Trigger
        className={cn(
          "flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left transition-colors outline-none sm:px-6",
          "hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-primary/30",
        )}
      >
        {complete ? (
          <CheckCircle2
            className="size-5 shrink-0 text-emerald-500"
            aria-hidden
          />
        ) : (
          <AlertTriangle
            className="size-5 shrink-0 text-amber-500"
            aria-hidden
          />
        )}

        <span className="min-w-0 flex-1">
          <span
            id={headingId}
            className="block font-display text-base font-semibold tracking-tight"
          >
            {title}
          </span>
          {!open && (summary || (!complete && hint)) ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {summary ?? hint}
            </span>
          ) : null}
          {open && description ? (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {description}
            </span>
          ) : null}
        </span>

        <span className="sr-only">{complete ? "Complete" : "Incomplete"}</span>
        <ChevronDown
          className={cn(
            "size-5 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </Collapsible.Trigger>

      <Collapsible.Panel
        className={cn(
          "overflow-hidden transition-[height] duration-200 ease-out",
          "h-[var(--collapsible-panel-height)] data-[starting-style]:h-0 data-[ending-style]:h-0",
        )}
      >
        <div className="border-t px-4 py-5 sm:px-6">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
