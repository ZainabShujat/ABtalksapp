import Link from "next/link";
import { CalendarClock, GraduationCap, UserPlus, Users } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { StatCard } from "@/components/admin/stat-card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCohortIndex } from "@/features/admin/get-cohorts";
import { cn } from "@/lib/utils";

function cohortStatusClass(status: string): string {
  if (status === "ACTIVE")
    return "bg-[#D6F7EC] text-[#197E23] dark:bg-[#18D39B]/10 dark:text-[#197E23]";
  if (status === "ENROLLING")
    return "bg-[#E7F2F3] text-[#03535F] dark:bg-[#03535F]/10 dark:text-[#076573]";
  return "bg-muted text-muted-foreground";
}

export default async function AdminCohortsPage() {
  const [, data] = await Promise.all([requireAdmin(), getCohortIndex()]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Cohorts"
        description={`${data.totals.cohorts} cohorts · ${data.totals.enrollments} enrollments across every track. Join dates come from the enrollment, not the account.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Cohorts"
          value={data.totals.cohorts}
          accent="blue"
          icon={<GraduationCap className="h-4 w-4" />}
        />
        <StatCard
          label="Total Enrollments"
          value={data.totals.enrollments}
          accent="green"
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Active Enrollments"
          value={data.totals.active}
          accent="green"
          icon={<UserPlus className="h-4 w-4" />}
        />
        <StatCard
          label="Joined (30 days)"
          value={data.totals.joinedLast30}
          accent="orange"
          icon={<CalendarClock className="h-4 w-4" />}
        />
      </div>

      {data.rows.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          No cohorts exist yet.
        </p>
      ) : null}

      {/* Mobile */}
      <div className="space-y-2 md:hidden">
        {data.rows.map((cohort) => (
          <article
            key={cohort.id}
            className="rounded-xl border bg-card p-3 text-sm shadow-[var(--shadow-card)]"
          >
            <header className="flex items-start justify-between gap-2">
              <Link
                href={`/admin/cohorts/${cohort.id}`}
                className="font-medium underline"
              >
                {cohort.name}
              </Link>
              <Badge variant="outline">{cohort.programFormat}</Badge>
            </header>
            <p className="mt-1 text-xs text-muted-foreground">
              {cohort.programTitle}
            </p>
            <p className="mt-2 text-xs">
              {cohort.total} enrolled · {cohort.byStatus.ACTIVE} active ·{" "}
              {cohort.byStatus.COMPLETED} completed
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {cohort.firstJoinedLabel
                ? `Joins ${cohort.firstJoinedLabel} → ${cohort.lastJoinedLabel}`
                : "No enrollments yet"}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge
                className={cn("border-0", cohortStatusClass(cohort.status))}
              >
                {cohort.status}
              </Badge>
              <Badge variant="outline">{cohort.startMode}</Badge>
              <span className="text-xs text-muted-foreground">
                {cohort.joinedLast30} in last 30d
              </span>
            </div>
          </article>
        ))}
      </div>

      {/* Desktop */}
      <div className="hidden overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-card)] md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Cohort
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Format
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Status
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Start
              </TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground">
                Enrolled
              </TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground">
                Active
              </TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground">
                Completed
              </TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground">
                Last 30d
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                First join
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Latest join
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((cohort) => (
              <TableRow key={cohort.id} className="hover:bg-accent/40">
                <TableCell className="max-w-[18rem]">
                  <Link
                    href={`/admin/cohorts/${cohort.id}`}
                    className="font-medium underline"
                  >
                    {cohort.name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {cohort.programTitle}
                  </p>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{cohort.programFormat}</Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    className={cn("border-0", cohortStatusClass(cohort.status))}
                  >
                    {cohort.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {cohort.startsAtLabel ?? (
                    <span className="text-muted-foreground">
                      {cohort.startMode === "ROLLING" ? "Rolling" : "—"}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {cohort.total}
                </TableCell>
                <TableCell className="text-right">
                  {cohort.byStatus.ACTIVE}
                </TableCell>
                <TableCell className="text-right">
                  {cohort.byStatus.COMPLETED}
                </TableCell>
                <TableCell className="text-right">
                  {cohort.joinedLast30}
                </TableCell>
                <TableCell className="text-sm">
                  {cohort.firstJoinedLabel ?? "—"}
                </TableCell>
                <TableCell className="text-sm">
                  {cohort.lastJoinedLabel ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
