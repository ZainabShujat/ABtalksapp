import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StudentsFilters } from "@/components/admin/students-filters";
import { formatDateIST } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import {
  getStudentDomainCounts,
  getStudents,
  getStudentTrackCounts,
  type StudentTrack,
} from "@/features/admin/get-students";

function isSortBy(
  value: string | undefined,
): value is "recent" | "days" | "streak" | "referrals" {
  return (
    value === "recent" ||
    value === "days" ||
    value === "streak" ||
    value === "referrals"
  );
}

function isTrack(value: string | undefined): value is StudentTrack {
  return value === "ALL" || value === "CHALLENGE" || value === "HACKATHON";
}

function domainBadgeClass(domain: string): string {
  if (domain === "AI") return "border-domains-ai/50 bg-domains-ai-bg text-domains-ai";
  if (domain === "DS") return "border-domains-ds/50 bg-domains-ds-bg text-domains-ds";
  if (domain === "CLAUDE")
    return "border-orange-500/40 bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200";
  if (domain === "HACKATHON")
    return "border-border bg-muted text-muted-foreground";
  return "border-domains-se/50 bg-domains-se-bg text-domains-se";
}

function statusBadgeClass(status: string): string {
  if (status === "ACTIVE")
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400";
  if (status === "COMPLETED")
    return "bg-violet-100 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400";
  if (status === "SOLO" || status === "TEAM")
    return "bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400";
  return "bg-muted text-muted-foreground";
}

export default async function AdminStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    domain?: "AI" | "DS" | "SE" | "CLAUDE" | "ALL";
    status?: "ALL" | "ACTIVE" | "COMPLETED";
    sort?: string;
    track?: string;
  }>;
}) {
  const sp = await searchParams;
  const sortBy = isSortBy(sp.sort) ? sp.sort : "recent";
  const track = isTrack(sp.track) ? sp.track : "ALL";
  const domain = sp.domain ?? "ALL";
  const status = sp.status ?? "ALL";

  const [students, domainCounts, trackCounts] = await Promise.all([
    getStudents({
      search: sp.q,
      domain,
      status,
      sortBy,
      track,
    }),
    getStudentDomainCounts(status),
    getStudentTrackCounts({
      search: sp.q,
      domain,
      status,
    }),
  ]);

  const filteredCount =
    track === "CHALLENGE"
      ? trackCounts.CHALLENGE
      : track === "HACKATHON"
        ? trackCounts.HACKATHON
        : domain !== "ALL"
          ? domainCounts[domain]
          : trackCounts.ALL;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold md:text-3xl">Students</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Showing {Math.min(students.length, 100)} of {filteredCount} matching students
          {students.length >= 100 ? " (max 100)" : ""}
        </p>
      </div>

      <StudentsFilters domainCounts={domainCounts} trackCounts={trackCounts} />

      {sortBy === "referrals" ? (
        <Badge variant="secondary" className="text-xs">
          Ranked by referrals
        </Badge>
      ) : null}

      <div className="space-y-2 md:hidden">
        {students.map((student) => (
          <article
            key={`${student.track}:${student.rowId}`}
            className="rounded-xl border bg-card p-3 text-sm shadow-[var(--shadow-card)]"
          >
            <header className="flex items-start justify-between gap-2">
              <Link
                href={`/admin/students/${student.userId}`}
                className="font-medium underline"
              >
                {student.fullName}
              </Link>
              <Badge variant="outline" className={domainBadgeClass(student.domain)}>
                {student.domain}
              </Badge>
            </header>
            <p className="mt-1 text-xs text-muted-foreground">{student.email}</p>
            <p className="mt-2 text-xs">
              {student.track === "HACKATHON"
                ? "Days — · — streak"
                : `Days ${student.daysCompleted}/60 · ${student.currentStreak}d streak`}
            </p>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {student.affiliation}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{student.userType}</Badge>
              <Badge className={cn("border-0", statusBadgeClass(student.status))}>
                {student.status}
              </Badge>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3 w-3" aria-hidden />
                {student.referralCount} referrals
              </span>
            </div>
          </article>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-card)] md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Name
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Type
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Affiliation
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Domain
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Day
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Streak
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Referrals
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Status
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                Joined
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {students.map((student) => (
              <TableRow
                key={`${student.track}:${student.rowId}`}
                className="hover:bg-accent/40"
              >
                <TableCell>
                  <Link href={`/admin/students/${student.userId}`} className="font-medium underline">
                    {student.fullName}
                  </Link>
                  <p className="text-xs text-muted-foreground">{student.email}</p>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{student.userType}</Badge>
                </TableCell>
                <TableCell className="max-w-[12rem] truncate text-sm">
                  {student.affiliation}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={domainBadgeClass(student.domain)}>
                    {student.domain}
                  </Badge>
                </TableCell>
                <TableCell>
                  {student.track === "HACKATHON" ? "—" : student.daysCompleted}
                </TableCell>
                <TableCell>
                  {student.track === "HACKATHON" ? "—" : student.currentStreak}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" aria-hidden />
                    {student.referralCount}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge className={cn("border-0", statusBadgeClass(student.status))}>
                    {student.status}
                  </Badge>
                </TableCell>
                <TableCell>{formatDateIST(student.joinedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
