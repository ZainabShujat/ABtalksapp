"use client";

import Link from "next/link";
import type { WizardStep } from "./profile-wizard";
import { ProfilePerformance } from "./profile-performance";

/**
 * The left card: Quick Links into the profile, plus Profile performance.
 *
 * The identity block lives in the report card hero, so this card is navigation
 * plus the candidate's own recruiter-activity numbers (plan 120). Hidden
 * entirely on mobile (≤1024px) — section cards and the review-bottom
 * performance block replace it.
 */
export function ProfileCard({
  steps,
  activeIndex,
  onJump,
  performance,
  emailLoginEnabled,
  blocked,
}: {
  steps: Pick<WizardStep, "title" | "complete" | "attention" | "optional">[];
  /** -1 when no sheet is open, so no tab is left looking selected. */
  activeIndex: number;
  onJump: (index: number) => void;
  performance: { searchAppearances: number; recruiterActions: number };
  /** Plan 154 (ENABLE_EMAIL_LOGIN). Off: the account has no password to manage. */
  emailLoginEnabled: boolean;
  /** An open sheet holds unsaved edits — navigating away would lose them. */
  blocked: boolean;
}) {
  return (
    <section className="pw-profile-card">
      <div className="pw-quick-head">
        <h2 className="pw-quick-title">Quick Links</h2>
      </div>

      <ul className="pw-checklist">
        {steps.map((step, i) => {
          const current = i === activeIndex;
          // An optional step is never "unfinished": finishing it cannot move
          // Profile strength, so flagging it for attention would be a nag for
          // something the score ignores.
          const needsAttention =
            !step.complete && step.attention && !step.optional;
          const classes = [
            "pw-check-item",
            step.complete ? "pw-completed" : "",
            needsAttention ? "pw-attention" : "",
            current ? "pw-current" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li key={step.title}>
              <button
                type="button"
                className={classes}
                onClick={() => onJump(i)}
                aria-current={current ? "step" : undefined}
              >
                <span>{step.title}</span>
                {step.optional && !step.complete ? (
                  <span className="pw-check-optional">Optional</span>
                ) : null}
                {needsAttention ? (
                  <span className="pw-check-dot" aria-hidden />
                ) : null}
                <span className="pw-sr-only">
                  Step {i + 1} of {steps.length}
                  {step.complete ? ", complete" : ""}
                  {step.optional
                    ? ", optional — it does not count towards profile strength"
                    : ""}
                  {needsAttention ? ", needs attention" : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {emailLoginEnabled ? (
        <div className="pw-check-account">
          {blocked ? (
            <span
              className="pw-check-link"
              aria-disabled="true"
              title="Save or discard your changes first."
            >
              Password &amp; sign-in
            </span>
          ) : (
            <Link href="/settings/security" className="pw-check-link">
              Password &amp; sign-in
            </Link>
          )}
        </div>
      ) : null}

      <ProfilePerformance
        searchAppearances={performance.searchAppearances}
        recruiterActions={performance.recruiterActions}
      />
    </section>
  );
}
