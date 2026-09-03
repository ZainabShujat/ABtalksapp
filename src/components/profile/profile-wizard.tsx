"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import "./profile-wizard.css";
import { ProfileCard } from "./profile-card";
import { LeaveDialog } from "./leave-dialog";
import { ProfileWizardProvider, PW_FORM_ID } from "./wizard-context";

export type WizardChecklistKey =
  | "basic"
  | "experience"
  | "education"
  | "projects"
  | "mock"
  | "skills"
  | "certifications"
  | "resume"
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

export function ProfileWizard({
  steps,
  initialIndex,
  score,
  fullName,
  personaLabel,
  imageUrl,
  updatedAtIso,
  performance,
  avatarUploadEnabled,
}: {
  steps: WizardStep[];
  initialIndex: number;
  score: number;
  fullName: string;
  personaLabel: string;
  imageUrl: string | null;
  updatedAtIso: string;
  performance: { searchAppearances: number; recruiterActions: number };
  avatarUploadEnabled: boolean;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  const loadedAt100 = score === 100;
  const [pillShow, setPillShow] = useState(loadedAt100);
  const [barFinished, setBarFinished] = useState(false);
  const [barRestored] = useState(loadedAt100);
  const [celebrate, setCelebrate] = useState(false);
  const playedRef = useRef(false);
  const prevScoreRef = useRef(score);
  const barRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const step = steps[index] ?? steps[0]!;
  const last = index === steps.length - 1;

  useEffect(() => {
    pendingRef.current = null;
    headingRef.current?.focus();
  }, [index]);

  useEffect(() => {
    if (score !== 100 || prevScoreRef.current >= 100 || playedRef.current) {
      prevScoreRef.current = score;
      return;
    }
    playedRef.current = true;
    setCelebrate(true);
    prevScoreRef.current = score;

    let done = false;
    let pillTimer: number | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      setBarFinished(true);
      pillTimer = window.setTimeout(() => setPillShow(true), 500);
    };

    const bar = barRef.current;
    const onEnd = (event: TransitionEvent) => {
      if (event.propertyName === "width") finish();
    };
    bar?.addEventListener("transitionend", onEnd);
    const fallback = window.setTimeout(finish, 750);

    return () => {
      bar?.removeEventListener("transitionend", onEnd);
      window.clearTimeout(fallback);
      if (pillTimer !== undefined) window.clearTimeout(pillTimer);
    };
  }, [score]);

  function requestLeave(next: number) {
    if (next === index) return;
    if (!dirty) {
      setIndex(next);
      return;
    }
    setPendingTarget(next);
  }

  function onSaved() {
    const target = pendingRef.current;
    pendingRef.current = null;
    setDirty(false);
    if (target !== null) setIndex(target);
    else if (!last) setIndex((i) => i + 1);
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
          performance={performance}
          avatarUploadEnabled={avatarUploadEnabled}
        />

        <ProfileWizardProvider
          value={{
            formId: PW_FORM_ID,
            onSaved,
            setDirty,
            saving,
            setSaving,
          }}
        >
          <section className="pw-form-card">
            <div className="pw-section-header">
              <div className="pw-section-track" aria-hidden />
              <div
                ref={barRef}
                className={progressClass}
                style={{ width: `${score}%` }}
                role="progressbar"
                aria-valuenow={score}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Profile completion"
              />
              <div className="pw-section-header-content">
                <h2 ref={headingRef} tabIndex={-1}>
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
              {step.node}
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
                  disabled={saving}
                  className={`pw-btn pw-btn-primary${last ? " pw-save" : ""}`}
                  onClick={() => {
                    pendingRef.current = null;
                  }}
                >
                  {saving ? "Saving…" : last ? "Save" : "Next"}
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
        </ProfileWizardProvider>
      </div>

      <LeaveDialog
        open={pendingTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTarget(null);
        }}
        onCancel={() => setPendingTarget(null)}
        onDiscard={() => {
          const target = pendingTarget;
          setDirty(false);
          setPendingTarget(null);
          if (target !== null) setIndex(target);
        }}
        onSave={() => {
          pendingRef.current = pendingTarget;
          setPendingTarget(null);
          const form = document.getElementById(PW_FORM_ID);
          if (form instanceof HTMLFormElement) form.requestSubmit();
        }}
      />
    </div>
  );
}
