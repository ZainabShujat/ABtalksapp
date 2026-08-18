"use client";

import { useState } from "react";
import type { InterviewBlueprintKey } from "@/features/interview/cohort-eligibility";
import type { FinishInterviewData } from "@/features/interview/provider";
import { StageResult } from "@/components/interview/stage-result";
import { StageConsent } from "@/components/interview/cohort/stage-consent";
import { StageSystemCheck } from "@/components/interview/cohort/stage-system-check";
import { StageReady } from "@/components/interview/cohort/stage-ready";
import { StageLiveVoice } from "@/components/interview/cohort/stage-live-voice";

export type CohortJourneyStage =
  | "consent"
  | "devices"
  | "ready"
  | "live"
  | "result";

const STEPS: { id: CohortJourneyStage; label: string }[] = [
  { id: "consent", label: "Rules" },
  { id: "devices", label: "System check" },
  { id: "ready", label: "Ready" },
  { id: "live", label: "Interview" },
  { id: "result", label: "Result" },
];

function StepRail({ stage }: { stage: CohortJourneyStage }) {
  const activeIndex = STEPS.findIndex((s) => s.id === stage);

  return (
    <ol className="lattice mb-10 grid grid-cols-2 sm:grid-cols-5">
      {STEPS.map((step, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <li key={step.id} className="px-4 py-3">
            <span
              className="block text-[13px] font-extrabold leading-[14px] tracking-[0.08em]"
              style={{
                color: active
                  ? "var(--color-accent-700)"
                  : done
                    ? "hsl(var(--foreground) / 0.7)"
                    : "hsl(var(--foreground) / 0.4)",
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span
              className="mt-1 block text-[15px] leading-6"
              style={{
                color: active || done
                  ? "hsl(var(--foreground))"
                  : "hsl(var(--foreground) / 0.45)",
                fontWeight: active ? 800 : 400,
              }}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function CohortInterviewJourney({
  blueprint,
  candidateName,
}: {
  blueprint: InterviewBlueprintKey;
  candidateName: string;
}) {
  const [stage, setStage] = useState<CohortJourneyStage>("consent");
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [result, setResult] = useState<FinishInterviewData | null>(null);

  const title = blueprint === "DAY_15" ? "Day 15 Checkpoint" : "Day 31 Final Interview";

  return (
    <div>
      <header className="mb-8">
        <span className="kicker">AI Cohort Interview</span>
        <h1 className="mt-3 text-[clamp(28px,3.4vw,40px)] font-extrabold leading-[1.1] tracking-[-0.015em]">
          {title}
        </h1>
        <p className="mt-4 max-w-[68ch] text-[15.5px] leading-7 text-foreground/78">
          A voice-based conversation to assess your understanding of the cohort material so far.
        </p>
      </header>

      <hr className="rule2 mb-8" />

      <StepRail stage={stage} />

      {stage === "consent" && (
        <StageConsent
          blueprint={blueprint}
          onProceed={() => setStage("devices")}
        />
      )}

      {stage === "devices" && (
        <StageSystemCheck
          onBack={() => setStage("consent")}
          onReadyAction={() => setStage("ready")}
        />
      )}

      {stage === "ready" && (
        <StageReady
          onBack={() => setStage("devices")}
          onBeginAction={() => setStage("live")}
        />
      )}

      {stage === "live" && (
        <StageLiveVoice
          blueprint={blueprint}
          interviewId={interviewId}
          onInterviewOpenAction={(id) => setInterviewId(id)}
          onFinishedAction={(data) => {
            setResult(data);
            setStage("result");
          }}
          onAbandonedAction={() => {
            setInterviewId(null);
            setStage("consent");
          }}
        />
      )}

      {stage === "result" && <StageResult result={result} />}
    </div>
  );
}
