import Link from "next/link";
import { Activity, Calendar, Trophy, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { ActivityTimeline } from "@/components/admin/activity-timeline";
import { StatCard } from "@/components/admin/stat-card";
import { getOverviewStats } from "@/features/admin/get-overview-stats";
import { cn } from "@/lib/utils";

function domainBadgeClass(domain: string): string {
  if (domain === "AI") return "border-domains-ai/50 bg-domains-ai-bg text-domains-ai";
  if (domain === "DS") return "border-domains-ds/50 bg-domains-ds-bg text-domains-ds";
  return "border-domains-se/50 bg-domains-se-bg text-domains-se";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0] + parts[1]![0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

export default async function AdminHomePage() {
  const data = await getOverviewStats();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold md:text-3xl">Admin Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Quick snapshot of what&apos;s happening on ABTalks.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Students"
          value={data.stats.totalStudents}
          delta={data.stats.totalStudentsDelta}
          accent="green"
          icon={<Users className="h-4 w-4" />}
          series={data.stats.totalStudentsSeries}
        />
        <StatCard
          label="Active Today"
          value={data.stats.activeToday}
          delta={data.stats.activeTodayDelta}
          accent="purple"
          icon={<Activity className="h-4 w-4" />}
        />
        <StatCard
          label="Day 30 Reached"
          value={data.stats.day30Reached}
          delta={data.stats.day30ReachedDelta}
          accent="orange"
          icon={<Calendar className="h-4 w-4" />}
        />
        <StatCard
          label="Day 60 Reached"
          value={data.stats.day60Reached}
          delta={data.stats.day60ReachedDelta}
          accent="blue"
          icon={<Trophy className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-xl shadow-[var(--shadow-card)]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Pending Reviews</CardTitle>
            <Link
              href="/admin/submissions"
              className="text-xs text-primary hover:underline"
            >
              View all →
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.liveSubmissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent submissions</p>
            ) : (
              data.liveSubmissions.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-3 rounded-lg border p-3 text-sm"
                >
                  <Avatar size="sm">
                    <AvatarFallback className="text-xs">
                      {initials(row.studentName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/students/${row.userId}`}
                      className="truncate font-medium hover:underline"
                    >
                      {row.studentName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      Day {row.dayNumber} · {row.domain}
                      {row.linkedinUrl ? (
                        <>
                          {" · "}
                          <a
                            href={row.linkedinUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            LinkedIn
                          </a>
                        </>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.submittedAtRelative}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn("hidden sm:inline-flex", domainBadgeClass(row.domain))}>
                    {row.domain}
                  </Badge>
                  <Link
                    href={`/admin/students/${row.userId}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Review
                  </Link>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-[var(--shadow-card)]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Recruiter applications</CardTitle>
            <Link
              href="/admin/recruiters"
              className="text-xs text-primary hover:underline"
            >
              View all →
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.pendingRecruiters.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recruiter applications waiting.
              </p>
            ) : (
              data.pendingRecruiters.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-3 rounded-lg border p-3 text-sm"
                >
                  <Avatar size="sm">
                    <AvatarFallback className="text-xs">
                      {initials(row.fullName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{row.fullName}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.company} · {row.email}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.createdAtRelative}
                    </p>
                  </div>
                  <Link
                    href="/admin/recruiters"
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Review
                  </Link>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl shadow-[var(--shadow-card)]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Recent Activity</CardTitle>
            <Link
              href="/admin/actions"
              className="text-xs text-primary hover:underline"
            >
              View all Activity →
            </Link>
          </CardHeader>
          <CardContent>
            <ActivityTimeline items={data.recentAdminActions} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
