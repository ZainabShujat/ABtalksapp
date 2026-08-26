import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { auth } from "@/auth";
import { ClaudeDayView } from "@/components/claude/claude-day-view";
import type { DayContent } from "@/components/challenge/day-page";
import { DashboardShell } from "@/components/dashboard-hub/dashboard-shell";
import { CLAUDE_SECTION_NAV_FROM_DAY } from "@/components/claude/claude-section-nav";
import { dsButtonVariants } from "@/components/design/ds-button";
import { getDayData } from "@/features/challenge/get-day-data";
import { formatDateIST } from "@/lib/date-utils";
import { prisma } from "@/lib/db";
import { isDayLockBypassEnabled } from "@/lib/feature-flags";
import { cn } from "@/lib/utils";
import { SubmissionFlow } from "@/app/challenge/[day]/submission-flow";

type PageProps = {
  params: Promise<{ day: string }>;
  searchParams: Promise<{ challenge?: string | string[] }>;
};

function readChallengeParam(
  sp: Record<string, string | string[] | undefined>,
): string | undefined {
  const raw = sp.challenge;
  const v = Array.isArray(raw) ? raw[0] : raw;
  const t = typeof v === "string" ? v.trim() : "";
  return t || undefined;
}

export default async function ClaudeDayPage({
  params,
  searchParams,
}: PageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const userExists = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, image: true },
  });
  if (!userExists) {
    redirect("/api/auth/signout?callbackUrl=/login");
  }

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: session.user.id },
    select: { fullName: true },
  });

  const shellUser = {
    name: profile?.fullName ?? session.user.name ?? "",
    email: session.user.email ?? "",
    image: session.user.image ?? null,
  };
  const isAdmin = session.user.isAdmin ?? false;

  const { day: dayParam } = await params;
  const sp = await searchParams;
  const challengeEnrollmentId = readChallengeParam(sp);
  const day = Number.parseInt(dayParam, 10);
  if (!Number.isFinite(day) || day < 1 || day > 60) {
    notFound();
  }

  const data = await getDayData(
    session.user.id,
    day,
    challengeEnrollmentId,
  );

  if (!data) {
    return (
      <DashboardShell
        user={shellUser}
        isAdmin={isAdmin}
        collapsible
        sectionNavItems={CLAUDE_SECTION_NAV_FROM_DAY}
      >
        <div className="mx-auto max-w-lg px-5 py-12">
          <h1 className="font-heading text-2xl font-semibold text-[#111111]">
            Day not available
          </h1>
          <p className="mt-2 text-sm text-[#4B4B4B]">
            We couldn&apos;t load this day&apos;s challenge. If the problem
            persists, contact support.
          </p>
          <Link
            href="/claude"
            className={cn(dsButtonVariants({ size: "sm" }), "mt-4 inline-flex")}
          >
            Back to Claude Challenge
          </Link>
        </div>
      </DashboardShell>
    );
  }

  if (data.enrollment.domain !== "CLAUDE") {
    const enc = encodeURIComponent(data.enrollment.id);
    redirect(`/challenge/${day}?challenge=${enc}`);
  }

  const bypassEnabled = isDayLockBypassEnabled();

  if (!bypassEnabled && !data.isUnlocked) {
    const enc = encodeURIComponent(data.enrollment.id);
    return (
      <DashboardShell
        user={shellUser}
        isAdmin={isAdmin}
        collapsible
        sectionNavItems={CLAUDE_SECTION_NAV_FROM_DAY}
      >
        <div className="mx-auto max-w-2xl px-5 py-8">
          <h1 className="font-heading text-2xl font-semibold text-[#111111]">
            Day {day} is not yet unlocked
          </h1>
          <p className="mt-2 text-sm text-[#4B4B4B]">
            You are on day {data.currentDayNumber} (IST calendar from your start
            date).
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/claude/day/${data.currentDayNumber}?challenge=${enc}`}
              className={cn(dsButtonVariants({ size: "sm" }), "inline-flex")}
            >
              Go to today&apos;s challenge
            </Link>
            <Link
              href={`/claude?challenge=${enc}`}
              className="inline-flex h-9 items-center rounded-lg border border-[#E0E0E0] px-4 text-sm font-medium text-[#555555] hover:border-[#E05226] hover:text-[#E05226]"
            >
              Claude Challenge
            </Link>
          </div>
        </div>
      </DashboardShell>
    );
  }

  // Claude: View-only when a submission already exists. New submit only for
  // today / relaxable / reject-resubmit (or lock bypass).
  const canSubmit =
    bypassEnabled ||
    (!data.existingSubmission &&
      data.isUnlocked &&
      (day === data.currentDayNumber ||
        data.isRelaxable ||
        data.hasRejectResubmit));

  const dayContent = data.task.dayContent as DayContent | null;
  const enrichedDayContent = dayContent
    ? {
        ...dayContent,
        solutionVideoUrl:
          dayContent.solutionVideoUrl ?? dayContent.task.solutionVideoUrl,
        resources: dayContent.resources ?? data.task.resources,
      }
    : null;

  const backHref = `/claude?challenge=${encodeURIComponent(data.enrollment.id)}`;

  if (!enrichedDayContent) {
    const sub = data.existingSubmission;
    return (
      <DashboardShell
        user={shellUser}
        isAdmin={isAdmin}
        collapsible
        sectionNavItems={CLAUDE_SECTION_NAV_FROM_DAY}
      >
        <div className="mx-auto max-w-3xl space-y-6 px-5 py-8">
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-2 text-sm">
              <li>
                <Link
                  href="/dashboard"
                  className="text-[#8F8F8F] hover:text-[#E05226]"
                >
                  Dashboard
                </Link>
              </li>
              <li aria-hidden className="text-[#8F8F8F]">
                &gt;
              </li>
              <li>
                <Link
                  href={backHref}
                  className="text-[#8F8F8F] hover:text-[#E05226]"
                >
                  Claude Challenge
                </Link>
              </li>
              <li aria-hidden className="text-[#8F8F8F]">
                &gt;
              </li>
              <li aria-current="page" className="font-semibold text-[#111111]">
                Day {day}
              </li>
            </ol>
          </nav>
          <div className="rounded-[12px] border border-[#E0E0E0] bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <h1 className="font-heading text-2xl font-semibold text-[#111111]">
              {data.task.title}
            </h1>
            {sub ? (
              <p className="mt-2 text-sm text-[#4B4B4B]">
                You completed this day on {formatDateIST(sub.submittedAt)} ·
                Status:{" "}
                {sub.status === "ON_TIME" || sub.status === "LATE"
                  ? "On time"
                  : "Late"}
              </p>
            ) : (
              <p className="mt-2 text-sm text-[#4B4B4B]">
                {data.task.problemStatement}
              </p>
            )}
            {sub?.githubUrl ? (
              <div className="mt-4 space-y-1 text-sm">
                <p className="font-medium text-[#8F8F8F]">GitHub</p>
                <a
                  href={sub.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#E05226] hover:underline"
                >
                  {sub.githubUrl}
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </div>
            ) : null}
            {sub?.linkedinUrl ? (
              <div className="mt-4 space-y-1 text-sm">
                <p className="font-medium text-[#8F8F8F]">LinkedIn</p>
                <a
                  href={sub.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#E05226] hover:underline"
                >
                  {sub.linkedinUrl}
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </div>
            ) : null}
            {!sub && canSubmit ? (
              <div className="mt-6">
                <SubmissionFlow
                  dayNumber={day}
                  enrollmentId={data.enrollment.id}
                  task={{
                    title: data.task.title,
                    problemStatement: data.task.problemStatement,
                  }}
                  userDomain={data.enrollment.domain}
                  isRelaxable={data.isRelaxable}
                  canSubmit={canSubmit}
                />
              </div>
            ) : null}
            <Link
              href={backHref}
              className={cn(
                dsButtonVariants({ size: "sm" }),
                "mt-6 inline-flex",
              )}
            >
              Back to Claude Challenge
            </Link>
          </div>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      user={shellUser}
      isAdmin={isAdmin}
      collapsible
      sectionNavItems={CLAUDE_SECTION_NAV_FROM_DAY}
    >
      <ClaudeDayView
        dayNumber={day}
        content={enrichedDayContent}
        resources={data.task.resources}
        enrollmentId={data.enrollment.id}
        existingSubmission={
          data.existingSubmission
            ? {
                githubUrl: data.existingSubmission.githubUrl ?? "",
                linkedinUrl: data.existingSubmission.linkedinUrl ?? "",
              }
            : null
        }
        canSubmit={canSubmit}
      />
    </DashboardShell>
  );
}
