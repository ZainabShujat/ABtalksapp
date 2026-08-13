"use client";

import { Button } from "@/components/ui/button";
import { RUBRIC } from "@/features/interview/rubric";
import type { InterviewOverview } from "@/features/interview/provider";

/**
 * Stage 1 — what the candidate has earned, and whether it opens an attempt.
 * Every eligibility branch is stated in plain words with the exact shortfall,
 * never a vague "not yet".
 */
export function StageEligibility({
  overview,
  onProceed,
}: {
  overview: InterviewOverview;
  onProceed: () => void;
}) {
  const { eligibility, totalCompletedDays, latestResult } = overview;
  const ready = eligibility.state === "ready";

  return (
    <div>
      <div className="lattice grid grid-cols-1 sm:grid-cols-3">
        <div className="px-5 py-6">
          <span className="kicker">Completed days</span>
          <span
            className="mt-2 block font-extrabold tracking-[-0.03em] text-primary"
            style={{ fontSize: "clamp(34px, 3.4vw, 48px)", marginLeft: "-0.045em" }}
          >
            {totalCompletedDays}
          </span>
        </div>
        <div className="px-5 py-6">
          <span className="kicker">Competencies scored</span>
          <span
            className="mt-2 block font-extrabold tracking-[-0.03em] text-primary"
            style={{ fontSize: "clamp(34px, 3.4vw, 48px)", marginLeft: "-0.045em" }}
          >
            {RUBRIC.length}
          </span>
        </div>
        <div className="px-5 py-6">
          <span className="kicker">Attempt</span>
          <span
            className="mt-2 block font-extrabold tracking-[-0.03em] text-primary"
            style={{ fontSize: "clamp(34px, 3.4vw, 48px)", marginLeft: "-0.045em" }}
          >
            {eligibility.state === "ready"
              ? String(eligibility.attemptNumber).padStart(2, "0")
              : "—"}
          </span>
        </div>
      </div>

      <section className="mt-8 border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
        {eligibility.state === "ready" && (
          <>
            <span className="kicker">Ready</span>
            <h2 className="mt-3 text-[24px] font-extrabold leading-7 tracking-[-0.01em]">
              You can take the interview now
            </h2>
            <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
              This attempt draws on{" "}
              {eligibility.eligibleSubmissionIds.length} completed challenge days.
              Those days are spent when you finish, and a further 30 new days
              unlock your next attempt.
            </p>
          </>
        )}

        {eligibility.state === "locked" && (
          <>
            <span className="kicker">Locked</span>
            <h2 className="mt-3 text-[24px] font-extrabold leading-7 tracking-[-0.01em]">
              {eligibility.needed - eligibility.completedDays} more days to
              unlock
            </h2>
            <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
              {eligibility.reason}
            </p>
          </>
        )}

        {eligibility.state === "retake_locked" && (
          <>
            <span className="kicker">Retake locked</span>
            <h2 className="mt-3 text-[24px] font-extrabold leading-7 tracking-[-0.01em]">
              {eligibility.needed - eligibility.newDaysSinceLastAttempt} more new
              days to retake
            </h2>
            <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
              {eligibility.reason} Waiting does not unlock a retake — new
              completed challenge work does. Progress from any challenge counts.
            </p>
          </>
        )}

        {eligibility.state === "in_progress" && (
          <>
            <span className="kicker">In progress</span>
            <h2 className="mt-3 text-[24px] font-extrabold leading-7 tracking-[-0.01em]">
              You have an interview open
            </h2>
            <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
              Started {new Date(eligibility.startedAt).toLocaleString()}. Finish
              it, or leave it and it will be discarded without spending your
              challenge days.
            </p>
          </>
        )}

        <div className="mt-6">
          <Button type="button" disabled={!ready} onClick={onProceed}>
            {ready ? "Begin identity check" : "Not available yet"}
          </Button>
        </div>
      </section>

      <section className="mt-8">
        <span className="kicker">How you are scored</span>
        <div className="lattice mt-4 grid grid-cols-1 sm:grid-cols-2">
          {RUBRIC.map((entry, i) => (
            <div key={entry.competency} className="px-5 py-5">
              <span className="block text-[15px] font-extrabold leading-6">
                {String(i + 1).padStart(2, "0")} · {entry.label}
                <span className="ml-2 font-normal text-foreground/60">
                  {entry.weight}%
                </span>
              </span>
              <p className="mt-2 text-[15.5px] leading-7 text-foreground/78">
                {entry.expectations}
              </p>
            </div>
          ))}
        </div>
      </section>

      {latestResult && (
        <section className="mt-8 border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
          <span className="kicker">Your last attempt</span>
          <p className="mt-3 text-[15.5px] leading-7 text-foreground/78">
            Attempt {latestResult.attemptNumber} scored{" "}
            <strong className="font-extrabold text-foreground">
              {latestResult.overallScore}/100
            </strong>
            {latestResult.summary ? ` — ${latestResult.summary}` : "."}
          </p>
        </section>
      )}
    </div>
  );
}
