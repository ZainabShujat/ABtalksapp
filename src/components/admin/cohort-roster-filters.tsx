"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { getCohortRosterForExport } from "@/app/actions/admin-export-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  CohortEnrollmentStatus,
  CohortStatusCounts,
} from "@/features/admin/get-cohorts";
import { downloadCSV, toCSV } from "@/lib/csv";
import { cn } from "@/lib/utils";

/**
 * Mirrors COHORT_STATUSES in get-cohorts.ts. Declared locally because that
 * module imports Prisma — a value import here would pull it into the client
 * bundle. The `satisfies` keeps the two in sync at build time.
 */
const statusOptions = [
  "APPLIED",
  "WAITLISTED",
  "ACTIVE",
  "COMPLETED",
  "DROPPED",
  "REMOVED",
] as const satisfies readonly CohortEnrollmentStatus[];

export function CohortRosterFilters({
  cohortId,
  cohortSlug,
  total,
  statusCounts,
}: {
  cohortId: string;
  cohortSlug: string;
  total: number;
  statusCounts: CohortStatusCounts;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [isExporting, startExport] = useTransition();

  const currentStatus = useMemo(
    () => searchParams.get("status") ?? "ALL",
    [searchParams],
  );

  function pushWith(next: { q?: string; status?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.q !== undefined) {
      if (next.q.trim()) params.set("q", next.q.trim());
      else params.delete("q");
    }
    if (next.status !== undefined) {
      if (next.status && next.status !== "ALL") params.set("status", next.status);
      else params.delete("status");
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function handleExport() {
    startExport(async () => {
      try {
        const data = await getCohortRosterForExport({
          cohortId,
          status: currentStatus,
          search: searchParams.get("q") ?? undefined,
        });

        if (data.length === 0) {
          toast.error("No enrollments to export");
          return;
        }

        const date = new Date().toISOString().split("T")[0];
        downloadCSV(`abtalks-cohort-${cohortSlug}-${date}.csv`, toCSV(data));
        toast.success(`Exported ${data.length} enrollments`);
      } catch {
        toast.error("Export failed");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <form
          className="flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            pushWith({ q: search });
          }}
        >
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this cohort by name or email"
            aria-label="Search cohort roster"
          />
        </form>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={isExporting}
          className="shrink-0"
        >
          <Download className="mr-2 h-4 w-4" />
          {isExporting ? "Exporting…" : "Export CSV"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => pushWith({ status: "ALL" })}
          className={cn(
            "rounded-full border px-3 py-1 text-xs",
            currentStatus === "ALL"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border hover:bg-accent",
          )}
        >
          All ({total})
        </button>
        {statusOptions.filter((status) => statusCounts[status] > 0).map(
          (status) => (
            <button
              key={status}
              type="button"
              onClick={() => pushWith({ status })}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                currentStatus === status
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-accent",
              )}
            >
              {status} ({statusCounts[status]})
            </button>
          ),
        )}
      </div>
    </div>
  );
}
