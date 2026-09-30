import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { CohortRosterFilters } from "@/components/admin/cohort-roster-filters";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  COHORT_STATUSES,
  getCohortDetail,
  type CohortEnrollmentStatus,
} from "@/features/admin/get-cohorts";
import { cn } from "@/lib/utils";

function isCohortStatus(value: string | undefined): value is CohortEnrollmentStatus {
  return (
    value !== undefined &&
    (COHORT_STATUSES as readonly string[]).includes(value)
  );
}

function statusBadgeClass(status: string): string {
  if (status === "ACTIVE")
    return "bg-[#D6F7EC] text-[#197E23] dark:bg-[#18D39B]/10 dark:text-[#197E23]";
  if (status === "COMPLETED") return "bg-[#E7F2F3] text-[#076573]";
  return "bg-muted text-muted-foreground";
}

export default async function AdminCohortDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ cohortId: string }>;
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const [{ cohortId }, sp] = await Promise.all([params, searchParams]);
  await requireAdmin();

  const status = isCohortStatus(sp.status) ? sp.status : "ALL";
  const detail = await getCohortDetail({
    cohortId,
    search: sp.q,
    status,
  });
  if (!detail) notFound();

  const maxMonth = detail.monthly.reduce((max, m) => Math.max(max, m.count), 0);
  const startLine =
    detail.cohort.startMode === "ROLLING"
      ? `Rolling start · ${detail.cohort.timezone}`
      : `Starts ${detail.cohort.startsAtLabel ?? "—"} · ${detail.cohort.timezone}`;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/cohorts"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All cohorts
      </Link>

      <AdminPageHeader
        title={detail.cohort.name}
        description={`${detail.cohort.programTitle} · ${detail.total} enrolled · ${startLine}${
          detail.cohort.capacity ? ` · capacity ${detail.cohort.capacity}` : ""
        }`}
        actions={
          <>
            <Badge variant="outline">{detail.cohort.programFormat}</Badge>
            <Badge variant="outline">{detail.cohort.status}</Badge>
          </>
        }
      />

      {detail.monthly.length > 0 ? (
        <section className="rounded-xl border bg-card p-5 shadow-[var(--shadow-card)]">
          <h2 className="font-display text-sm font-semibold text-[#353535]">
            Joins by month
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            When candidates actually joined this cohort.
          </p>
          <ul className="mt-4 space-y-2">
            {detail.monthly.map((bucket) => (
              <li key={bucket.key} className="flex items-center gap-3 text-sm">
                <span className="w-20 shrink-0 text-xs text-muted-foreground">
                  {bucket.label}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-[#03535F]"
                    style={{
                      width: `${maxMonth > 0 ? (bucket.count / maxMonth) * 100 : 0}%`,
                    }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right text-xs tabular-nums">
                  {bucket.count}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <CohortRosterFilters
        cohortId={detail.cohort.id}
        cohortSlug={detail.cohort.slug}
        total={detail.total}
        statusCounts={detail.statusCounts}
      />

      {detail.truncated ? (
        <p className="text-xs text-muted-foreground">
          Showing the {detail.rows.length} most recent joins. Export the CSV for
          the full roster.
        </p>
      ) : null}

      {detail.rows.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          No enrollments match these filters.
        </p>
      ) : null}

      {/* Mobile */}
      <div className="space-y-2 md:hidden">
        {detail.rows.map((row) => (
          <article
            key={row.enrollmentId}
            className="rounded-xl border bg-card p-3 text-sm shadow-[var(--shadow-card)]"
          >
            <Link
              href={`/admin/students/${row.userId}`}
              className="font-medium underline"
            >
              {row.fullName}
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">{row.email}</p>
            <p className="mt-2 text-xs">
              Joined {row.joinedAtLabel} · {row.completedActivities}/
              {row.totalActivities} done · {row.currentStreak}d streak
            </p>
            <div className="mt-2">
              <Badge className={cn("border-0", statusBadgeClass(row.status))}>
                {row.status}
              </Badge>
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
                Candidate
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Status
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Joined
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Progress
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Streak
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Repo
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.rows.map((row) => (
              <TableRow key={row.enrollmentId} className="hover:bg-accent/40">
                <TableCell>
                  <Link
                    href={`/admin/students/${row.userId}`}
                    className="font-medium underline"
                  >
                    {row.fullName}
                  </Link>
                  <p className="text-xs text-muted-foreground">{row.email}</p>
                </TableCell>
                <TableCell>
                  <Badge
                    className={cn("border-0", statusBadgeClass(row.status))}
                  >
                    {row.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{row.joinedAtLabel}</TableCell>
                <TableCell className="text-sm tabular-nums">
                  {row.completedActivities}/{row.totalActivities}
                </TableCell>
                <TableCell className="text-sm tabular-nums">
                  {row.currentStreak}
                </TableCell>
                <TableCell className="max-w-[12rem] truncate text-sm">
                  {row.githubRepoUrl ? (
                    <a
                      href={row.githubRepoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      {row.githubRepoUrl.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
