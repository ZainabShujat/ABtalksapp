import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProgramMember } from "@/lib/program-auth";
import { toProgramMemberId } from "@/features/interview/provider";
import {
  parseBlueprintParam,
  BLUEPRINT_LABEL,
} from "@/features/interview/cohort/blueprint";
import { getCohortInterviewReport } from "@/features/interview/service";
import { InterviewReportView } from "@/components/interview/cohort/report-view";
import { prisma } from "@/lib/db";
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
  const { member, userId } = await requireProgramMember();

  const { blueprint: rawBlueprint } = await params;
  const blueprint = parseBlueprintParam(rawBlueprint);
  if (!blueprint) notFound();

  // Member-scoped at the query level: another member's interview resolves to
  // "no report", never to their report.
  const result = await getCohortInterviewReport(
    toProgramMemberId(member.id),
    blueprint,
  );

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const isIshaan = user?.email === "demo-day31@abtalks.dev";

  async function reattemptAction() {
    "use server";
    if (!isIshaan) return;
    await prisma.generalInterview.deleteMany({
      where: {
        memberId: toProgramMemberId(member.id),
        blueprint: blueprint as any,
      }
    });
    redirect(`/program/cohort-interview/${blueprint}`);
  }

  if (!result.ok) {
    return (
      <div className="interview-room mx-auto max-w-2xl py-10 text-[var(--iv-text)]">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          {BLUEPRINT_LABEL[blueprint]}
        </h1>
        <p className="mt-3 text-[15px] text-[var(--iv-text-muted)]">
          {result.message}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href="/program/dashboard"
            className="inline-flex h-10 items-center rounded-[10px] border border-[var(--iv-border)] px-4 text-[14px] text-[var(--iv-text-muted)] transition-colors hover:border-[#8F8F8F] hover:text-[var(--iv-text)]"
          >
            Back to dashboard
          </Link>
          {isIshaan && (
            <form action={reattemptAction}>
              <button
                type="submit"
                className="inline-flex h-10 items-center rounded-[10px] border border-gray-300 bg-gray-100 px-4 text-[14px] font-semibold text-gray-800 transition-colors hover:bg-gray-200"
              >
                Reattempt (Demo)
              </button>
            </form>
          )}
        </div>
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
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/program/dashboard"
            className="inline-flex h-10 items-center rounded-[10px] border border-[var(--iv-border)] px-4 text-[14px] text-[var(--iv-text-muted)] transition-colors hover:border-[#8F8F8F] hover:text-[var(--iv-text)]"
          >
            Back to dashboard
          </Link>
          {isIshaan && (
            <form action={reattemptAction}>
              <button
                type="submit"
                className="inline-flex h-10 items-center rounded-[10px] border border-gray-300 bg-gray-100 px-4 text-[14px] font-semibold text-gray-800 transition-colors hover:bg-gray-200"
              >
                Reattempt (Demo)
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
