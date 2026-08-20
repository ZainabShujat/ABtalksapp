"use client";

import { useMemo, useState } from "react";
import { Download, ExternalLink, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { downloadCSV, toCSV } from "@/lib/csv";
import { formatDateIST } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type {
  CohortApplicationRow,
  CohortRegion,
} from "@/lib/workshop-supabase";

function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "accepted" || s === "approved")
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400";
  if (s === "rejected")
    return "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400";
  if (s === "reviewed" || s === "shortlisted")
    return "bg-violet-100 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400";
  return "bg-muted text-muted-foreground";
}

function regionValue(row: CohortApplicationRow, region: CohortRegion): string {
  if (region === "india") return row.originated_in_india ? "India" : "—";
  return row.visa_category ?? "—";
}

function uniqueValues(rows: CohortApplicationRow[], key: keyof CohortApplicationRow) {
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[key];
    if (typeof v === "string" && v.trim()) set.add(v);
  }
  return Array.from(set);
}

export function CohortApplicationsView({
  rows,
  region,
}: {
  rows: CohortApplicationRow[];
  region: CohortRegion;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [experience, setExperience] = useState("ALL");
  const [role, setRole] = useState("ALL");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const regionColLabel = region === "india" ? "Origin" : "Visa";

  const statusOptions = useMemo(() => uniqueValues(rows, "status"), [rows]);
  const experienceOptions = useMemo(
    () => uniqueValues(rows, "total_experience"),
    [rows],
  );
  const roleOptions = useMemo(() => uniqueValues(rows, "target_role"), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "ALL" && r.status !== status) return false;
      if (experience !== "ALL" && r.total_experience !== experience) return false;
      if (role !== "ALL" && r.target_role !== role) return false;
      if (q) {
        const name = `${r.first_name} ${r.last_name}`.toLowerCase();
        if (!name.includes(q) && !r.email.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, status, experience, role]);

  const activeFilterCount =
    (status !== "ALL" ? 1 : 0) +
    (experience !== "ALL" ? 1 : 0) +
    (role !== "ALL" ? 1 : 0);

  function clearFilters() {
    setStatus("ALL");
    setExperience("ALL");
    setRole("ALL");
  }

  function handleExport() {
    if (filtered.length === 0) {
      toast.error("No applications to export");
      return;
    }
    const csv = toCSV(filtered as unknown as Record<string, unknown>[]);
    const date = new Date().toISOString().split("T")[0];
    downloadCSV(`abtalks-cohort-${region}-${date}.csv`, csv);
    toast.success(`Exported ${filtered.length} applications`);
  }

  return (
    <div className="space-y-4">
      {/* search + filters + export */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by full name or email"
            aria-label="Search applications"
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <DropdownMenu open={filtersOpen} onOpenChange={setFiltersOpen}>
            <DropdownMenuTrigger
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent"
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
                  onClick={clearFilters}
                  className="text-xs text-primary hover:underline"
                >
                  Clear
                </button>
              </div>

              <div className="space-y-4">
                <FilterGroup
                  label="Status"
                  options={statusOptions}
                  value={status}
                  onSelect={setStatus}
                />
                <FilterGroup
                  label="Experience"
                  options={experienceOptions}
                  value={experience}
                  onSelect={setExperience}
                />
                <FilterGroup
                  label="Target role"
                  options={roleOptions}
                  value={role}
                  onSelect={setRole}
                />
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
          >
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {rows.length}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground shadow-[var(--shadow-card)]">
          No applications match your filters.
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filtered.map((row) => (
              <article
                key={row.id}
                className="rounded-xl border bg-card p-3 text-sm shadow-[var(--shadow-card)]"
              >
                <header className="flex items-start justify-between gap-2">
                  <span className="font-medium">
                    {row.first_name} {row.last_name}
                  </span>
                  <Badge className={cn("border-0", statusBadgeClass(row.status))}>
                    {row.status}
                  </Badge>
                </header>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {row.email}
                </p>
                <p className="mt-2 text-xs">
                  {row.total_experience} · {row.target_role}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {regionColLabel}: {regionValue(row, region)}
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <a
                    href={row.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                  >
                    LinkedIn
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                  <span className="text-xs text-muted-foreground">
                    {formatDateIST(new Date(row.created_at))}
                  </span>
                </div>
              </article>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-xl border bg-card shadow-[var(--shadow-card)] md:block">
            <Table className="w-full">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {[
                    "Name",
                    "Email",
                    "LinkedIn",
                    "Experience",
                    "AI/ML",
                    "Target Role",
                    regionColLabel,
                    "Status",
                    "Applied",
                  ].map((h) => (
                    <TableHead
                      key={h}
                      className="text-xs uppercase tracking-wide text-muted-foreground"
                    >
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.id} className="hover:bg-accent/40">
                    <TableCell className="max-w-[13rem]">
                      <div className="truncate font-medium">
                        {row.first_name} {row.last_name}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.current_title_company}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate text-sm">
                      {row.email}
                    </TableCell>
                    <TableCell className="pr-8">
                      <a
                        href={row.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                      >
                        Profile
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {row.total_experience}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {row.ai_ml_experience}
                    </TableCell>
                    <TableCell className="max-w-[11rem] truncate text-sm">
                      {row.target_role}
                    </TableCell>
                    <TableCell className="max-w-[9rem] truncate text-sm">
                      {regionValue(row, region)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn("border-0", statusBadgeClass(row.status))}
                      >
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {formatDateIST(new Date(row.created_at))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

function FilterGroup({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: string[];
  value: string;
  onSelect: (v: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {["ALL", ...options].map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onSelect(opt)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              value === opt
                ? "border-primary bg-primary/10 text-primary"
                : "border-border hover:bg-accent",
            )}
          >
            {opt === "ALL" ? "All" : opt}
          </button>
        ))}
      </div>
    </div>
  );
}
