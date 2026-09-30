"use client";

import Link from "next/link";

const PERFORMANCE_TOOLTIP =
  "How often recruiters opened your details and unlocked your resume on Hire, over the last 90 days.";

/**
 * One half of the Profile performance panel.
 *
 * The number is the whole content. It carried a chevron in the design, which
 * read as "opens a breakdown" — there is nothing to open, so it is gone rather
 * than left as a promise the panel cannot keep.
 */
function PerfColumn({ label, value }: { label: string; value: number }) {
  return (
    <div className="pw-perf-column">
      <div className="pw-col-label">{label}</div>
      <div className="pw-col-value">{value}</div>
    </div>
  );
}

/**
 * Recruiter-activity numbers for the last 90 days. Rendered under Quick Links
 * on desktop and under the section list on mobile (CSS toggles which mount
 * is visible).
 */
export function ProfilePerformance({
  searchAppearances,
  recruiterActions,
  className,
}: {
  searchAppearances: number;
  recruiterActions: number;
  className?: string;
}) {
  return (
    <div className={className ?? "pw-performance-section"}>
      <div className="pw-performance-header">
        <span className="pw-section-title">Profile performance</span>
        <svg
          viewBox="0 0 24 24"
          className="pw-ico pw-info"
          role="img"
          aria-label={PERFORMANCE_TOOLTIP}
        >
          <title>{PERFORMANCE_TOOLTIP}</title>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </svg>
      </div>
      <p className="pw-performance-caption">Last 90 days</p>
      <div className="pw-performance-grid">
        <PerfColumn label="Search appearances" value={searchAppearances} />
        <div className="pw-grid-divider" aria-hidden />
        <PerfColumn label="Recruiter actions" value={recruiterActions} />
      </div>
      {/* Plan 155. The numbers above say how often recruiters looked; this says
          what they saw. Deliberately here rather than in the page chrome — this
          panel is already the one place on /profile that is about recruiters.
          Utility classes rather than a new `pw-*` rule, so profile-wizard.css is
          untouched. */}
      <Link
        href="/profile/recruiter-view"
        className="group mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#03535f] transition-colors duration-200 hover:text-[#076573]"
      >
        See how recruiters see you
        <svg
          viewBox="0 0 24 24"
          className="size-3.5 fill-none stroke-current stroke-[2.2] transition-transform duration-200 motion-safe:group-hover:translate-x-0.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      </Link>
    </div>
  );
}
