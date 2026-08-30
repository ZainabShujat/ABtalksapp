"use client";

import { useState } from "react";
import type {
  CohortInterviewOverview,
  FinishInterviewData,
} from "@/features/interview/provider";
import { BLUEPRINT_LABEL } from "@/features/interview/cohort/blueprint";
import { StageEligibility } from "@/components/interview/stage-eligibility";
import { StageIdentity } from "@/components/interview/stage-identity";
import { StageDeviceCheck } from "@/components/interview/stage-device-check";
import { StageLive } from "@/components/interview/stage-live";
import { StageResult } from "@/components/interview/stage-result";

export type JourneyStage =
  | "eligibility"
  | "identity"
  | "devices"
  | "live"
  | "result";

const STEPS: { id: JourneyStage; label: string }[] = [
  { id: "eligibility", label: "Eligibility" },
  { id: "identity", label: "Identity" },
  { id: "devices", label: "Camera & mic" },
  { id: "live", label: "Interview" },
  { id: "result", label: "Result" },
];

function StepRail({ stage }: { stage: JourneyStage }) {
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

export function InterviewJourney({
  overview,
  candidateName,
}: {
  overview: CohortInterviewOverview;
  candidateName: string;
}) {
  const [stage, setStage] = useState<JourneyStage>("eligibility");
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [result, setResult] = useState<FinishInterviewData | null>(null);

  return (
    <div>
      <header className="mb-8">
        <span className="kicker">AI Cohort interview</span>
        <h1 className="mt-3 text-[clamp(28px,3.4vw,40px)] font-extrabold leading-[1.1] tracking-[-0.015em]">
          {BLUEPRINT_LABEL[overview.blueprint]}
        </h1>
        <p className="mt-4 max-w-[68ch] text-[15.5px] leading-7 text-foreground/78">
          Every candidate at this milestone answers the same {overview.questionCount}{" "}
          questions and is measured against the same five competencies, so scores
          compare like for like. The questions come only from cohort curriculum
          you have completed.
        </p>
      </header>

      <hr className="rule2 mb-8" />

      <StepRail stage={stage} />

      {stage === "eligibility" && (
        <StageEligibility
          overview={overview}
          onProceed={() => setStage("identity")}
        />
      )}

      {stage === "identity" && (
        <StageIdentity
          candidateName={candidateName}
          onBack={() => setStage("eligibility")}
          onVerifiedAction={() => setStage("devices")}
        />
      )}

      {stage === "devices" && (
        <StageDeviceCheck
          onBack={() => setStage("identity")}
          onReadyAction={() => setStage("live")}
        />
      )}

      {stage === "live" && (
        <StageLive
          blueprint={overview.blueprint}
          interviewId={interviewId}
          onInterviewOpenAction={(id) => setInterviewId(id)}
          onFinishedAction={(data) => {
            setResult(data);
            setStage("result");
          }}
          onAbandonedAction={() => {
            setInterviewId(null);
            setStage("eligibility");
          }}
        />
      )}

      {stage === "result" && <StageResult result={result} />}
    </div>
  );
}
