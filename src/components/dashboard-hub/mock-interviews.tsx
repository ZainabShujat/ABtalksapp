import Link from "next/link";
import { FileText, History, Mic } from "lucide-react";
import {
  HUB_BUTTON_CLASS,
  HUB_CARD_HOVER_CLASS,
} from "@/components/dashboard-hub/nav-items";
import { cn } from "@/lib/utils";

/** A mock interview this user can open right now. */
export type AvailableMockInterview = {
  slug: string;
  label: string;
  blurb: string;
  durationSec: number;
  questionCount: number;
  /** Completed attempts so far — drives "Take again" vs "Start interview". */
  completedAttempts: number;
  /** Attempts remaining under the domain's cap. `null` means uncapped. */
  attemptsLeft: number | null;
  /**
   * The newest attempt of this domain that has a report, if any.
   *
   * Carried so the card can offer the report alongside a retake: a candidate
   * who has done this interview usually wants to read what it said before
   * deciding to sit it again, and making them go via the history page to do
   * that is a detour through a list they did not need.
   */
  latestReportAttemptId: string | null;
};

/**
 * A cohort interview this user is eligible for right now.
 *
 * Only ever built for milestones that are unlocked and not yet taken, because
 * a cohort interview is one-shot: a taken one is not something the candidate
 * "can give", and a locked one is not either.
 */
export type AvailableCohortInterview = {
  key: string;
  label: string;
  blurb: string;
  href: string;
  /** An attempt is already open — the CTA resumes rather than starts. */
  inProgress: boolean;
};

type Props = {
  mock: AvailableMockInterview[];
  cohort: AvailableCohortInterview[];
};

function minutes(sec: number): string {
  return `${Math.round(sec / 60)} min`;
}

const CARD_CLASS =
  "flex w-[min(100%,320px)] shrink-0 snap-start flex-col rounded-2xl border border-neutral-200 bg-white p-5 sm:w-[300px] 2xl:w-full 2xl:max-w-none 2xl:shrink";

/**
 * Interviews the candidate can take, on the hub, directly under the heatmap.
 *
 * This is an OFFER, not a record: it lists what is open to them right now.
 * Past attempts live on the practice history page, linked from the header —
 * showing them here answered "what have I done" when the question the hub is
 * asking is "what can I do next".
 *
 * Cohort milestones are listed alongside the open mock interviews because from
 * the candidate's side they are the same act. They are filtered by the caller
 * to the ones actually startable, so a locked or already-taken milestone never
 * appears — this section must never look like a gate.
 *
 * Server Component: data and links only.
 */
export function MockInterviews({ mock, cohort }: Props) {
  const hasAny = mock.length > 0 || cohort.length > 0;

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
            All mock interviews
          </Link>
          <Link href="/mock-interviews/history" className={HUB_BUTTON_CLASS}>
            <History className="mr-1.5 size-4" strokeWidth={2} aria-hidden />
            Practice history
          </Link>
        </div>
      </div>

      {!hasAny ? (
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
          {/* Cohort milestones first: they are time-bound and one-shot, so a
              candidate who is eligible for one should not have to scroll. */}
          {cohort.map((c) => (
            <li key={c.key} className={cn(CARD_CLASS, HUB_CARD_HOVER_CLASS)}>
              <div className="min-h-0 flex-1">
                <span className="inline-flex rounded-[4px] border border-[#E05226]/40 bg-[#FFF5F0] px-2 py-0.5 text-[11px] font-semibold text-[#E05226]">
                  AI Cohort
                </span>
                <p className="mt-2 font-inter font-bold text-black">{c.label}</p>
                <p className="mt-1 text-sm text-[#555555]">{c.blurb}</p>
              </div>
              <Link
                href={c.href}
                className={cn(HUB_BUTTON_CLASS, "mt-4 w-full")}
              >
                {c.inProgress ? "Resume interview" : "Start interview"}
              </Link>
            </li>
          ))}

          {mock.map((m) => (
            <li key={m.slug} className={cn(CARD_CLASS, HUB_CARD_HOVER_CLASS)}>
              <div className="min-h-0 flex-1">
                <p className="font-inter font-bold text-black">{m.label}</p>
                <p className="mt-1 text-sm text-[#555555]">{m.blurb}</p>
                <p className="mt-2 text-[13px] text-[#8F8F8F]">
                  {minutes(m.durationSec)} · {m.questionCount} questions
                  {m.completedAttempts > 0
                    ? ` · ${m.completedAttempts} taken`
                    : ""}
                  {m.attemptsLeft !== null && m.attemptsLeft > 0
                    ? ` · ${m.attemptsLeft} left`
                    : ""}
                </p>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                {m.latestReportAttemptId ? (
                  <Link
                    href={`/mock-interviews/${m.slug}/attempt/${m.latestReportAttemptId}/report`}
                    className={cn(HUB_BUTTON_CLASS, "w-full")}
                  >
                    <FileText
                      className="mr-1.5 size-4"
                      strokeWidth={2}
                      aria-hidden
                    />
                    View last report
                  </Link>
                ) : null}

                {m.attemptsLeft === null || m.attemptsLeft > 0 ? (
                  <Link
                    href={`/mock-interviews/${m.slug}`}
                    className={cn(HUB_BUTTON_CLASS, "w-full")}
                  >
                    {m.completedAttempts > 0 ? "Take again" : "Start interview"}
                  </Link>
                ) : (
                  <p className="text-[13px] text-[#8F8F8F]">
                    You have used all {m.completedAttempts} attempts. Your
                    reports stay available.
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
