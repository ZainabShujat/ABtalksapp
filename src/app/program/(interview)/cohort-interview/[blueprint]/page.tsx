import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProgramMember } from "@/lib/program-auth";
import { parseBlueprintParam, BLUEPRINT_LABEL } from "@/features/interview/cohort/blueprint";
import { getCohortInterviewOverview } from "@/features/interview/service";
import { toProgramMemberId } from "@/features/interview/provider";
import { InterviewSession } from "@/components/interview/cohort/interview-session";
import "@/components/interview/cohort/interview.css";

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

  const overview = await getCohortInterviewOverview(
    toProgramMemberId(member.id),
    blueprint,
  );

  if (!overview.ok) {
    return <Notice blueprint={blueprint} message={overview.message} />;
  }

  const { eligibility, questionCount, durationSec } = overview.data;

  // Eligibility is resolved on the SERVER and decides which screen exists at
  // all. The room is never rendered for a member who may not sit the
  // interview, so there is no client state that could reveal it.
  if (eligibility.state === "locked") {
    return <Notice blueprint={blueprint} message={eligibility.reason} />;
  }

  if (eligibility.state === "taken") {
    return (
      <Notice
        blueprint={blueprint}
        message="You have already completed this interview."
        reportHref={`/program/cohort-interview/${blueprint}/report`}
      />
    );
  }

  return (
    <InterviewSession
      blueprint={blueprint}
      candidateName={member.fullName}
      questionCount={questionCount}
      durationSec={durationSec}
    />
  );
}

/**
 * The one non-interview screen: a short explanation and a way out. Styled with
 * the same interview-scoped tokens so a locked milestone does not look like a
 * different product from the room itself.
 */
function Notice({
  blueprint,
  message,
  reportHref,
}: {
  blueprint: "DAY_15" | "DAY_31";
  message: string;
  reportHref?: string;
}) {
  return (
    <div className="interview-room mx-auto w-full max-w-2xl py-10">
      <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--iv-text)]">
        {BLUEPRINT_LABEL[blueprint]}
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--iv-text-muted)]">
        {message}
      </p>
      <div className="mt-7 flex flex-wrap items-center gap-3">
        {reportHref ? (
          <Link
            href={reportHref}
            className="inline-flex h-11 items-center rounded-[12px] border border-[#E05226] bg-[#E05226] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[#C9411C]"
          >
            View interview report
          </Link>
        ) : null}
        <Link
          href="/program/dashboard"
          className="text-[14px] text-[#4B4B4B] underline underline-offset-4 transition-colors hover:text-[#111111]"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
 
