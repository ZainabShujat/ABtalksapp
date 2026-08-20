"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { getStudentsForExport } from "@/app/actions/admin-export-actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { downloadCSV, toCSV } from "@/lib/csv";
import type {
  StudentDomainCounts,
  StudentTrack,
  StudentTrackCounts,
} from "@/features/admin/get-students";
import { cn } from "@/lib/utils";
import type { Domain } from "@prisma/client";

const trackOptions = ["ALL", "CHALLENGE", "HACKATHON"] as const;
const domainOptions = ["ALL", "SE", "DS", "AI", "CLAUDE"] as const;
const statusOptions = ["ALL", "ACTIVE", "COMPLETED"] as const;
const sortOptions = [
  { value: "recent", label: "Recently joined" },
  { value: "days", label: "Days completed" },
  { value: "streak", label: "Current streak" },
  { value: "referrals", label: "Referrals" },
] as const;

function trackLabel(track: (typeof trackOptions)[number]): string {
  if (track === "CHALLENGE") return "Challenge";
  if (track === "HACKATHON") return "Hackathon";
  return "All";
}

export function StudentsFilters({
  domainCounts,
  trackCounts,
}: {
  domainCounts: StudentDomainCounts;
  trackCounts: StudentTrackCounts;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isExporting, startExport] = useTransition();

  const currentTrack = useMemo(
    () => (searchParams.get("track") as StudentTrack | null) ?? "ALL",
    [searchParams],
  );
  const currentDomain = useMemo(
    () => searchParams.get("domain") ?? "ALL",
    [searchParams],
  );
  const currentStatus = useMemo(
    () => searchParams.get("status") ?? "ALL",
    [searchParams],
  );
  const currentSort = useMemo(
    () => searchParams.get("sort") ?? "recent",
    [searchParams],
  );

  const hackathonOnly = currentTrack === "HACKATHON";

  function pushWith(next: {
    q?: string;
    track?: string;
    domain?: string;
    status?: string;
    sort?: string;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.q !== undefined) {
      if (next.q.trim()) params.set("q", next.q.trim());
      else params.delete("q");
    }
    if (next.track !== undefined) {
      if (next.track && next.track !== "ALL") params.set("track", next.track);
      else params.delete("track");
    }
    if (next.domain !== undefined) {
      if (next.domain && next.domain !== "ALL") params.set("domain", next.domain);
      else params.delete("domain");
    }
    if (next.status !== undefined) {
      if (next.status && next.status !== "ALL") params.set("status", next.status);
      else params.delete("status");
    }
    if (next.sort !== undefined) {
      if (next.sort && next.sort !== "recent") params.set("sort", next.sort);
      else params.delete("sort");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function domainCountLabel(domain: (typeof domainOptions)[number]) {
    const count = domainCounts[domain];
    return count > 0 ? `${domain} (${count})` : domain;
  }

  function trackCountLabel(track: (typeof trackOptions)[number]) {
    const count = trackCounts[track];
    const label = trackLabel(track);
    return count > 0 ? `${label} (${count})` : label;
  }

  function handleClearFilters() {
    pushWith({
      track: "ALL",
      domain: "ALL",
      status: "ALL",
      sort: "recent",
    });
  }

  function handleTrackSelect(track: (typeof trackOptions)[number]) {
    if (track === "HACKATHON") {
      pushWith({ track: "HACKATHON", domain: "ALL", status: "ALL" });
      return;
    }
    pushWith({ track });
  }

  function handleExport() {
    startExport(async () => {
      try {
        const domain =
          currentDomain === "ALL" ? "ALL" : (currentDomain as Domain);
        const track =
          currentTrack === "ALL" ||
          currentTrack === "CHALLENGE" ||
          currentTrack === "HACKATHON"
            ? currentTrack
            : "ALL";
        const data = await getStudentsForExport({
          domain,
          search: searchParams.get("q") ?? undefined,
          track,
        });

        if (data.length === 0) {
          toast.error("No students to export");
          return;
        }

        const csv = toCSV(data);
        const date = new Date().toISOString().split("T")[0];
        const filename = `abtalks-students-${track}-${date}.csv`;
        downloadCSV(filename, csv);
        toast.success(`Exported ${data.length} students`);
      } catch {
        toast.error("Export failed");
      }
    });
  }

  const activeFilterCount =
    (currentTrack !== "ALL" ? 1 : 0) +
    (currentDomain !== "ALL" ? 1 : 0) +
    (currentStatus !== "ALL" ? 1 : 0) +
    (currentSort !== "recent" ? 1 : 0);

  return (
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
          placeholder="Search by full name or email"
          aria-label="Search students"
        />
      </form>

      <div className="flex shrink-0 items-center gap-2">
        <DropdownMenu open={filtersOpen} onOpenChange={setFiltersOpen}>
          <DropdownMenuTrigger
            type="button"
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent",
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 ? (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
                {activeFilterCount}
              </span>
            ) : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">Filters</span>
              <button
                type="button"
                onClick={handleClearFilters}
                className="text-xs text-primary hover:underline"
              >
                Clear
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Track
                </p>
                <div className="flex flex-wrap gap-2">
                  {trackOptions.map((track) => (
                    <button
                      key={track}
                      type="button"
                      onClick={() => handleTrackSelect(track)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs",
                        currentTrack === track
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-accent",
                      )}
                    >
                      {trackCountLabel(track)}
                    </button>
                  ))}
                </div>
              </div>

              {!hackathonOnly ? (
                <>
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Domain
                    </p>
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
                          {domainCountLabel(domain)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Status
                    </p>
                    <div className="flex flex-wrap gap-2">
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
                  </div>
                </>
              ) : null}

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Sort / Time
                </p>
                <div className="flex flex-col gap-1">
                  {sortOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => pushWith({ sort: option.value })}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-left text-xs",
                        currentSort === option.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-transparent hover:bg-accent",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Button
              type="button"
              size="sm"
              className="mt-4 w-full"
              onClick={() => setFiltersOpen(false)}
            >
              Apply
            </Button>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={isExporting}
        >
          <Download className="mr-2 h-4 w-4" />
          {isExporting ? "Exporting…" : "Export CSV"}
        </Button>
      </div>
    </div>
  );
}
