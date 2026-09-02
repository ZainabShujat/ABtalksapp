"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import "./profile-wizard.css";
import { ProfileCard } from "./profile-card";
import { ProfileWizardProvider, PW_FORM_ID } from "./wizard-context";

export type WizardChecklistKey =
  | "basic"
  | "experience"
  | "education"
  | "projects"
  | "mock"
  | "skills"
  | "certifications"
  | "links"
  | "preferences";

export type WizardStep = {
  key: string;
  title: string;
  description: string;
  checklist: WizardChecklistKey;
  complete: boolean;
  attention: boolean;
  savable: boolean;
  node: ReactNode;
};

const LEAVE_MESSAGE =
  "You have unsaved changes in this section. Leave without saving?";

export function ProfileWizard({
  steps,
  initialIndex,
  score,
  fullName,
  personaLabel,
  imageUrl,
  updatedAtIso,
}: {
  steps: WizardStep[];
  initialIndex: number;
  score: number;
  fullName: string;
  personaLabel: string;
  imageUrl: string | null;
  updatedAtIso: string;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [dirty, setDirty] = useState(false);
  const loadedAt100 = score === 100;
  const [pillShow, setPillShow] = useState(loadedAt100);
  const [barFinished, setBarFinished] = useState(false);
  const [barRestored] = useState(loadedAt100);
  const [celebrate, setCelebrate] = useState(false);
  const playedRef = useRef(false);
  const prevScoreRef = useRef(score);

  const step = steps[index] ?? steps[0]!;
  const last = index === steps.length - 1;

  useEffect(() => {
    if (
      score === 100 &&
      prevScoreRef.current < 100 &&
      !playedRef.current
    ) {
      playedRef.current = true;
      setBarFinished(true);
      setCelebrate(true);
      const t = window.setTimeout(() => setPillShow(true), 500);
      prevScoreRef.current = score;
      return () => window.clearTimeout(t);
    }
    prevScoreRef.current = score;
  }, [score]);

  function requestLeave(next: number) {
    if (next === index) return;
    if (dirty && !window.confirm(LEAVE_MESSAGE)) return;
    setDirty(false);
    setIndex(next);
  }

  function advance() {
    if (!last) setIndex((i) => Math.min(i + 1, steps.length - 1));
  }

  const progressClass = [
    "pw-section-progress",
    barFinished ? "pw-finished" : "",
    barRestored && !barFinished ? "pw-restored" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="pw-root">
      <div className="pw-workspace">
        <ProfileCard
          score={score}
          fullName={fullName}
          personaLabel={personaLabel}
          imageUrl={imageUrl}
          updatedAtIso={updatedAtIso}
          steps={steps}
          activeIndex={index}
          celebrate={celebrate}
          onJump={requestLeave}
        />

        <section className="pw-form-card">
          <div className="pw-section-header">
            <div
              className={progressClass}
              style={{ width: `${score}%` }}
            />
            <div className="pw-section-header-content">
              <h2>
                {index + 1}. {step.title}
              </h2>
              <p>{step.description}</p>
            </div>
            <div
              className={`pw-complete-pill${pillShow ? " pw-show" : ""}`}
            >
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M5 13l4 4L19 7" />
              </svg>{" "}
              Profile Complete
            </div>
          </div>

          <div className="pw-section-body" data-section={step.key}>
            <ProfileWizardProvider
              value={{ formId: PW_FORM_ID, onSaved: advance, setDirty }}
            >
              {step.node}
            </ProfileWizardProvider>
          </div>

          <div className="pw-form-actions">
            <button
              type="button"
              className="pw-btn pw-btn-ghost"
              disabled={index === 0}
              onClick={() => requestLeave(index - 1)}
            >
              Previous
            </button>
            {step.savable ? (
              <button
                type="submit"
                form={PW_FORM_ID}
                className={`pw-btn pw-btn-primary${last ? " pw-save" : ""}`}
              >
                {last ? "Save" : "Next"}
              </button>
            ) : (
              <button
                type="button"
                className="pw-btn pw-btn-primary"
                onClick={advance}
              >
                Next
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
