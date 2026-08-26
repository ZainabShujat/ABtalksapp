"use client";

import { useState } from "react";
import Link from "next/link";
import { HelpCircle, History, ListChecks } from "lucide-react";
import { dsButtonVariants } from "@/components/design/ds-button";
import { ClaudeCollapsiblePanel } from "@/components/claude/claude-collapsible-panel";
import { ClaudeDayList } from "@/components/claude/claude-day-list";
import { ClaudeFaqBody } from "@/components/shared/claude-faq";
import type { HeatmapCell } from "@/features/dashboard/get-heatmap-data";
import type { AvailableQuizPayload } from "@/features/quiz/get-available-quiz";
import type { QuizHistoryRow } from "@/features/quiz/get-quiz-attempt-history";
import { formatDateIST } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

export type ClaudeContinueInfo = {
  mode: "start" | "continue" | "caught_up" | "complete";
  dayNumber: number | null;
  title: string | null;
};

type RecentSubmission = {
  id: string;
  dayNumber: number;
  status: string;
  submittedAt: Date | string;
};

type Props = {
  enrollmentId: string;
  currentDay: number;
  totalDays: number;
  daysCompleted: number;
  cells: HeatmapCell[];
  continueInfo: ClaudeContinueInfo;
  recentSubmissions: RecentSubmission[];
  quizAvailability: AvailableQuizPayload;
  quizHistory: QuizHistoryRow[];
  isReadyForInterview: boolean;
};

const ctaClass = dsButtonVariants({ size: "lg" });

export function ClaudeChallengeView({
  enrollmentId,
  currentDay,
  totalDays,
  daysCompleted,
  cells,
  continueInfo,
  recentSubmissions,
  quizAvailability,
  quizHistory,
  isReadyForInterview,
}: Props) {
  const quizReady = quizAvailability.reason === "ready";
  const [faqsOpen, setFaqsOpen] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(quizReady);

  const dayLink =
    continueInfo.dayNumber != null
      ? `/claude/day/${continueInfo.dayNumber}?challenge=${encodeURIComponent(enrollmentId)}`
      : null;

  return (
    <div className="bg-[#FBF9F7] px-5 pt-3 pb-8 font-content text-[#111111] sm:px-8 sm:pt-4">
      <div className="mx-auto w-full max-w-[1500px] space-y-6">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            <li>
              <Link
                href="/dashboard"
                className="text-[#8F8F8F] hover:text-[#E05226]"
              >
                Dashboard
              </Link>
            </li>
            <li aria-hidden className="text-[#8F8F8F]">
              &gt;
            </li>
            <li aria-current="page" className="font-semibold text-[#111111]">
              Claude Challenge
            </li>
          </ol>
        </nav>

        <header>
          <h1 className="font-heading text-[32px] leading-9 font-semibold text-[#111111] md:text-[40px] md:leading-[48px]">
            Claude Challenge
          </h1>
          <p className="mt-2 text-[17px] leading-7 text-[#4B4B4B]">
            Master Claude with a 60-day learning journey. Complete your daily tasks, submit your proof of work, and take weekly quizzes.
          </p>
        </header>

        <ContinueCard
          continueInfo={continueInfo}
          dayLink={dayLink}
          totalDays={totalDays}
          isReadyForInterview={isReadyForInterview}
        />

        <ClaudeDayList
          cells={cells}
          currentDay={currentDay}
          enrollmentId={enrollmentId}
        />

        <ClaudeCollapsiblePanel
          id="claude-faqs"
          title="FAQs"
          icon={HelpCircle}
          open={faqsOpen}
          onOpenChange={setFaqsOpen}
        >
          <ClaudeFaqBody />
        </ClaudeCollapsiblePanel>

        <ClaudeCollapsiblePanel
          id="claude-recent-runs"
          title="Recent Runs"
          icon={History}
          open={runsOpen}
          onOpenChange={setRunsOpen}
        >
          {recentSubmissions.length === 0 ? (
            <p className="text-[17px] leading-7 text-[#4B4B4B]">
              No submissions yet. Complete Day 1 to get started.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {recentSubmissions.map((s) => {
                const submittedAt =
                  typeof s.submittedAt === "string"
                    ? new Date(s.submittedAt)
                    : s.submittedAt;
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-[#E0E0E0] bg-[#FBF9F7] px-4 py-3"
                  >
                    <span>
                      <span className="font-medium text-[#111111]">
                        Day {s.dayNumber}
                      </span>
                      <span className="text-[#8F8F8F]">
                        {" "}
                        · completed on {formatDateIST(submittedAt)} ·{" "}
                        {s.status === "ON_TIME" || s.status === "LATE"
                          ? "on time"
                          : "late"}
                      </span>
                    </span>
                    <Link
                      href={`/claude/day/${s.dayNumber}?challenge=${encodeURIComponent(enrollmentId)}`}
                      className="text-[14px] text-[#E05226] hover:underline"
                    >
                      View
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </ClaudeCollapsiblePanel>

        <ClaudeCollapsiblePanel
          id="claude-quiz-history"
          title="Quiz History"
          icon={ListChecks}
          open={quizOpen}
          onOpenChange={setQuizOpen}
        >
          <div className="space-y-4">
            {quizReady && quizAvailability.quiz ? (
              <div className="rounded-[12px] border border-[#E0E0E0] bg-[#FBF9F7] px-5 py-4">
                <p className="font-heading text-lg font-semibold text-[#111111]">
                  Week {quizAvailability.quiz.weekNumber} quiz available
                </p>
                <p className="mt-1 text-sm text-[#4B4B4B]">
                  {quizAvailability.quiz.title}
                </p>
                <Link
                  href={`/quiz/${quizAvailability.quiz.id}`}
                  className={cn(dsButtonVariants({ size: "sm" }), "mt-3 inline-flex")}
                >
                  Take quiz
                </Link>
              </div>
            ) : null}

            {quizAvailability.reason === "already_attempted" &&
            quizAvailability.attempt?.quiz ? (
              <div className="rounded-[12px] border border-[#E0E0E0] bg-[#FBF9F7] px-5 py-4">
                <p className="text-sm text-[#4B4B4B]">
                  Week {quizAvailability.attempt.quiz.weekNumber} quiz: scored{" "}
                  {quizAvailability.attempt.score}/10
                </p>
                <Link
                  href={`/quiz/${quizAvailability.attempt.quiz.id}`}
                  className="mt-2 inline-block text-[14px] text-[#E05226] hover:underline"
                >
                  View results
                </Link>
              </div>
            ) : null}

            {quizHistory.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {quizHistory.map((row) => (
                  <li
                    key={row.attemptId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-[#E0E0E0] bg-[#FBF9F7] px-4 py-3"
                  >
                    <span className="text-[#4B4B4B]">
                      Week {row.weekNumber}: scored {row.score}/10
                      <span className="ml-1 text-xs text-[#8F8F8F]">
                        · {row.title}
                      </span>
                    </span>
                    <Link
                      href={`/quiz/${row.quizId}`}
                      className="shrink-0 text-[14px] text-[#E05226] hover:underline"
                    >
                      View results
                    </Link>
                  </li>
                ))}
              </ul>
            ) : !quizReady &&
              quizAvailability.reason !== "already_attempted" ? (
              <p className="text-[17px] leading-7 text-[#4B4B4B]">
                No quiz attempts yet. Quizzes unlock as you complete weeks of
                the challenge ({daysCompleted} days completed).
              </p>
            ) : null}
          </div>
        </ClaudeCollapsiblePanel>
      </div>
    </div>
  );
}

function ContinueCard({
  continueInfo,
  dayLink,
  totalDays,
  isReadyForInterview,
}: {
  continueInfo: ClaudeContinueInfo;
  dayLink: string | null;
  totalDays: number;
  isReadyForInterview: boolean;
}) {
  let eyebrow: string;
  let title: string;
  let supporting: string | null = null;
  let cta: string | null = null;

  if (continueInfo.mode === "complete") {
    eyebrow = "CHALLENGE COMPLETE";
    title = "You finished the 60-day Claude Challenge";
    supporting = isReadyForInterview
      ? "Your profile is marked ready for interview opportunities."
      : "Great work — keep building on what you learned.";
  } else if (continueInfo.mode === "start" && continueInfo.dayNumber != null) {
    eyebrow = "GET STARTED";
    title = `Day ${continueInfo.dayNumber}: ${continueInfo.title ?? "Today's task"}`;
    cta = `Start Day ${continueInfo.dayNumber}`;
  } else if (
    continueInfo.mode === "continue" &&
    continueInfo.dayNumber != null
  ) {
    eyebrow = "CONTINUE WHERE YOU LEFT OFF";
    title = `Day ${continueInfo.dayNumber}: ${continueInfo.title ?? "Today's task"}`;
    cta = `Continue Day ${continueInfo.dayNumber}`;
  } else {
    eyebrow = "ALL CAUGHT UP";
    title = "You're all caught up for today";
    supporting =
      continueInfo.dayNumber != null && continueInfo.dayNumber < totalDays
        ? `Next day unlocks on the next calendar day (IST).`
        : `You've completed all ${totalDays} days.`;
  }

  return (
    <div className="rounded-2xl border border-[#E0E0E0] bg-white p-8 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] leading-[18px] font-semibold uppercase text-[#E05226]">
            {eyebrow}
          </p>
          <h2 className="mt-2 font-heading text-2xl leading-[30px] font-semibold text-[#111111]">
            {title}
          </h2>
          {supporting ? (
            <p className="mt-2 text-[17px] leading-7 text-[#4B4B4B]">
              {supporting}
            </p>
          ) : null}
        </div>
        {cta && dayLink ? (
          <Link href={dayLink} className={ctaClass}>
            {cta}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
