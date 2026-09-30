import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { DashboardShell } from "@/components/dashboard-hub/dashboard-shell";
import { JobsBrowser } from "@/components/jobs/jobs-browser";
import {
  formatExperienceLabel,
  formatPostedLabel,
  type ApplicationCardRow,
  type JobCardRow,
} from "@/components/jobs/job-ui";
import { prismaApplicationStore } from "@/features/candidate-jobs/prisma-store";
import {
  browsePublishedJobs,
  listMyApplications,
} from "@/features/candidate-jobs/service";
import { prismaJobStore } from "@/features/recruiter-jobs/prisma-store";
import { formatDateIST } from "@/lib/date-utils";

export const metadata: Metadata = { title: "Jobs | ABTalks" };

type PageProps = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function JobsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { tab } = await searchParams;

  // `browsePublishedJobs` is the candidate read boundary — DRAFT and CLOSED
  // rows never leave it, so the browser below only ever receives live roles.
  const deps = {
    jobs: prismaJobStore(),
    applications: prismaApplicationStore(),
  };
  const [browsed, mine] = await Promise.all([
    browsePublishedJobs(deps),
    listMyApplications(deps, { userId: session.user.id }),
  ]);

  const applications = mine.ok ? mine.data : [];
  const appliedJobIds = new Set(applications.map((a) => a.jobId));
  const now = new Date();

  // Server → Client: plain serializable rows only, with dates already rendered
  // to strings so the card copy is identical on both sides of the boundary.
  const jobs: JobCardRow[] = (browsed.ok ? browsed.data : []).map((job) => ({
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    workMode: job.workMode,
    type: job.type,
    skills: job.skills,
    postedLabel: formatPostedLabel(job.publishedAt ?? job.createdAt, now),
    experienceLabel: formatExperienceLabel(job.minExperience),
    applied: appliedJobIds.has(job.id),
  }));

  const applicationRows: ApplicationCardRow[] = applications.map((row) => ({
    id: row.id,
    jobId: row.jobId,
    title: row.job.title,
    company: row.job.company,
    location: row.job.location,
    workMode: row.job.workMode,
    type: row.job.type,
    status: row.status,
    appliedLabel: formatDateIST(row.createdAt),
    isOpen: row.job.isOpen,
  }));

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
      <JobsBrowser
        jobs={jobs}
        applications={applicationRows}
        initialTab={
          tab === "applications" || tab === "saved" ? tab : "jobs"
        }
      />
    </DashboardShell>
  );
}
