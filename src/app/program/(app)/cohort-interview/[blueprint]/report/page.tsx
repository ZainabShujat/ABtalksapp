import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProgramMember } from "@/lib/program-auth";
import {
  parseBlueprintParam,
  BLUEPRINT_LABEL,
} from "@/features/interview/cohort/blueprint";
import { getCohortInterviewReport } from "@/features/interview/service";
import { InterviewReportView } from "@/components/interview/cohort/report-view";
import "@/components/interview/cohort/interview.css";

export const dynamic = "force-dynamic";

/**
 * The persisted assessment report.
 *
 * Reads the stored document and renders it — no recomputation, no client
 * JavaScript. A report is the record of an assessment that already happened,
 * and regenerating it per view would let the same interview say different
 * things on different days.
 *
 * The document is validated on read inside `loadReport`, so a row written
 * against an older shape degrades to "no report" rather than a half-rendered
 * page.
 */
export default async function CohortInterviewReportPage({
  params,
}: {
  params: Promise<{ blueprint: string }>;
}) {
  // Authenticate BEFORE looking at the URL, as the interview page does.
  const { member } = await requireProgramMember();

  const { blueprint: rawBlueprint } = await params;
  const blueprint = parseBlueprintParam(rawBlueprint);
  if (!blueprint) notFound();

  // Member-scoped at the query level: another member's interview resolves to
  // "no report", never to their report.
  const result = await getCohortInterviewReport(member.id, blueprint);

  if (!result.ok) {
    return (
      <div className="interview-room mx-auto max-w-2xl py-10 text-[var(--iv-text)]">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          {BLUEPRINT_LABEL[blueprint]}
        </h1>
        <p className="mt-3 text-[15px] text-[var(--iv-text-muted)]">
          {result.message}
        </p>
        <Link
          href="/program/dashboard"
          className="mt-6 inline-flex h-10 items-center rounded-[10px] border border-[var(--iv-border)] px-4 text-[14px] text-[var(--iv-text-muted)] transition-colors hover:border-white/30 hover:text-[var(--iv-text)]"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <>
      <InterviewReportView
        report={result.data.report}
        generatedAt={result.data.generatedAt}
      />
      <div className="interview-room mx-auto max-w-4xl pb-10">
        <Link
          href="/program/dashboard"
          className="inline-flex h-10 items-center rounded-[10px] border border-[var(--iv-border)] px-4 text-[14px] text-[var(--iv-text-muted)] transition-colors hover:border-white/30 hover:text-[var(--iv-text)]"
        >
          Back to dashboard
        </Link>
      </div>
    </>
  );
}
