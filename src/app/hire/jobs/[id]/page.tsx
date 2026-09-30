import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { auth } from "@/auth";
import { requireRecruiterWorkspace } from "@/features/recruiter-workspace/workspace";
import { getRecruiterJob, listApplicantsForOwnedJob } from "@/features/recruiter-jobs/service";
import {
  prismaApplicantStore,
  prismaJobStore,
} from "@/features/recruiter-jobs/prisma-store";
import { formatDateIST } from "@/lib/date-utils";
import { JOB_TYPE_LABEL, WORK_MODE_LABEL } from "@/components/jobs/job-ui";
import { JobLifecycleButtons } from "@/components/hire/jobs/job-lifecycle-buttons";
import { JobFormClient } from "@/components/hire/jobs/job-form-client";
import { JobApplicantsDesk } from "@/components/hire/jobs/job-applicants-desk";
import { JobApplicantsList } from "@/components/hire/jobs/job-applicants-list";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function RecruiterJobDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/talent/login?from=/hire/jobs/${id}`);
  }

  const workspace = await requireRecruiterWorkspace();
  if (!workspace.ok) {
    return (
      <div className="hire-jobs">
        <p className="hire-jobs__error">{workspace.message}</p>
      </div>
    );
  }

  const deps = {
    jobs: prismaJobStore(),
    applications: prismaApplicantStore(),
  };
  const result = await getRecruiterJob(deps, { userId: workspace.data.userId }, id);
  if (!result.ok) notFound();
  const job = result.data;

  const applicantsRes = await listApplicantsForOwnedJob(
    deps,
    { userId: workspace.data.userId },
    id,
  );
  const applicants = applicantsRes.ok
    ? applicantsRes.data.map((row) => ({
        id: row.id,
        candidateRef: row.candidateRef,
        displayName: row.displayName,
        note: row.note,
        status: row.status,
        appliedLabel: formatDateIST(row.appliedAt),
      }))
    : [];

  return (
    <div className="hire-jobs hire-jobs--detail">
      <JobApplicantsDesk jobId={job.id} applicants={applicants}>
      <Link href="/hire/jobs" className="hire-back">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 19 8 12l7-7" />
        </svg>
        <span>All jobs</span>
      </Link>

      <div className="hire-jobs-detail__head">
        <div className="hire-jobs-detail__pills">
          <span className="hire-jobs__pill">{JOB_TYPE_LABEL[job.type]}</span>
          <span
            className={`hire-jobs__pill hire-jobs__pill--${job.status.toLowerCase()}`}
          >
            {job.status === "DRAFT"
              ? "Draft"
              : job.status === "PUBLISHED"
                ? "Published"
                : "Closed"}
          </span>
          {job.workMode ? (
            <span className="hire-jobs__pill">
              {WORK_MODE_LABEL[job.workMode]}
            </span>
          ) : null}
        </div>
        <h1>{job.title}</h1>
        <p className="hire-jobs__meta">
          {job.company}
          {job.location ? ` · ${job.location}` : null}
        </p>
        <p className="hire-jobs__updated">
          {job.publishedAt
            ? `Published ${formatDateIST(job.publishedAt)}`
            : `Created ${formatDateIST(job.createdAt)}`}
          {job.closedAt ? ` · Closed ${formatDateIST(job.closedAt)}` : null}
        </p>
      </div>

      <div className="hire-jobs-form__card hire-jobs-detail__lifecycle">
        <JobLifecycleButtons jobId={job.id} status={job.status} />
        {job.status === "PUBLISHED" ? (
          <p>
            Candidates can see this job at{" "}
            <Link href={`/jobs/${job.id}`}>/jobs/{job.id}</Link>.
          </p>
        ) : job.status === "DRAFT" ? (
          <p>
            Draft — not visible to candidates. Direct URL access is refused
            server-side.
          </p>
        ) : (
          <p>Closed — no new applications accepted. Reopen any time.</p>
        )}
      </div>

      <JobApplicantsList applicants={applicants} />

      {job.description ? (
        <div className="hire-jobs-detail__body">
          <ReactMarkdown>{job.description}</ReactMarkdown>
        </div>
      ) : null}

      <details className="hire-jobs-detail__edit">
        <summary>Edit job details</summary>
        <div className="hire-jobs-detail__edit-body">
          <JobFormClient
            variant="embedded"
            jobId={job.id}
            status={job.status}
            initial={{
              title: job.title,
              description: job.description,
              location: job.location ?? "",
              workMode: job.workMode ?? "REMOTE",
              type: job.type,
              skills: job.skills,
              // Not optional. The client posts the whole form rather than a
              // diff, so omitting this here would send "" on every edit and
              // quietly wipe a value the recruiter set when posting.
              minExperience:
                job.minExperience === null ? "" : String(job.minExperience),
              applyExternalUrl: job.applyExternalUrl ?? "",
            }}
          />
        </div>
      </details>
      </JobApplicantsDesk>
    </div>
  );
}
