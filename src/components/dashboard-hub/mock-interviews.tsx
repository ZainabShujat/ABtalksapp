import Link from "next/link";
import { FileText, History, Mic } from "lucide-react";
import type { HistoryEntry } from "@/features/interview/platform/service";
import {
  HUB_BUTTON_CLASS,
  HUB_CARD_HOVER_CLASS,
} from "@/components/dashboard-hub/nav-items";
import { cn } from "@/lib/utils";

/** How many recent attempts the dashboard shows before deferring to history. */
const PREVIEW_COUNT = 3;

const STATUS_LABEL: Record<string, string> = {
  COMPLETED: "Completed",
  ABANDONED: "Left early",
  INVALID: "Not scored",
};

type Props = {
  /** Newest first. Already user-scoped by the caller. */
  attempts: HistoryEntry[];
};

/**
 * Mock interviews on the hub, directly under the heatmap.
 *
 * The heatmap and Continue your journey are both about the 60-day tracks; this
 * is the one surface on the hub for the AI agent interviews, which are open to
 * every registered user and belong to no track. It carries both entry points —
 * the catalogue and the history — because those answer different questions
 * ("what can I practise" vs "how did the last one go") and neither is reachable
 * from the sidebar today.
 *
 * Server Component: it renders data and links, nothing interactive.
 */
export function MockInterviews({ attempts }: Props) {
  const recent = attempts.slice(0, PREVIEW_COUNT);

  return (
    <section
      id="mock-interviews"
      className="scroll-mt-20 px-4 py-8 sm:px-6 lg:ml-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-xl font-semibold uppercase text-[#e05226]">
          AI agent interviews
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/mock-interviews" className={HUB_BUTTON_CLASS}>
            <Mic className="mr-1.5 size-4" strokeWidth={2} aria-hidden />
            Start a mock interview
          </Link>
          <Link href="/mock-interviews/history" className={HUB_BUTTON_CLASS}>
            <History className="mr-1.5 size-4" strokeWidth={2} aria-hidden />
            Practice history
          </Link>
        </div>
      </div>

      {recent.length === 0 ? (
        <div
          className={cn(
            "mt-4 rounded-2xl border border-neutral-200 bg-white p-6",
            HUB_CARD_HOVER_CLASS,
          )}
        >
          <p className="text-[#555555]">
            Practise a live voice interview with an AI interviewer, then read a
            scored report on how it went. Open to every ABTalks member — no
            cohort enrolment needed.
          </p>
        </div>
      ) : (
        <ul className="no-scrollbar mt-4 flex gap-4 overflow-x-auto pb-1 snap-x snap-mandatory 2xl:grid 2xl:grid-cols-3 2xl:overflow-visible 2xl:pb-0 2xl:snap-none">
          {recent.map((a) => (
            <li
              key={a.id}
              className={cn(
                "flex w-[min(100%,320px)] shrink-0 snap-start flex-col rounded-2xl border border-neutral-200 bg-white p-5 sm:w-[300px] 2xl:w-full 2xl:max-w-none 2xl:shrink",
                HUB_CARD_HOVER_CLASS,
              )}
            >
              <div className="flex min-h-0 flex-1 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-inter font-bold text-black">
                    {a.domainLabel}
                  </p>
                  <p className="mt-1 text-sm text-[#555555]">
                    Attempt {a.attemptNumber}
                    {" · "}
                    {a.createdAt.toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                    {" · "}
                    {STATUS_LABEL[a.status] ?? a.status}
                  </p>
                </div>
                {a.status === "COMPLETED" && a.overallScore !== null ? (
                  <span className="shrink-0 text-[15px] font-bold text-black">
                    {(a.overallScore / 10).toFixed(1)}
                    <span className="text-[13px] font-normal text-[#8F8F8F]">
                      /10
                    </span>
                  </span>
                ) : null}
              </div>

              {a.hasReport ? (
                <Link
                  href={`/mock-interviews/${a.domainSlug}/attempt/${a.id}/report`}
                  className={cn(HUB_BUTTON_CLASS, "mt-4 w-full")}
                >
                  <FileText className="mr-1.5 size-4" strokeWidth={2} aria-hidden />
                  View report
                </Link>
              ) : (
                <p className="mt-4 text-sm text-[#8F8F8F]">
                  This attempt wasn&rsquo;t scored.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
