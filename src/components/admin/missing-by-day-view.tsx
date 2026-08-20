"use client";

import Link from "next/link";
import { useMemo, useTransition } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { toast } from "sonner";
import type { Domain } from "@prisma/client";
import { getMissingStudentsForExport } from "@/app/actions/admin-export-actions";
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
import type {
  MissingDaySummaryRow,
  MissingStudentRow,
} from "@/features/admin/get-missing-by-day";
import { downloadCSV, toCSV } from "@/lib/csv";
import { cn } from "@/lib/utils";

type Props =
  | { mode: "summary"; summary: MissingDaySummaryRow[] }
  | { mode: "drilldown"; day: number; students: MissingStudentRow[] };

function domainBadgeClass(domain: string): string {
  if (domain === "AI") return "border-domains-ai/50 bg-domains-ai-bg text-domains-ai";
  if (domain === "DS") return "border-domains-ds/50 bg-domains-ds-bg text-domains-ds";
  if (domain === "CLAUDE")
    return "border-orange-500/40 bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200";
  return "border-domains-se/50 bg-domains-se-bg text-domains-se";
}

function statusBadgeClass(status: string): string {
  if (status === "ACTIVE") return "bg-emerald-100 text-emerald-700";
  if (status === "COMPLETED") return "bg-violet-100 text-violet-700";
  return "bg-muted text-muted-foreground";
}

const EXPORT_CAP = 10_000;

export function MissingByDayView(props: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isExporting, startExport] = useTransition();

  const currentDomain = useMemo(
    () => searchParams.get("domain") ?? "ALL",
    [searchParams],
  );

  function hrefWithDay(day?: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "missing");
    if (day != null) params.set("day", String(day));
    else params.delete("day");
    return `${pathname}?${params.toString()}`;
  }

  if (props.mode === "summary") {
    return (
      <>
        <div className="space-y-2 md:hidden">
          {props.summary.map((row) => (
            <Link
              key={row.day}
              href={hrefWithDay(row.day)}
              className="block rounded-xl border bg-card p-3 text-sm transition-colors hover:bg-accent/30"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">Day {row.day}</span>
                <span className="text-xs text-muted-foreground">
                  {row.pctSubmitted}% submitted
                </span>
              </div>
              <div
                className="mt-2 h-1 overflow-hidden rounded-full bg-muted"
                aria-hidden
              >
                <div
                  className="h-1 bg-primary"
                  style={{ width: `${Math.min(100, row.pctSubmitted)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {row.submitted} submitted · {row.missing} missing · {row.totalEnrollments}{" "}
                enrolled
              </p>
            </Link>
          ))}
        </div>

        <div className="hidden overflow-x-auto rounded-xl border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>Total enrolled</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Missing</TableHead>
                <TableHead>% submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.summary.map((row) => (
                <TableRow key={row.day}>
                  <TableCell>
                    <Link href={hrefWithDay(row.day)} className="font-medium underline">
                      {row.day}
                    </Link>
                  </TableCell>
                  <TableCell>{row.totalEnrollments}</TableCell>
                  <TableCell>{row.submitted}</TableCell>
                  <TableCell>{row.missing}</TableCell>
                  <TableCell>
                    <div className="flex min-w-[8rem] items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-1 bg-primary"
                          style={{ width: `${Math.min(100, row.pctSubmitted)}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums">{row.pctSubmitted}%</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </>
    );
  }

  const { day, students } = props;

  function handleExportMissing() {
    startExport(async () => {
      try {
        const domain =
          currentDomain === "ALL" ? "ALL" : (currentDomain as Domain);
        const data = await getMissingStudentsForExport(day, { domain });

        if (data.length === 0) {
          toast.error("No students to export");
          return;
        }

        const csv = toCSV(data);
        const date = new Date().toISOString().split("T")[0];
        const filename = `abtalks-day${day}-missing-${currentDomain}-${date}.csv`;
        downloadCSV(filename, csv);
        toast.success(`Exported ${data.length} students`);
        if (data.length >= EXPORT_CAP) {
          toast.warning(`Export capped at ${EXPORT_CAP} rows — apply filters`);
        }
      } catch {
        toast.error("Export failed");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            Day {day} — Missing students ({students.length})
          </h2>
          <Link href={hrefWithDay()} className="text-sm text-primary underline">
            ← Back to all days
          </Link>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExportMissing}
          disabled={isExporting}
          className="shrink-0"
        >
          <Download className="mr-2 h-4 w-4" />
          {isExporting ? "Exporting…" : "Export missing (CSV)"}
        </Button>
      </div>

      <div className="space-y-2 md:hidden">
        {students.map((student) => (
          <article
            key={student.enrollmentId}
            className="rounded-xl border bg-card p-3 text-sm"
          >
            <header className="flex items-start justify-between gap-2">
              <Link
                href={`/admin/students/${student.userId}`}
                className="font-medium underline"
              >
                {student.studentName}
              </Link>
              <div className="flex shrink-0 gap-1">
                <Badge variant="outline" className={domainBadgeClass(student.domain)}>
                  {student.domain}
                </Badge>
                <Badge className={cn("border-0", statusBadgeClass(student.status))}>
                  {student.status}
                </Badge>
              </div>
            </header>
            <p className="mt-1 text-xs text-muted-foreground">{student.email}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Days completed: {student.daysCompleted} · Last submitted:{" "}
              {student.lastSubmittedDay ?? "—"}
            </p>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Days completed</TableHead>
              <TableHead>Last submitted day</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {students.map((student) => (
              <TableRow key={student.enrollmentId}>
                <TableCell>
                  <Link
                    href={`/admin/students/${student.userId}`}
                    className="font-medium underline"
                  >
                    {student.studentName}
                  </Link>
                </TableCell>
                <TableCell>{student.email}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={domainBadgeClass(student.domain)}>
                    {student.domain}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge className={cn("border-0", statusBadgeClass(student.status))}>
                    {student.status}
                  </Badge>
                </TableCell>
                <TableCell>{student.daysCompleted}</TableCell>
                <TableCell>{student.lastSubmittedDay ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
