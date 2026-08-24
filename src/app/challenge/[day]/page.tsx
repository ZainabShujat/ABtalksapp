import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { auth } from "@/auth";
import { getDayData } from "@/features/challenge/get-day-data";
import { formatDateIST } from "@/lib/date-utils";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SubmissionFlow } from "./submission-flow";
import {
  DayPage,
  type DayContent,
} from "@/components/challenge/day-page";
import { AppHeader } from "@/components/shared/app-header";
import { isDayLockBypassEnabled } from "@/lib/feature-flags";
import { prisma } from "@/lib/db";

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

type HeaderUser = {
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  isAdmin?: boolean;
};

function ChallengePageShell({
  headerUser,
  children,
  mainClassName,
}: {
  headerUser: HeaderUser;
  children: ReactNode;
  mainClassName?: string;
}) {
  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <AppHeader user={headerUser} />
      <div className={cn("flex flex-1 flex-col", mainClassName)}>{children}</div>
    </div>
  );
}

export default async function ChallengeDayPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const userExists = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  });
  if (!userExists) {
    redirect("/api/auth/signout?callbackUrl=/login");
  }

  const headerUser = {
    name: session.user.name ?? null,
    email: session.user.email ?? "",
    image: session.user.image ?? null,
    role: session.user.role ?? "STUDENT",
    isAdmin: session.user.isAdmin ?? false,
  };

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
      <ChallengePageShell
        headerUser={headerUser}
        mainClassName="mx-auto w-full max-w-lg justify-center px-4 py-12"
      >
        <Card>
          <CardHeader>
            <CardTitle>Day not available</CardTitle>
            <CardDescription>
              We couldn&apos;t load this day&apos;s challenge. If the problem
              persists, contact support.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/dashboard"
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              Back to dashboard
            </Link>
          </CardContent>
        </Card>
      </ChallengePageShell>
    );
  }

  const bypassEnabled = isDayLockBypassEnabled();

  if (!bypassEnabled && !data.isUnlocked) {
    const enc = encodeURIComponent(data.enrollment.id);
    return (
      <ChallengePageShell
        headerUser={headerUser}
        mainClassName="mx-auto w-full max-w-2xl px-4 py-8"
      >
        <Card>
          <CardHeader>
            <CardTitle>Day {day} is not yet unlocked</CardTitle>
            <CardDescription>
              You are on day {data.currentDayNumber} (IST calendar from your
              start date).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link
              href={`/challenge/${data.currentDayNumber}?challenge=${enc}`}
              className={cn(buttonVariants({ variant: "default" }))}
            >
              Go to today&apos;s challenge
            </Link>
            <Link
              href={`/dashboard?challenge=${enc}`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Dashboard
            </Link>
          </CardContent>
        </Card>
      </ChallengePageShell>
    );
  }

  const canSubmit =
    bypassEnabled ||
    (data.isUnlocked &&
      (day >= data.currentDayNumber ||
        data.isRelaxable ||
        data.hasRejectResubmit ||
        data.existingSubmission != null));

  const dayContent = data.task.dayContent as DayContent | null;
  const enrichedDayContent = dayContent
    ? {
        ...dayContent,
        solutionVideoUrl:
          dayContent.solutionVideoUrl ?? dayContent.task.solutionVideoUrl,
        resources: dayContent.resources ?? data.task.resources,
      }
    : null;

  if (data.existingSubmission && !enrichedDayContent) {
    const sub = data.existingSubmission;
    return (
      <ChallengePageShell
        headerUser={headerUser}
        mainClassName="mx-auto w-full max-w-3xl gap-6 px-4 py-8"
      >
        <Card>
          <CardHeader>
            <CardTitle>{data.task.title}</CardTitle>
            <CardDescription>
              You completed this day on {formatDateIST(sub.submittedAt)} ·
              Status:{" "}
              {sub.status === "ON_TIME" || sub.status === "LATE"
                ? "On time"
                : "Late"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sub.githubUrl ? (
              <div className="space-y-2 text-sm">
                <p className="font-medium text-muted-foreground">GitHub</p>
                <a
                  href={sub.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  {sub.githubUrl}
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </div>
            ) : null}
            {sub.linkedinUrl ? (
              <div className="space-y-2 text-sm">
                <p className="font-medium text-muted-foreground">LinkedIn</p>
                <a
                  href={sub.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  {sub.linkedinUrl}
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </div>
            ) : null}
            <Link
              href={`/dashboard?challenge=${encodeURIComponent(data.enrollment.id)}`}
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              Back to dashboard
            </Link>
          </CardContent>
        </Card>
      </ChallengePageShell>
    );
  }

  return (
    <ChallengePageShell
      headerUser={headerUser}
      mainClassName={
        enrichedDayContent
          ? "flex flex-1 flex-col"
          : "mx-auto w-full max-w-5xl px-4 py-8"
      }
    >
      {enrichedDayContent ? (
        <>
          <div className="container mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 pt-4 md:px-6">
            <Link
              href={`/dashboard?challenge=${encodeURIComponent(data.enrollment.id)}`}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              ← Dashboard
            </Link>
            <p className="text-sm text-muted-foreground">
              
            </p>
          </div>
          <DayPage
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
        </>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
            <Link
              href={`/dashboard?challenge=${encodeURIComponent(data.enrollment.id)}`}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              ← Dashboard
            </Link>
            <p className="text-sm text-muted-foreground">
              Today (IST): day {data.currentDayNumber}
            </p>
          </div>
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
        </>
      )}
    </ChallengePageShell>
  );
}
