import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { getHistory } from "@/features/interview/platform/service";
import { resolvePlatformUserId } from "@/features/interview/platform/provider";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your Practice History | ABTalks",
};

/**
 * Every attempt this user has made, newest first.
 *
 * The catalogue answers "what can I practise"; this answers "what have I
 * practised, and how did it go". They are separate pages because retakes make
 * the second a LIST rather than a status: a user can hold five attempts at one
 * domain, each with its own report, and none of them supersedes another.
 *
 * Server Component. `getHistory` is user-scoped at the query level.
 */

const STATUS_STYLE: Record<string, string> = {
  COMPLETED:
    "border-[#1A7F37]/40 bg-[#1A7F37]/10 text-[#1A7F37]",
  ABANDONED: "border-[#E0E0E0] bg-[#F5F5F5] text-[#8F8F8F]",
  INVALID: "border-[#E0E0E0] bg-[#F5F5F5] text-[#8F8F8F]",
};

const STATUS_LABEL: Record<string, string> = {
  COMPLETED: "Completed",
  ABANDONED: "Left early",
  INVALID: "Not scored",
};

export default async function MockInterviewHistoryPage() {
  const userId = await resolvePlatformUserId();
  if (!userId) redirect("/login");

  const result = await getHistory(userId);
  const attempts = result.ok ? result.data : [];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 md:py-14">
      <Link
        href="/mock-interviews"
        className="inline-flex items-center gap-1.5 text-[13px] text-[#4B4B4B] transition-colors hover:text-[#111111]"
      >
        <ArrowLeft className="size-3.5" strokeWidth={2} />
        All mock interviews
      </Link>

      <header className="mt-5">
        <h1 className="font-display text-3xl font-bold tracking-tight text-[#111111]">
          Your practice history
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[#4B4B4B]">
          Each interview you finish keeps its own report.
        </p>
      </header>

      {attempts.length === 0 ? (
        <div className="mt-8 rounded-[16px] border border-[#E0E0E0] bg-[#FFF5F0] p-6 text-center">
          <p className="text-sm text-[#4B4B4B]">
            You haven&rsquo;t finished a mock interview yet.
          </p>
          <Link
            href="/mock-interviews"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-[12px] bg-[#E05226] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#C9411C]"
          >
            Choose an interview
          </Link>
        </div>
      ) : (
        <ul className="mt-8 space-y-3">
          {attempts.map((a) => (
            <li
              key={a.id}
              className="rounded-[16px] border border-[#E0E0E0] bg-white p-5 transition-colors hover:border-[#E05226]/40"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold text-[#111111]">
                    {a.domainLabel}
                  </h2>
                  <p className="mt-1 text-[13px] text-[#8F8F8F]">
                    Attempt {a.attemptNumber}
                    {" · "}
                    {a.createdAt.toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    {a.durationSec ? ` · ${Math.round(a.durationSec / 60)} min` : ""}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {a.status === "COMPLETED" && a.overallScore !== null ? (
                    <span className="text-[15px] font-bold text-[#111111]">
                      {(a.overallScore / 10).toFixed(1)}
                      <span className="text-[13px] font-normal text-[#8F8F8F]">
                        /10
                      </span>
                    </span>
                  ) : null}
                  <span
                    className={`inline-flex rounded-[4px] border px-2.5 py-1 text-[11px] font-semibold ${
                      STATUS_STYLE[a.status] ?? STATUS_STYLE.INVALID
                    }`}
                  >
                    {STATUS_LABEL[a.status] ?? a.status}
                  </span>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                {a.hasReport ? (
                  <Link
                    href={`/mock-interviews/${a.domainSlug}/attempt/${a.id}/report`}
                    className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#E05226] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#C9411C]"
                  >
                    <FileText className="size-3.5" strokeWidth={2} />
                    View report
                  </Link>
                ) : (
                  <span className="text-[13px] text-[#8F8F8F]">
                    No report — this attempt wasn&rsquo;t scored.
                  </span>
                )}
                <Link
                  href={`/mock-interviews/${a.domainSlug}`}
                  className="text-[13px] text-[#4B4B4B] underline underline-offset-4 transition-colors hover:text-[#111111]"
                >
                  About this interview
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
