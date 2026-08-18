"use client";

import { Button } from "@/components/ui/button";
import { RUBRIC } from "@/features/interview/rubric";
import type { CohortInterviewOverview } from "@/features/interview/provider";

/**
 * Stage 1 — whether this milestone is open, and on what terms.
 *
 * Retargeted from the general interviewer's retake model (attempt numbers,
 * consumed submission ids, "30 new days to retake") to the cohort's milestone
 * model: each blueprint is claimable exactly once, and it unlocks only when
 * every day in its scope has actually been passed.
 *
 * Every branch states the exact shortfall rather than a vague "not yet". The
 * displayed state is advisory — the server re-derives eligibility before it will
 * open an attempt, so nothing here can unlock anything.
 */
export function StageEligibility({
  overview,
  onProceed,
}: {
  overview: CohortInterviewOverview;
  onProceed: () => void;
}) {
  const { eligibility, questionCount, result } = overview;
  const ready =
    eligibility.state === "ready" || eligibility.state === "in_progress";

  const passedCount =
    eligibility.state === "locked" ? eligibility.passedCount : null;
  const neededCount =
    eligibility.state === "locked" ? eligibility.needed : null;

  return (
    <div>
      <div className="lattice grid grid-cols-1 sm:grid-cols-3">
        <div className="px-5 py-6">
          <span className="kicker">Days required</span>
          <span
            className="mt-2 block font-extrabold tracking-[-0.03em] text-primary"
            style={{ fontSize: "clamp(34px, 3.4vw, 48px)", marginLeft: "-0.045em" }}
          >
            {neededCount ?? (overview.blueprint === "DAY_15" ? 15 : 31)}
          </span>
        </div>
        <div className="px-5 py-6">
          <span className="kicker">Questions</span>
          <span
            className="mt-2 block font-extrabold tracking-[-0.03em] text-primary"
            style={{ fontSize: "clamp(34px, 3.4vw, 48px)", marginLeft: "-0.045em" }}
          >
            {questionCount}
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
      </div>

      <section className="mt-8 border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
        {eligibility.state === "ready" && (
          <>
            <span className="kicker">Ready</span>
            <h2 className="mt-3 text-[24px] font-extrabold leading-7 tracking-[-0.01em]">
              You can take this interview now
            </h2>
            <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
              Every candidate at this milestone answers the same {questionCount}{" "}
              questions, drawn only from cohort days you have completed. It can
              be taken once — but leaving early does not consume it.
            </p>
          </>
        )}

        {eligibility.state === "locked" && (
          <>
            <span className="kicker">Locked</span>
            <h2 className="mt-3 text-[24px] font-extrabold leading-7 tracking-[-0.01em]">
              {eligibility.missingDays.length} more{" "}
              {eligibility.missingDays.length === 1 ? "day" : "days"} to unlock
            </h2>
            <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
              You have passed {passedCount} of {neededCount} required days.
              Outstanding: {eligibility.missingDays.slice(0, 12).join(", ")}
              {eligibility.missingDays.length > 12 ? "…" : ""}.
            </p>
          </>
        )}

        {eligibility.state === "in_progress" && (
          <>
            <span className="kicker">In progress</span>
            <h2 className="mt-3 text-[24px] font-extrabold leading-7 tracking-[-0.01em]">
              You have this interview open
            </h2>
            <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
              {eligibility.startedAt
                ? `Started ${new Date(eligibility.startedAt).toLocaleString()}. `
                : ""}
              Continuing picks up where you left off — it does not start a new
              attempt, and leaving does not consume the milestone.
            </p>
          </>
        )}

        {eligibility.state === "taken" && (
          <>
            <span className="kicker">Completed</span>
            <h2 className="mt-3 text-[24px] font-extrabold leading-7 tracking-[-0.01em]">
              {eligibility.overallScore !== null
                ? `You scored ${eligibility.overallScore}/100`
                : "Your result is being scored"}
            </h2>
            <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
              This milestone is claimed. It is taken once and does not repeat.
            </p>
          </>
        )}

        <div className="mt-6">
          <Button type="button" disabled={!ready} onClick={onProceed}>
            {ready
              ? eligibility.state === "in_progress"
                ? "Resume interview"
                : "Begin identity check"
              : "Not available"}
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

      {result && (
        <section className="mt-8 border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
          <span className="kicker">Your result</span>
          <p className="mt-3 text-[15.5px] leading-7 text-foreground/78">
            Scored{" "}
            <strong className="font-extrabold text-foreground">
              {result.overallScore}/100
            </strong>
            {result.summary ? ` — ${result.summary}` : "."}
          </p>
        </section>
      )}
    </div>
  );
}
