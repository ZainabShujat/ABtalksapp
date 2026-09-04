"use client";

import { useState } from "react";
import { Lock } from "lucide-react";

/**
 * A blurred value with an upgrade prompt behind it.
 *
 * The blur is CSS on real text, so the underlying string is in the DOM. That is
 * fine *here* and only here: every value passed to this component is fabricated
 * by `features/hire/locked-preview.ts`. Do not reuse this to hide a real
 * candidate's details — a CSS blur is a visual treatment, not access control,
 * and anyone can read it out of the page source in a second.
 *
 * Real candidate contact is released by an admin decision on a
 * `TalentEngagementRequest` and is never sent to the client before that.
 */
export function LockedField({
  value,
  label,
  onReveal,
  className,
}: {
  value: string;
  /** Announced to screen readers in place of the blurred text. */
  label: string;
  onReveal: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onReveal}
      className={`hire-locked ${className ?? ""}`}
      aria-label={`${label}, locked. Upgrade to Pro to view.`}
      title="Upgrade to Pro to view"
    >
      <span className="hire-locked__value" aria-hidden="true">
        {value}
      </span>
      <Lock className="hire-locked__icon size-3" aria-hidden="true" />
    </button>
  );
}

/**
 * The message a locked field opens.
 *
 * Deliberately says what Pro unlocks on *this* card and stops there. It does not
 * promise contact details: those are released by an introduction request an
 * admin approves, and a plan upgrade does not and must not skip that.
 */
export function UpgradeNotice({
  onDismiss,
}: {
  onDismiss: () => void;
}) {
  return (
    <div className="hire-upgrade" role="status">
      <div className="hire-upgrade__body">
        <Lock className="size-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="hire-upgrade__title">
            Upgrade to Pro to see the full profile
          </p>
          <p className="hire-upgrade__text">
            Pro unlocks names, location, education and the compensation band on
            every match. Contact details stay separate. Those are shared when
            an introduction request is approved.
          </p>
        </div>
      </div>
      <div className="hire-upgrade__actions">
        <a href="mailto:team@abtalks.in?subject=ABTalks%20Hire%20Pro" className="hire-upgrade__cta">
          Talk to us about Pro
        </a>
        <button type="button" onClick={onDismiss} className="hire-upgrade__close">
          Not now
        </button>
      </div>
    </div>
  );
}

/** Shared open/close state for the locked fields on one card. */
export function useUpgradePrompt() {
  const [open, setOpen] = useState(false);
  return {
    upgradeOpen: open,
    openUpgrade: () => setOpen(true),
    dismissUpgrade: () => setOpen(false),
  };
}
