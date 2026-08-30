"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { RUBRIC } from "@/features/interview/rubric";
import { BLUEPRINT_LABEL } from "@/features/interview/cohort/blueprint";
import type { FinishInterviewData } from "@/features/interview/provider";
import type { EvidenceTier } from "@/features/interview/types";

const TIER_LABEL: Record<EvidenceTier, string> = {
  NONE: "No evidence",
  CLAIMED: "Claimed",
  EXPLAINED: "Explained",
  DEMONSTRATED: "Demonstrated",
};

/**
 * Stage 5 — the result.
 *
 * Shows the tier behind every score, not just the number: the tier is what the
 * evaluator actually decided, and the number is arithmetic on top of it.
 */
export function StageResult({ result }: { result: FinishInterviewData | null }) {
  if (!result) {
    return (
      <section className="border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
        <span className="kicker">No result</span>
        <h2 className="mt-3 text-[24px] font-extrabold leading-7 tracking-[-0.01em]">
          This interview did not produce a score
        </h2>
        <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
          Your milestone was not consumed. You can start again.
        </p>
      </section>
    );
  }

  const { scores, blueprint } = result;
  const labelFor = (competency: string) =>
    RUBRIC.find((r) => r.competency === competency)?.label ?? competency;
  const weightFor = (competency: string) =>
    RUBRIC.find((r) => r.competency === competency)?.weight ?? 0;

  return (
    <div>
      <section className="poster px-6 py-8">
        <span
          className="block text-[13px] font-extrabold uppercase leading-[14px] tracking-[0.08em]"
          style={{ color: "hsl(var(--background) / 0.8)" }}
        >
          {BLUEPRINT_LABEL[blueprint]} · Overall
        </span>
        <span
          className="mt-3 block font-extrabold tracking-[-0.03em]"
          style={{
            fontSize: "clamp(40px, 5.8vw, 78px)",
            lineHeight: 1.06,
            marginLeft: "-0.058em",
          }}
        >
          {scores.overallScore}
          <span className="text-[0.4em]">/100</span>
        </span>
        {scores.summary && (
          <p
            className="mt-4 max-w-[62ch] text-[16px] leading-7"
            style={{ color: "hsl(var(--background) / 0.9)" }}
          >
            {scores.summary}
          </p>
        )}
      </section>

      <section className="mt-8">
        <span className="kicker">By competency</span>
        <div className="lattice mt-4 grid grid-cols-1">
          {scores.perCompetency.map((entry) => (
            <div
              key={entry.competency}
              className="flex flex-wrap items-baseline gap-x-6 gap-y-2 px-5 py-5"
            >
              <span className="w-[240px] shrink-0 text-[16px] font-extrabold leading-7">
                {labelFor(entry.competency)}
                <span className="ml-2 font-normal text-foreground/60">
                  {weightFor(entry.competency)}%
                </span>
              </span>

              <span className="w-[150px] shrink-0 text-[15px] leading-6 text-foreground/70">
                {TIER_LABEL[entry.tier]}
              </span>

              <span className="flex-1 min-w-[140px]">
                <span className="block h-3 w-full border-2 border-[hsl(var(--divider)/0.4)]">
                  <span
                    className="block h-full bg-primary"
                    style={{ width: `${entry.score}%` }}
                  />
                </span>
              </span>

              <span className="w-[64px] shrink-0 text-right text-[16px] font-extrabold leading-7">
                {entry.score}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
        <span className="kicker">What happens to this</span>
        <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
          This score is yours. It is not shown to recruiters unless you choose to
          release it. Your next attempt opens once you complete 30 new challenge
          days — from any challenge, in any combination. Waiting does not unlock
          it.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/dashboard" className={buttonVariants()}>
            Back to dashboard
          </Link>
          <Link href="/interview" className={buttonVariants({ variant: "outline" })}>
            View interview status
          </Link>
        </div>
      </section>
    </div>
  );
}
