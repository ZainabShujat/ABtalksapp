"use client";

import { useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { toast } from "sonner";
import type { Domain } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DropoffStudentRow } from "@/features/admin/get-dropoff-by-day";
import { downloadCSV, toCSV } from "@/lib/csv";
import { cn } from "@/lib/utils";

type Props = {
  rows: DropoffStudentRow[];
  domain: Domain | "ALL";
};

const DOMAIN_OPTIONS: Array<{ value: Domain | "ALL"; label: string }> = [
  { value: "ALL", label: "All domains" },
  { value: "SE", label: "SE" },
  { value: "DS", label: "DS" },
  { value: "AI", label: "AI" },
  { value: "CLAUDE", label: "CLAUDE" },
];

function domainBadgeClass(domain: string): string {
  if (domain === "AI") return "border-domains-ai/50 bg-domains-ai-bg text-domains-ai";
  if (domain === "DS") return "border-domains-ds/50 bg-domains-ds-bg text-domains-ds";
  if (domain === "CLAUDE")
    return "border-orange-500/40 bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200";
  return "border-domains-se/50 bg-domains-se-bg text-domains-se";
}

function statusBadgeClass(status: string): string {
  if (status === "ACTIVE") return "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200";
  if (status === "ABANDONED") return "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200";
  return "bg-muted text-muted-foreground";
}

function isoToDateOnly(iso: string | null): string {
  if (!iso) return "—";
  return iso.split("T")[0] ?? "—";
}

export function DropoffStudentsView({ rows, domain }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isDownloading, startDownload] = useTransition();

  const VIEW_LIMIT = 10;
  const visibleRows = useMemo(() => rows.slice(0, VIEW_LIMIT), [rows]);

  const csvRows = useMemo(
    () =>
      rows.map((r) => ({
        "Full Name": r.fullName,
        Email: r.email,
        Phone: r.phone,
        "User Type": r.userType,
        College: r.college,
        Organization: r.organization,
        Domain: r.domain,
        Status: r.status,
        "Started At": isoToDateOnly(r.startedAtIso),
        "Last Submitted Day": r.lastSubmittedDay ?? "",
        "Last Submission Date": isoToDateOnly(r.lastSubmissionDateIso),
        "Days Inactive": r.daysInactive,
        "Current Day": r.currentDay,
      })),
    [rows],
  );

  function handleDomainChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "ALL") params.delete("dropoff_domain");
    else params.set("dropoff_domain", next);
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleDownload() {
    startDownload(() => {
      if (csvRows.length === 0) {
        toast.error("No drop-off students to export.");
        return;
      }
      const filename = `dropoff-students_${domain.toLowerCase()}_${new Date()
        .toISOString()
        .split("T")[0]}.csv`;
      const csv = toCSV(csvRows);
      downloadCSV(filename, csv);
      toast.success(`Exported ${csvRows.length} students`);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {DOMAIN_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleDomainChange(opt.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                domain === opt.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-accent/40",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {rows.length > VIEW_LIMIT
              ? `Showing ${VIEW_LIMIT} of ${rows.length} students`
              : `${rows.length} students`}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={isDownloading || rows.length === 0}
          >
            <Download className="size-4" />
            {isDownloading
              ? "Downloading…"
              : rows.length > VIEW_LIMIT
                ? `Download CSV (${rows.length})`
                : "Download CSV"}
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          No dropped-off students for the selected domain.
        </div>
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {visibleRows.map((r) => (
              <div key={r.enrollmentId} className="rounded-xl border bg-card p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{r.fullName}</p>
                  <Badge variant="outline" className={domainBadgeClass(r.domain)}>
                    {r.domain}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{r.email}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <Badge className={statusBadgeClass(r.status)}>{r.status}</Badge>
                  <span className="text-muted-foreground">
                    Last day:{" "}
                    <span className="font-medium text-foreground">
                      {r.lastSubmittedDay ?? "never"}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    Inactive:{" "}
                    <span className="font-medium text-foreground">
                      {r.daysInactive}d
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Last Day</TableHead>
                  <TableHead>Last Submission</TableHead>
                  <TableHead className="text-right">Days Inactive</TableHead>
                  <TableHead className="text-right">Current Day</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((r) => (
                  <TableRow key={r.enrollmentId}>
                    <TableCell>
                      <div className="font-medium">{r.fullName}</div>
                      <div className="text-xs text-muted-foreground">{r.email}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={domainBadgeClass(r.domain)}>
                        {r.domain}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={statusBadgeClass(r.status)}>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.lastSubmittedDay ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {isoToDateOnly(r.lastSubmissionDateIso)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.daysInactive}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.currentDay}
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
