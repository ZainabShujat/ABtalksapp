import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { auth } from "@/auth";
import { AppHeader } from "@/components/shared/app-header";
import { ApplyJobButton } from "@/components/jobs/apply-job-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDateIST } from "@/lib/date-utils";
import { getJobDetail } from "@/features/jobs/get-job-detail";
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

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function JobDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { id } = await params;
  const data = await getJobDetail(id, session.user.id);
  if (!data) {
    notFound();
  }

  const { job, alreadyApplied } = data;

  const headerUser = {
    name: session.user.name ?? null,
    email: session.user.email ?? "",
    image: session.user.image ?? null,
    role: session.user.role ?? "STUDENT",
    isAdmin: session.user.isAdmin ?? false,
  };

  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <AppHeader user={headerUser} />
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <Link
          href="/jobs"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mb-4")}
        >
          ← All jobs
        </Link>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{jobTypeLabel(job.type)}</Badge>
            {!job.isOpen ? (
              <Badge variant="secondary">Closed</Badge>
            ) : null}
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            {job.title}
          </h1>
          <p className="text-muted-foreground">
            {job.company}
            {job.location ? ` · ${job.location}` : null}
          </p>
          <p className="text-xs text-muted-foreground">
            Posted {formatDateIST(job.createdAt)}
          </p>
        </div>

        <div className="prose prose-sm dark:prose-invert mt-8 max-w-none [&_p]:mb-3">
          <ReactMarkdown>{job.description}</ReactMarkdown>
        </div>

        <div className="mt-8 rounded-xl border bg-card p-5">
          {!job.isOpen ? (
            <p className="mb-4 text-sm font-medium text-amber-600 dark:text-amber-400">
              This role is closed
            </p>
          ) : null}
          <ApplyJobButton
            jobId={job.id}
            alreadyApplied={alreadyApplied}
            externalUrl={job.applyExternalUrl ?? ""}
            isOpen={job.isOpen}
          />
        </div>
      </div>
    </div>
  );
}
