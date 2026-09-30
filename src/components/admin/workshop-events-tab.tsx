"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  EMPTY_WORKSHOP,
  WorkshopEventForm,
  type WorkshopFormValues,
} from "@/components/admin/workshop-event-form";
import {
  WorkshopEventsTable,
  type AdminWorkshopRow,
} from "@/components/admin/workshop-events-table";

/**
 * The Events tab. Plan 163 phase 2.
 *
 * Owns only which of the three views is showing — list, create, or edit. The
 * server page supplies the rows and the editable values; this holds no copy of
 * the data, so `router.refresh()` after a mutation is enough to bring the list
 * back in step.
 */
export function WorkshopEventsTab({
  rows,
  editable,
}: {
  rows: AdminWorkshopRow[];
  /** Full form values per id, so Edit opens without another round trip. */
  editable: Record<string, WorkshopFormValues>;
}) {
  const [mode, setMode] = useState<
    { kind: "list" } | { kind: "create" } | { kind: "edit"; id: string }
  >({ kind: "list" });

  if (mode.kind === "create") {
    return (
      <WorkshopEventForm
        initial={EMPTY_WORKSHOP}
        onDone={() => setMode({ kind: "list" })}
      />
    );
  }

  if (mode.kind === "edit") {
    const initial = editable[mode.id];
    if (!initial) {
      // The row went away under us — a delete in another tab, most likely.
      setMode({ kind: "list" });
      return null;
    }
    return (
      <WorkshopEventForm
        initial={initial}
        onDone={() => setMode({ kind: "list" })}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Every workshop, including archived ones and their registrations.
          Publishing puts one on the public page with no deploy.
        </p>
        <Button type="button" onClick={() => setMode({ kind: "create" })}>
          New workshop
        </Button>
      </div>

      <WorkshopEventsTable
        rows={rows}
        onEdit={(id) => setMode({ kind: "edit", id })}
      />
    </div>
  );
}
