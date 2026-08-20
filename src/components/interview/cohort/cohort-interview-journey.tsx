"use client";

import { useState } from "react";
import type { InterviewBlueprintKey } from "@/features/interview/cohort-eligibility";
import type { FinishInterviewData } from "@/features/interview/provider";
import { BLUEPRINT_LABEL } from "@/features/interview/cohort/blueprint";
import { StageIntro } from "@/components/interview/cohort/stage-intro";
import { StageConsent } from "@/components/interview/cohort/stage-consent";
import { StageSystemCheck } from "@/components/interview/cohort/stage-system-check";
import { StageReady } from "@/components/interview/cohort/stage-ready";
import { StageLiveVoice } from "@/components/interview/cohort/stage-live-voice";
import { StageCompletion } from "@/components/interview/cohort/stage-completion";
import { StageCohortResult } from "@/components/interview/cohort/stage-cohort-result";
import "./interview.css";

export type CohortJourneyStage =
  | "intro"
  | "consent"
  | "devices"
  | "ready"
  | "live"
  | "completion"
  | "result";

export function CohortInterviewJourney({
  blueprint,
  candidateName,
}: {
  blueprint: InterviewBlueprintKey;
  candidateName: string;
}) {
  const [stage, setStage] = useState<CohortJourneyStage>("intro");
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [result, setResult] = useState<FinishInterviewData | null>(null);

  const title = BLUEPRINT_LABEL[blueprint];
  const dayLabel = blueprint === "DAY_15" ? "Day 15" : "Day 31";

  // The live and completion stages get a full-bleed dark environment.
  // Pre-interview stages use the standard AB Talks layout.
  const isImmersive = stage === "live";

  return (
    <div>
      {/* Pre-interview stages: standard AB Talks layout with subtle step indicator */}
      {!isImmersive && stage !== "completion" && stage !== "result" && (
        <div>
          {stage !== "intro" && (
            <header className="mb-8">
              <span className="kicker">AI Cohort Interview</span>
              <h1 className="mt-3 text-[clamp(28px,3.4vw,40px)] font-extrabold leading-[1.1] tracking-[-0.015em]">
                {title}
              </h1>
            </header>
          )}

          {stage === "intro" && (
            <StageIntro
              blueprint={blueprint}
              dayLabel={dayLabel}
              title={title}
              onProceed={() => setStage("consent")}
            />
          )}

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
        </div>
      )}

      {/* Live interview: full-screen immersive environment */}
      {stage === "live" && (
        <StageLiveVoice
          blueprint={blueprint}
          interviewId={interviewId}
          onInterviewOpenAction={(id) => setInterviewId(id)}
          onFinishedAction={(data) => {
            setResult(data);
            setStage("completion");
          }}
          onAbandonedAction={() => {
            setInterviewId(null);
            setStage("intro");
          }}
        />
      )}

      {/* Completion transition */}
      {stage === "completion" && (
        <StageCompletion
          onViewReport={() => setStage("result")}
        />
      )}

      {/* Assessment report */}
      {stage === "result" && (
        <StageCohortResult
          result={result}
          blueprint={blueprint}
          candidateName={candidateName}
        />
      )}
    </div>
  );
}
