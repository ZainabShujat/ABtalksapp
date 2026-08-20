"use client";

import { useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { toast } from "sonner";
import type { Domain } from "@prisma/client";
import { getSubmissionsForExport } from "@/app/actions/admin-export-actions";
import { Button } from "@/components/ui/button";
import { downloadCSV, toCSV } from "@/lib/csv";
import { cn } from "@/lib/utils";

const domainOptions = ["ALL", "SE", "DS", "AI", "CLAUDE"] as const;
const statusOptions = ["ALL", "ON_TIME", "LATE"] as const;
const EXPORT_CAP = 10_000;

export function SubmissionsFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isExporting, startExport] = useTransition();

  const tab = searchParams.get("tab") ?? "feed";
  const isMissingTab = tab === "missing";

  const currentDomain = useMemo(
    () => searchParams.get("domain") ?? "ALL",
    [searchParams],
  );
  const currentStatus = useMemo(
    () => searchParams.get("status") ?? "ALL",
    [searchParams],
  );
  const minDay = searchParams.get("minDay") ?? "";
  const maxDay = searchParams.get("maxDay") ?? "";

  function pushWith(next: {
    domain?: string;
    status?: string;
    minDay?: string;
    maxDay?: string;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.domain !== undefined) {
      if (next.domain && next.domain !== "ALL") params.set("domain", next.domain);
      else params.delete("domain");
    }
    if (next.status !== undefined) {
      if (next.status && next.status !== "ALL") params.set("status", next.status);
      else params.delete("status");
    }
    if (next.minDay !== undefined) {
      if (next.minDay) params.set("minDay", next.minDay);
      else params.delete("minDay");
    }
    if (next.maxDay !== undefined) {
      if (next.maxDay) params.set("maxDay", next.maxDay);
      else params.delete("maxDay");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleExport(includeAll: boolean) {
    startExport(async () => {
      try {
        let data: Record<string, unknown>[];

        if (includeAll) {
          data = await getSubmissionsForExport({});
        } else {
          const domain =
            currentDomain === "ALL" ? "ALL" : (currentDomain as Domain);
          const status = currentStatus as "ALL" | "ON_TIME" | "LATE";
          data = await getSubmissionsForExport({
            domain,
            status,
            minDay: Number(minDay) || 1,
            maxDay: Number(maxDay) || 60,
          });
        }

        if (data.length === 0) {
          toast.error("No submissions to export");
          return;
        }

        const csv = toCSV(data);
        const date = new Date().toISOString().split("T")[0];
        const filename = `abtalks-submissions-${includeAll ? "all" : currentDomain}-${date}.csv`;
        downloadCSV(filename, csv);
        toast.success(`Exported ${data.length} submissions`);
        if (data.length >= EXPORT_CAP) {
          toast.warning(`Export capped at ${EXPORT_CAP} rows — apply filters`);
        }
      } catch {
        toast.error("Export failed");
      }
    });
  }

  return (
    <div className="sticky top-14 z-30 -mx-4 space-y-3 border-b bg-background/95 px-4 py-3 backdrop-blur md:relative md:top-auto md:z-auto md:mx-0 md:rounded-xl md:border md:px-3 md:backdrop-blur-none">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-wrap gap-2">
          {domainOptions.map((domain) => (
            <button
              key={domain}
              type="button"
              onClick={() => pushWith({ domain })}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                currentDomain === domain
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-accent",
              )}
            >
              {domain}
            </button>
          ))}
          {statusOptions.map((status) => (
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
              {status}
            </button>
          ))}
        </div>

        {!isMissingTab ? (
          <div className="flex flex-col gap-2 md:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleExport(false)}
              disabled={isExporting}
            >
              <Download className="mr-2 h-4 w-4" />
              Export filtered
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleExport(true)}
              disabled={isExporting}
            >
              <Download className="mr-2 h-4 w-4" />
              Export all
            </Button>
          </div>
        ) : null}
      </div>

      {!isMissingTab ? (
        <form
          className="flex flex-wrap items-center gap-2 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            pushWith({
              minDay: String(form.get("minDay") ?? ""),
              maxDay: String(form.get("maxDay") ?? ""),
            });
          }}
        >
          <label className="text-muted-foreground" htmlFor="minDay">
            Day from
          </label>
          <input
            id="minDay"
            name="minDay"
            type="number"
            min={1}
            max={60}
            defaultValue={minDay}
            className="h-8 w-20 rounded-md border px-2"
          />
          <label className="text-muted-foreground" htmlFor="maxDay">
            to
          </label>
          <input
            id="maxDay"
            name="maxDay"
            type="number"
            min={1}
            max={60}
            defaultValue={maxDay}
            className="h-8 w-20 rounded-md border px-2"
          />
          <button className="rounded-md border px-3 py-1.5">Apply</button>
        </form>
      ) : null}
    </div>
  );
}
