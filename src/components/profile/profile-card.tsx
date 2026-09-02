"use client";

import { useId } from "react";
import type { WizardStep } from "./profile-wizard";

const RING_R = 48.5;
const RING_C = 2 * Math.PI * RING_R;

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0] + parts[1]![0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

function formatLastUpdated(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "Last updated —";
  const diffMs = then - Date.now();
  const absSec = Math.round(Math.abs(diffMs) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "always" });
  let value: number;
  let unit: Intl.RelativeTimeFormatUnit;
  if (absSec < 60) {
    value = Math.round(diffMs / 1000);
    unit = "second";
  } else if (absSec < 3600) {
    value = Math.round(diffMs / 60_000);
    unit = "minute";
  } else if (absSec < 86_400) {
    value = Math.round(diffMs / 3_600_000);
    unit = "hour";
  } else if (absSec < 86_400 * 30) {
    value = Math.round(diffMs / 86_400_000);
    unit = "day";
  } else if (absSec < 86_400 * 365) {
    value = Math.round(diffMs / (86_400_000 * 30));
    unit = "month";
  } else {
    value = Math.round(diffMs / (86_400_000 * 365));
    unit = "year";
  }
  return `Last updated ${rtf.format(value, unit)}`;
}

function CheckMark() {
  return (
    <span className="pw-mark">
      <svg viewBox="0 0 24 24">
        <circle className="pw-disc" cx="12" cy="12" r="10" />
        <path className="pw-tick" d="m9 12 2 2 4-4" fill="none" />
      </svg>
    </span>
  );
}

function WarnMark() {
  return (
    <span className="pw-mark">
      <svg viewBox="0 0 24 24">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    </span>
  );
}

export function ProfileCard({
  score,
  fullName,
  personaLabel,
  imageUrl,
  updatedAtIso,
  steps,
  activeIndex,
  celebrate,
  onJump,
}: {
  score: number;
  fullName: string;
  personaLabel: string;
  imageUrl: string | null;
  updatedAtIso: string;
  steps: Pick<WizardStep, "title" | "complete" | "attention">[];
  activeIndex: number;
  celebrate: boolean;
  onJump: (index: number) => void;
}) {
  const uid = useId().replace(/:/g, "");
  const gradId = `pw-clayRingGrad-${uid}`;
  const ringId = `pw-clayRing-${uid}`;
  const trackId = `pw-clayTrack-${uid}`;
  const offset = RING_C * (1 - score / 100);
  const complete = score === 100;

  return (
    <section className="pw-profile-card">
      <div className="pw-profile-head">
        <div
          className={`pw-ring-wrap${celebrate ? " pw-celebrate" : ""}`}
          style={{
            ["--pw-filter-ring" as string]: `url(#${ringId})`,
            ["--pw-filter-track" as string]: `url(#${trackId})`,
            ["--pw-ring-stroke" as string]: `url(#${gradId})`,
          }}
        >
          <svg className="pw-ring" viewBox="0 0 112 112" aria-hidden>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#8CEE93" />
                <stop offset="45%" stopColor="#4CD46C" />
                <stop offset="100%" stopColor="#22A94F" />
              </linearGradient>
              <filter id={ringId} x="-60%" y="-60%" width="220%" height="220%">
                <feDropShadow
                  dx="0.8"
                  dy="1.3"
                  stdDeviation="1.2"
                  floodColor="#199247"
                  floodOpacity="0.26"
                />
                <feDropShadow
                  dx="-0.7"
                  dy="-0.8"
                  stdDeviation="0.9"
                  floodColor="#FFFFFF"
                  floodOpacity="0.5"
                />
              </filter>
              <filter id={trackId} x="-60%" y="-60%" width="220%" height="220%">
                <feDropShadow
                  dx="0"
                  dy="1"
                  stdDeviation="0.9"
                  floodColor="#B9BCB6"
                  floodOpacity="0.32"
                />
                <feDropShadow
                  dx="0"
                  dy="-0.8"
                  stdDeviation="0.8"
                  floodColor="#FFFFFF"
                  floodOpacity="0.6"
                />
              </filter>
            </defs>
            <circle className="pw-ring-bg" cx="56" cy="56" r={RING_R} />
            <circle
              className="pw-ring-fg"
              cx="56"
              cy="56"
              r={RING_R}
              style={{
                strokeDasharray: RING_C,
                strokeDashoffset: offset,
              }}
            />
          </svg>

          <div className="pw-avatar pw-lg" aria-hidden>
            {imageUrl ? (
              // Avatar URLs are user-supplied remotes; next/image is not
              // configured for arbitrary hosts here.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" />
            ) : (
              initials(fullName)
            )}
          </div>

          <div
            className={`pw-ring-check${complete ? " pw-show" : ""}`}
            aria-hidden
          >
            <svg viewBox="0 0 24 24">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className={`pw-pct-badge${complete ? " pw-full" : ""}`}>
            <span className="pw-pct-num">{score}%</span>
            <span className="pw-pct-label">Profile Completed</span>
          </div>
        </div>

        <div className="pw-user-details">
          <h1 className="pw-user-name">{fullName || "Your name"}</h1>
          <div className="pw-education-degree">{personaLabel}</div>
          <div className="pw-last-updated" suppressHydrationWarning>
            {formatLastUpdated(updatedAtIso)}
          </div>
        </div>
      </div>

      <ul className="pw-checklist">
        {steps.map((step, i) => {
          const classes = [
            "pw-check-item",
            step.complete ? "pw-completed" : "",
            !step.complete && step.attention ? "pw-attention" : "",
            i === activeIndex ? "pw-current" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const mark =
            step.complete || !step.attention ? <CheckMark /> : <WarnMark />;
          return (
            <li key={step.title}>
              <button
                type="button"
                className={classes}
                onClick={() => onJump(i)}
              >
                {mark}
                <span>{step.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
