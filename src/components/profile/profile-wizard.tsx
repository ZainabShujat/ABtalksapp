"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import "./profile-wizard.css";
import type { ProfileReview } from "@/features/profile/build-review";
import { ProfileCard } from "./profile-card";
import { ProfileReviewCard } from "./profile-review";
import { IdentityMedia } from "./identity-media";
import { ProfileWizardProvider, PW_FORM_ID } from "./wizard-context";

export type WizardChecklistKey =
  | "basic"
  | "experience"
  | "education"
  | "projects"
  | "mock"
  | "skills"
  | "accomplishments"
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
  /**
   * Earned, and outside Profile strength. Quick Links must not show it as an
   * unfinished requirement when finishing it cannot move the score.
   */
  optional?: boolean;
  node: ReactNode;
};

/** How long the sheet takes to slide out, per the transition in the CSS. */
const SHEET_EXIT_MS = 260;

/** How long the scrollbar stays painted after the last scroll event. */
const SCROLL_CUE_MS = 900;

const FOCUSABLE =
  'a[href],area[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),iframe,object,embed,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

export function ProfileWizard({
  steps,
  initialIndex,
  score,
  fullName,
  imageUrl,
  review,
  avatarUploadEnabled,
  performance,
  emailLoginEnabled,
}: {
  steps: WizardStep[];
  initialIndex: number;
  score: number;
  fullName: string;
  imageUrl: string | null;
  review: ProfileReview;
  avatarUploadEnabled: boolean;
  performance: { searchAppearances: number; recruiterActions: number };
  /** Plan 154. Server-evaluated flag, same shape as avatarUploadEnabled. */
  emailLoginEnabled: boolean;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Where the leave dialog should go once it is answered. */
  const [pendingTarget, setPendingTarget] = useState<number | "close" | null>(
    null,
  );
  /** Bumped when a blocked Quick Links click should re-shake the leave pop. */
  const [leaveShake, setLeaveShake] = useState(0);
  const pendingRef = useRef<number | "close" | null>(null);
  const closeAfterSaveRef = useRef(false);
  const exitTimer = useRef<number | undefined>(undefined);
  const sheetRef = useRef<HTMLElement>(null);
  /** What had focus before the sheet opened, so closing can hand it back. */
  const openerRef = useRef<HTMLElement | null>(null);

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

  /* ---- open / close the slide-over ---------------------------------- */

  const openSheet = useCallback((target: number) => {
    window.clearTimeout(exitTimer.current);
    // Remembered before the sheet takes focus; a second jump from inside the
    // sheet must not overwrite the page control that started all this.
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      !sheetRef.current?.contains(active) &&
      active !== document.body
    ) {
      openerRef.current = active;
    }
    setIndex(target);
    setOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    setShown(false);
    setDirty(false);
    setPendingTarget(null);
    setLeaveShake(0);
    // Back to whatever opened the sheet, so the keyboard does not restart at
    // the top of the document.
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
    exitTimer.current = window.setTimeout(() => setOpen(false), SHEET_EXIT_MS);
  }, []);

  /** Every dismissal asks before dropping edits — Cancel included. */
  const requestClose = useCallback(() => {
    if (dirty) {
      setPendingTarget("close");
      return;
    }
    closeSheet();
  }, [dirty, closeSheet]);

  // Two frames: mount hidden, then add the class that runs the transform.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => () => window.clearTimeout(exitTimer.current), []);

  // Marks the route for the scoped scrollbar-hiding rule in profile-wizard.css.
  useEffect(() => {
    document.body.classList.add("pw-profile-page");
    return () => document.body.classList.remove("pw-profile-page");
  }, []);

  // Lock the page behind the sheet. Reserving the scrollbar's width keeps the
  // workspace from jolting sideways as the sheet slides in.
  useEffect(() => {
    if (!open) return;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    const previous = document.body.style.paddingRight;
    document.body.classList.add("pw-sheet-open");
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    return () => {
      document.body.classList.remove("pw-sheet-open");
      document.body.style.paddingRight = previous;
    };
  }, [open]);

  // Escape closes; Tab cycles inside the sheet. Without the second half the
  // keyboard walks straight out of the modal and into the dimmed page behind
  // it, where every control is still operable but invisible.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const sheet = sheetRef.current;
      if (!sheet) return;
      const stops = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (stops.length === 0) return;
      const first = stops[0]!;
      const last = stops[stops.length - 1]!;
      const active = document.activeElement;
      // Focus outside the sheet (the heading has already yielded it, or the
      // page behind stole it) comes straight back to the edge it belongs on.
      if (!(active instanceof HTMLElement) || !sheet.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, requestClose]);

  /**
   * The page scrollbar is hidden by product decision. Hiding it outright left
   * no cue that the page scrolls at all, so the gutter is always reserved (no
   * layout shift) and the thumb is painted only while the page is moving.
   */
  useEffect(() => {
    const scroller = document.querySelector(".abt-content-scroll");
    if (!scroller) return;
    let idle: number | undefined;
    function onScroll() {
      document.body.classList.add("pw-scrolling");
      window.clearTimeout(idle);
      idle = window.setTimeout(
        () => document.body.classList.remove("pw-scrolling"),
        SCROLL_CUE_MS,
      );
    }
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.clearTimeout(idle);
      document.body.classList.remove("pw-scrolling");
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    pendingRef.current = null;
    headingRef.current?.focus();
  }, [open, index]);

  /* ---- completion celebration --------------------------------------- */

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

  /* ---- navigation ---------------------------------------------------- */

  /** A Quick Links tab, or an Add / Edit on the report card. */
  function jump(next: number) {
    if (next !== index && dirty && open) {
      setPendingTarget(next);
      setLeaveShake((n) => n + 1);
      return;
    }
    openSheet(next);
  }

  function onSaved() {
    const target = pendingRef.current;
    pendingRef.current = null;
    setDirty(false);
    if (typeof target === "number") {
      openSheet(target);
      return;
    }
    if (target === "close" || closeAfterSaveRef.current) {
      closeAfterSaveRef.current = false;
      // Saving returns you to the report card, where the change is now visible.
      closeSheet();
    }
  }

  const progressClass = [
    "pw-section-progress",
    barFinished ? "pw-finished" : "",
    barRestored && !barFinished ? "pw-restored" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`pw-root${open ? " pw-sheet-open" : ""}`}>
      <div className="pw-workspace">
        <ProfileCard
          steps={steps}
          // Only a sheet that is actually open has a current step. Keeping the
          // index here left one tab in its clay active state over a closed
          // sheet, which reads as stuck.
          activeIndex={open ? index : -1}
          onJump={jump}
          performance={performance}
          emailLoginEnabled={emailLoginEnabled}
          blocked={dirty && open}
        />

        <ProfileReviewCard
          review={review}
          onOpen={jump}
          performance={performance}
          media={
            <IdentityMedia
              score={score}
              fullName={fullName}
              imageUrl={imageUrl}
              celebrate={celebrate}
              avatarUploadEnabled={avatarUploadEnabled}
            />
          }
        />
      </div>

      {open ? (
        <ProfileWizardProvider
          value={{
            formId: PW_FORM_ID,
            onSaved,
            setDirty,
            saving,
            setSaving,
          }}
        >
          <button
            type="button"
            className={`pw-form-scrim${shown ? " pw-show" : ""}`}
            aria-label="Close section"
            onClick={requestClose}
          />
          <aside
            ref={sheetRef}
            className={`pw-form-sheet${shown ? " pw-show" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pw-sheet-title"
          >
            <div className="pw-section-header">
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
                <h2 id="pw-sheet-title" ref={headingRef} tabIndex={-1}>
                  {step.title}
                </h2>
                <p>{step.description}</p>
              </div>
              <div className={`pw-complete-pill${pillShow ? " pw-show" : ""}`}>
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M5 13l4 4L19 7" />
                </svg>
                {/* Narrow widths keep the tick and clip the words (never
                    `display: none`), so the pill still announces. */}
                <span className="pw-complete-pill-label">Profile Complete</span>
              </div>
              <button
                type="button"
                className="pw-form-close"
                aria-label="Close"
                onClick={requestClose}
              >
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <div className="pw-section-body" data-section={step.key}>
              {step.node}
              {step.savable ? (
                <p className="pw-required-legend">
                  <span className="pw-req" aria-hidden>
                    *
                  </span>{" "}
                  Mandatory section
                </p>
              ) : null}
            </div>

            <div className="pw-form-actions">
              {pendingTarget !== null ? (
                <div
                  key={leaveShake}
                  className={`pw-leave-pop${leaveShake > 0 ? " pw-leave-shake" : ""}`}
                  role="alertdialog"
                  aria-live="polite"
                >
                  <div className="pw-leave-head">
                    <svg viewBox="0 0 24 24" aria-hidden>
                      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                      <path d="M12 9v4M12 17h.01" />
                    </svg>
                    <p className="pw-leave-copy">
                      You have unsaved changes in this section.
                    </p>
                  </div>
                  <div className="pw-leave-actions">
                    <button
                      type="button"
                      className="pw-leave-btn"
                      onClick={() => {
                        setPendingTarget(null);
                        setLeaveShake(0);
                      }}
                    >
                      Keep editing
                    </button>
                    <button
                      type="button"
                      className="pw-leave-btn"
                      onClick={() => {
                        const target = pendingTarget;
                        setDirty(false);
                        setPendingTarget(null);
                        setLeaveShake(0);
                        if (typeof target === "number") openSheet(target);
                        else if (target === "close") closeSheet();
                      }}
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      className="pw-leave-btn pw-leave-primary"
                      autoFocus
                      onClick={() => {
                        pendingRef.current = pendingTarget;
                        closeAfterSaveRef.current = false;
                        setPendingTarget(null);
                        setLeaveShake(0);
                        const form = document.getElementById(PW_FORM_ID);
                        if (form instanceof HTMLFormElement) form.requestSubmit();
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : null}
              {/* Cancel is a dismissal like Escape and the scrim, not a
                  discard: unsaved edits raise the same keep/discard/save pop
                  rather than disappearing. */}
              <button
                type="button"
                className="pw-btn pw-btn-ghost"
                onClick={requestClose}
              >
                Cancel
              </button>
              {step.savable ? (
                <button
                  type="submit"
                  form={PW_FORM_ID}
                  disabled={saving}
                  className="pw-btn pw-btn-primary"
                  onClick={() => {
                    pendingRef.current = null;
                    closeAfterSaveRef.current = true;
                  }}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              ) : (
                /* Mock Interview and Résumé are earned, not typed — they
                   persist their own changes, so there is nothing to submit. */
                <button
                  type="button"
                  className="pw-btn pw-btn-primary"
                  onClick={closeSheet}
                >
                  Done
                </button>
              )}
            </div>
          </aside>
        </ProfileWizardProvider>
      ) : null}

    </div>
  );
}
