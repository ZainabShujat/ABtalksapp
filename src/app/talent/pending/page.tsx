import Link from "next/link";
import { Clock } from "lucide-react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getRecruiterState } from "@/features/talent-pool/recruiter-registration";
import { prisma } from "@/lib/db";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function TalentPendingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/talent/login");

  const state = await getRecruiterState(session.user.id);
  if (state.status === "none") redirect("/talent/register");
  // /hire, not /talent: the pool browser was removed, so an approved
  // recruiter was being sent to a 404 — which reads exactly like this
  // page having been deleted. Scout is where they actually work.
  if (state.status === "approved") redirect("/hire");

  // Someone who registered with candidates already picked was told only that
  // their application is under review — nothing acknowledged the request that
  // made them sign up in the first place.
  const pendingAsks = await prisma.talentEngagementRequest.count({
    where: {
      recruiterUserId: session.user.id,
      status: { notIn: ["CLOSED", "DECLINED"] },
    },
  });

  return (
    <div className="mx-auto max-w-md space-y-6 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10">
        <Clock className="size-7 text-primary" />
      </div>
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Application received
        </h1>
        <p className="text-sm text-muted-foreground">
          Thanks, {state.fullName}. We&apos;re reviewing your recruiter
          application for {state.company}. You&apos;ll receive an email once
          approved.
        </p>
      </header>
      {pendingAsks > 0 && (
        <p className="rounded-xl border bg-card p-4 text-sm text-foreground/90">
          We also have your request to be introduced to{" "}
          <strong>
            {pendingAsks} candidate{pendingAsks === 1 ? "" : "s"}
          </strong>
          . It is with our team alongside your application — nothing to re-do
          once you are approved.
        </p>
      )}
      <Link href="/program" className={cn(buttonVariants({ variant: "outline" }))}>
        Back to program
      </Link>
    </div>
  );
}
