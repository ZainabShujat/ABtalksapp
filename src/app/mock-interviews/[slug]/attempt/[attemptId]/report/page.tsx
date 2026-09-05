import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  getAttemptProctoringSummary,
  getAttemptReport,
} from "@/features/interview/platform/service";
import { resolvePlatformUserId } from "@/features/interview/platform/provider";
import { MockInterviewReportView } from "@/components/mock-interview/report-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Interview Report | ABTalks",
};

/**
 * One attempt's report.
 *
 * Addressed BY ATTEMPT, not by domain. That is the whole reason this route
 * nests under `attempt/[attemptId]` rather than sitting beside the domain page
 * as the cohort's does: a cohort member holds at most one completed interview
 * per blueprint, so "the report for DAY_15" is unambiguous. Here a user can
 * hold many attempts at one domain, and each keeps its own report — a retake
 * never overwrites what came before.
 *
 * Server Component, no client JavaScript. Nothing is recomputed: the stored
 * document is validated on read inside `getAttemptReport` and rendered as-is,
 * so the same attempt cannot say different things on different days.
 *
 * Member-scoped at the query level — another user's attempt id resolves to
 * "no report", never to their report.
 */
export default async function MockInterviewReportPage({
  params,
}: {
  params: Promise<{ slug: string; attemptId: string }>;
}) {
  const { slug, attemptId } = await params;

  const userId = await resolvePlatformUserId();
  if (!userId) redirect("/login");

  const result = await getAttemptReport(userId, attemptId);

  // Read alongside the report rather than folded into it. The report document
  // is frozen at completion and versioned; proctoring events live on the turn
  // rows and are rolled up per view, so adding this section cost no migration
  // and no report-version bump. `getAttemptProctoringSummary` swallows its own
  // failures and returns an empty summary, so this cannot cost a candidate the
  // report itself.
  const proctoring = result.ok
    ? await getAttemptProctoringSummary(userId, attemptId)
    : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 md:py-14">
      <Link
        href="/mock-interviews/history"
        className="inline-flex items-center gap-1.5 text-[13px] text-[#4B4B4B] transition-colors hover:text-[#111111]"
      >
        <ArrowLeft className="size-3.5" strokeWidth={2} />
        Your practice history
      </Link>

      {!result.ok ? (
        <div className="mt-6">
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#111111]">
            Report unavailable
          </h1>
          <p className="mt-3 text-[15px] text-[#4B4B4B]">{result.message}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={`/mock-interviews/${slug}`}
              className="inline-flex h-11 items-center justify-center rounded-[12px] bg-[#E05226] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#C9411C]"
            >
              Take this interview
            </Link>
            <Link
              href="/mock-interviews"
              className="inline-flex h-11 items-center rounded-[12px] border border-[#E0E0E0] px-5 text-sm text-[#4B4B4B] transition-colors hover:border-[#8F8F8F] hover:text-[#111111]"
            >
              All mock interviews
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <MockInterviewReportView
            report={result.data.report}
            generatedAt={result.data.generatedAt}
            proctoring={proctoring}
          />
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={`/mock-interviews/${result.data.domainSlug}`}
              className="inline-flex h-11 items-center justify-center rounded-[12px] bg-[#E05226] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#C9411C]"
            >
              About this interview
            </Link>
            <Link
              href="/mock-interviews/history"
              className="inline-flex h-11 items-center rounded-[12px] border border-[#E0E0E0] px-5 text-sm text-[#4B4B4B] transition-colors hover:border-[#8F8F8F] hover:text-[#111111]"
            >
              All attempts
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
