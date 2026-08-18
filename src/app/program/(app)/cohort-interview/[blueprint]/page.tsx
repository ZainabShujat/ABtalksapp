import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProgramMember } from "@/lib/program-auth";
import { parseBlueprintParam, BLUEPRINT_LABEL } from "@/features/interview/cohort/blueprint";
import { getCohortInterviewOverview } from "@/features/interview/service";
import { CohortInterviewRunner } from "@/components/program/cohort-interview-runner";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * AI Cohort milestone interview.
 *
 * Server Component. It authenticates, resolves the member, validates the
 * blueprint from the URL, and reads eligibility — then hands plain data to the
 * client runner. No functions or class instances cross the boundary.
 *
 * The eligibility read here is for RENDERING only. It decides what copy the
 * candidate sees, never whether an attempt may open: `startInterviewAction`
 * re-derives eligibility server-side before creating a row, so a stale page or a
 * hand-crafted request cannot open a locked milestone.
 */
export default async function CohortInterviewPage({
  params,
}: {
  params: Promise<{ blueprint: string }>;
}) {
  // Authenticate BEFORE looking at the URL. Middleware already gates
  // /program/*, but ordering it this way means an unauthenticated request never
  // reaches request-parameter handling even if that matcher changes.
  const { member } = await requireProgramMember();

  const { blueprint: rawBlueprint } = await params;
  const blueprint = parseBlueprintParam(rawBlueprint);
  if (!blueprint) notFound();

  const overview = await getCohortInterviewOverview(member.id, blueprint);

  if (!overview.ok) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          {BLUEPRINT_LABEL[blueprint]}
        </h1>
        <p className="text-sm text-muted-foreground">{overview.message}</p>
        <Link
          href="/program/dashboard"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <CohortInterviewRunner
        overview={overview.data}
        memberName={member.fullName}
      />
    </div>
  );
}
