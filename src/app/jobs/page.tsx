import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { DashboardShell } from "@/components/dashboard-hub/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDateIST } from "@/lib/date-utils";
import { getOpenJobs } from "@/features/jobs/get-open-jobs";
import type { JobType } from "@prisma/client";

function jobTypeLabel(type: JobType): string {
  switch (type) {
    case "FULL_TIME":
      return "Full-time";
    case "INTERNSHIP":
      return "Internship";
    case "CONTRACT":
      return "Contract";
    case "PART_TIME":
      return "Part-time";
    default:
      return type;
  }
}

export default async function JobsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const jobs = await getOpenJobs();

  const shellUser = {
    name: session.user.name ?? session.user.email ?? "",
    email: session.user.email ?? "",
    image: session.user.image ?? null,
  };

  return (
    <DashboardShell
      user={shellUser}
      isAdmin={session.user.isAdmin ?? false}
      showSectionNav={false}
    >
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <h1 className="font-display text-3xl font-bold tracking-tight">Jobs</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Open roles from the ABTalks community and partners.
        </p>

        {jobs.length === 0 ? (
          <p className="mt-10 text-center text-muted-foreground">
            No open roles right now. Check back soon.
          </p>
        ) : (
          <ul className="mt-8 grid gap-4">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.id}`}
                  className={cn(
                    "block rounded-xl border bg-card p-5 shadow-sm transition-colors hover:border-primary/30 hover:bg-card/80",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h2 className="font-display text-lg font-semibold">
                        {job.title}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {job.company}
                        {job.location ? ` · ${job.location}` : null}
                      </p>
                    </div>
                    <Badge variant="outline">{jobTypeLabel(job.type)}</Badge>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Posted {formatDateIST(job.createdAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </DashboardShell>
  );
}
