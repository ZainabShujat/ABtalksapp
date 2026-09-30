import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { DashboardShell } from "@/components/dashboard-hub/dashboard-shell";
import { AssessmentAttempt } from "@/components/assessments/assessment-attempt";
import { buttonVariants } from "@/components/ui/button";
import { loadAttempt } from "@/features/assessment-attempts/service";
import { prismaAttemptStore } from "@/features/assessment-attempts/prisma-store";
import { formatDateTimeIST } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ assignmentId: string }> };

export const metadata: Metadata = { title: "Assessment | ABTalks" };

export default async function AssessmentAttemptPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { assignmentId } = await params;
  const loaded = await loadAttempt(prismaAttemptStore(), session.user.id, assignmentId);
  // Someone else's assignment, an unknown id or an unpublished assessment:
  // 404, never 403 — an id must not reveal that it exists.
  if (!loaded.ok) notFound();

  const shellUser = {
    name: session.user.name ?? session.user.email ?? "",
    email: session.user.email ?? "",
    image: session.user.image ?? null,
  };

  const hideBackLink =
    loaded.data.rules.strictMode && loaded.data.status === "STARTED";

  return (
    <DashboardShell
      user={shellUser}
      isAdmin={session.user.isAdmin ?? false}
      showSectionNav={false}
    >
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        {hideBackLink ? null : (
          <Link
            href={`/assessments?tab=${loaded.data.source === "PLATFORM" ? "platform" : "recruiter"}`}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mb-4")}
          >
            ← All assessments
          </Link>
        )}
        {loaded.data.missed ? (
          // Plan 166: a platform assessment that closed before it was started.
          <section className="rounded-xl border bg-card px-6 py-10 text-center">
            <h1 className="font-display text-2xl font-semibold">{loaded.data.view.title}</h1>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
              The deadline for this assessment passed
              {loaded.data.closesAt ? ` on ${formatDateTimeIST(loaded.data.closesAt)}` : ""}.
              It wasn&apos;t started, so there&apos;s nothing to submit.
            </p>
          </section>
        ) : (
          <>
            {loaded.data.closesAt && loaded.data.status !== "SUBMITTED" ? (
              <p className="mb-4 text-sm text-muted-foreground">
                From ABTalks · Due {formatDateTimeIST(loaded.data.closesAt)}. If you&apos;ve
                started and it&apos;s still open at the deadline, the answers you saved are
                submitted automatically.
              </p>
            ) : null}
            <AssessmentAttempt
              assignmentId={loaded.data.assignmentId}
              status={loaded.data.status}
              submittedAtLabel={
                loaded.data.submittedAt ? formatDateTimeIST(loaded.data.submittedAt) : null
              }
              deadlineAt={loaded.data.deadlineAt?.toISOString() ?? null}
              serverNow={loaded.data.serverNow.toISOString()}
              endReason={loaded.data.endReason}
              strikes={loaded.data.strikes}
              view={loaded.data.view}
              initialAnswers={loaded.data.answers}
              rules={loaded.data.rules}
            />
          </>
        )}
      </main>
    </DashboardShell>
  );
}
