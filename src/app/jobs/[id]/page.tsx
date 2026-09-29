import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { auth } from "@/auth";
import { DashboardShell } from "@/components/dashboard-hub/dashboard-shell";
import { ApplyJobButton } from "@/components/jobs/apply-job-button";
import {
  formatPostedLabel,
  JOB_TYPE_LABEL,
  WORK_MODE_LABEL,
  formatExperienceLabel,
} from "@/components/jobs/job-ui";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDateIST } from "@/lib/date-utils";
import { getJobDetail } from "@/features/jobs/get-job-detail";

type PageProps = {
  params: Promise<{ id: string }>;
};

const CARD_CLASS = "rounded-xl border border-[#E0E0E0] bg-white";
const PILL_CLASS =
  "inline-flex items-center rounded-[7px] bg-[#EEF6F6] px-2.5 py-1.5 text-xs text-[#03535F]";

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

  const shellUser = {
    name: session.user.name ?? session.user.email ?? "",
    email: session.user.email ?? "",
    image: session.user.image ?? null,
  };

  const facts: Array<[string, string]> = [
    ["Location", job.location ?? "Not specified"],
    ["Work mode", job.workMode ? WORK_MODE_LABEL[job.workMode] : "Not specified"],
    ["Type", JOB_TYPE_LABEL[job.type]],
    ["Experience", formatExperienceLabel(job.minExperience) ?? "Not specified"],
    ["Posted", formatDateIST(job.publishedAt ?? job.createdAt)],
  ];

  return (
    <DashboardShell
      user={shellUser}
      isAdmin={session.user.isAdmin ?? false}
      showSectionNav={false}
    >
      <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-8 sm:px-6">
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#03535F] hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to jobs
        </Link>

        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
          <article className={cn(CARD_CLASS, "p-6 sm:p-7")}>
            <p className="font-heading text-[13px] font-semibold uppercase tracking-[0.08em] text-[#03535F]">
              {JOB_TYPE_LABEL[job.type]}
            </p>
            {/* Sized against the job card it opens from, which is
                `text-xl font-semibold` / `sm:text-2xl`. At 40px bold this
                heading was roughly twice its own card and a real job title
                wrapped to two outsized lines. Standard scale tokens rather
                than an arbitrary [40px], still a step above the card. */}
            <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-black sm:text-3xl sm:leading-[40px]">
              {job.title}
            </h1>
            <p className="mt-1.5 text-sm text-[#4B4B4B]">
              {job.company}
              {job.location ? ` · ${job.location}` : null} ·{" "}
              {formatPostedLabel(job.publishedAt ?? job.createdAt)}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {job.workMode ? (
                <span className={PILL_CLASS}>{WORK_MODE_LABEL[job.workMode]}</span>
              ) : null}
              {!job.isOpen ? (
                <span className="inline-flex items-center rounded-[7px] bg-[#FFF2F0] px-2.5 py-1.5 text-xs font-semibold text-[#D92D20]">
                  Closed
                </span>
              ) : null}
            </div>

            <h2 className="mt-7 font-heading text-2xl font-semibold text-black">
              About the role
            </h2>
            <div className="prose prose-sm dark:prose-invert mt-3 max-w-none text-[#4B4B4B] [&_p]:mb-3 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:mb-1">
              <ReactMarkdown>{job.description}</ReactMarkdown>
            </div>

            {job.skills.length > 0 ? (
              <>
                <h2 className="mt-7 font-heading text-2xl font-semibold text-black">
                  Skills
                </h2>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {job.skills.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex rounded-[7px] border border-[#E0E0E0] px-2 py-1 text-xs text-[#4B4B4B]"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </>
            ) : null}
          </article>

          {/* Apply first on mobile — the decision, then the detail. */}
          <aside
            className={cn(
              CARD_CLASS,
              "order-first h-max p-6 lg:order-none lg:sticky lg:top-[75px]",
            )}
          >
            <h2 className="font-heading text-xl font-semibold text-black">
              Apply for this job
            </h2>

            <div className="mt-4">
              {alreadyApplied ? (
                <>
                  <p className="rounded-lg bg-[#D6F7EC] px-3.5 py-3 text-[13px] leading-5 text-[#197E23]">
                    <b>Already applied.</b> Your application is saved — follow its
                    status from Applications.
                  </p>
                  <Link
                    href="/jobs?tab=applications"
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "mt-3 w-full",
                    )}
                  >
                    Track application
                  </Link>
                </>
              ) : (
                <>
                  {!job.isOpen ? (
                    <p className="mb-3 rounded-lg bg-[#FFF2F0] px-3.5 py-3 text-[13px] leading-5 text-[#D92D20]">
                      This role is closed.
                    </p>
                  ) : (
                    <p className="mb-4 text-[13px] leading-5 text-[#4B4B4B]">
                      You can apply to this job once. Your application stays
                      available on your Applications page.
                    </p>
                  )}
                  <ApplyJobButton
                    jobId={job.id}
                    alreadyApplied={alreadyApplied}
                    externalUrl={job.applyExternalUrl ?? ""}
                    isOpen={job.isOpen}
                  />
                </>
              )}
            </div>

            <dl className="mt-6">
              {facts.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-4 border-t border-[#E0E0E0] py-3 text-sm"
                >
                  <dt className="text-[#4B4B4B]">{label}</dt>
                  <dd className="text-right font-medium text-[#353535]">{value}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
      </main>
    </DashboardShell>
  );
}
