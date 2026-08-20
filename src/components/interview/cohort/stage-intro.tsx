"use client";

import { Mic, Clock, BrainCircuit, FileCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InterviewBlueprintKey } from "@/features/interview/cohort-eligibility";

/**
 * SCREEN 1 — Introduction.
 *
 * Sets expectations before the candidate enters the interview flow.
 * Uses standard Tailwind classes compatible with the user's theme.
 */
export function StageIntro({
  blueprint,
  dayLabel,
  title,
  onProceed,
}: {
  blueprint: InterviewBlueprintKey;
  dayLabel: string;
  title: string;
  onProceed: () => void;
}) {
  const duration = blueprint === "DAY_15" ? "~12 minutes" : "~18 minutes";

  return (
    <div style={{ animation: "iv-fade-in 0.5s ease-out" }} className="space-y-8">
      {/* Hero header */}
      <section className="rounded-2xl bg-foreground text-background px-6 py-10 md:px-10 md:py-14 shadow-lg">
        <span className="block text-[13px] font-extrabold uppercase leading-[14px] tracking-[0.08em] text-background/70">
          AI Cohort Interview
        </span>
        <h1
          className="mt-4 font-extrabold tracking-tight text-background"
          style={{
            fontSize: "clamp(32px, 5vw, 56px)",
            lineHeight: 1.08,
            marginLeft: "-0.04em",
          }}
        >
          {dayLabel} Assessment
        </h1>
        <p className="mt-5 max-w-[58ch] text-[16.5px] leading-7 text-background/85">
          This is a conversational assessment of the work you completed during the
          cohort. An AI interviewer will guide you through a technical conversation
          about your implementations and understanding.
        </p>
      </section>

      {/* Key details grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="size-4" strokeWidth={2} />
            <span className="text-[13px] font-bold uppercase tracking-[0.06em]">
              Duration
            </span>
          </div>
          <span className="mt-3 block text-[20px] font-extrabold leading-6 tracking-tight text-foreground">
            {duration}
          </span>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Mic className="size-4" strokeWidth={2} />
            <span className="text-[13px] font-bold uppercase tracking-[0.06em]">
              Format
            </span>
          </div>
          <span className="mt-3 block text-[20px] font-extrabold leading-6 tracking-tight text-foreground">
            Voice
          </span>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <BrainCircuit className="size-4" strokeWidth={2} />
            <span className="text-[13px] font-bold uppercase tracking-[0.06em]">
              Based on
            </span>
          </div>
          <span className="mt-3 block text-[20px] font-extrabold leading-6 tracking-tight text-foreground">
            Your work
          </span>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileCheck className="size-4" strokeWidth={2} />
            <span className="text-[13px] font-bold uppercase tracking-[0.06em]">
              Output
            </span>
          </div>
          <span className="mt-3 block text-[20px] font-extrabold leading-6 tracking-tight text-foreground">
            Assessment
          </span>
        </div>
      </div>

      {/* What to expect */}
      <section className="rounded-2xl border bg-card px-6 py-8 md:p-10 shadow-sm">
        <div className="inline-block rounded bg-primary/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-primary mb-6">
          What to expect
        </div>
        <ul className="space-y-4 text-[15.5px] leading-7 text-muted-foreground">
          <li className="flex gap-4 items-start">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-extrabold text-foreground">
              1
            </span>
            <span>
              A microphone is required. The interviewer speaks and listens through voice.
            </span>
          </li>
          <li className="flex gap-4 items-start">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-extrabold text-foreground">
              2
            </span>
            <span>
              Questions are grounded in the cohort curriculum you have completed.
            </span>
          </li>
          <li className="flex gap-4 items-start">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-extrabold text-foreground">
              3
            </span>
            <span>
              Your responses are evaluated across five competencies. A final assessment
              report is generated after the interview.
            </span>
          </li>
          <li className="flex gap-4 items-start">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-extrabold text-foreground">
              4
            </span>
            <span>
              The interviewer may ask follow-up questions to explore your
              understanding more deeply.
            </span>
          </li>
        </ul>
      </section>

      {/* CTA */}
      <div className="pt-2">
        <Button
          type="button"
          size="lg"
          className="w-full sm:w-auto px-10 py-6 text-[16px] font-bold shadow-md hover:shadow-lg transition-all"
          onClick={onProceed}
        >
          Start Interview
        </Button>
      </div>
    </div>
  );
}
