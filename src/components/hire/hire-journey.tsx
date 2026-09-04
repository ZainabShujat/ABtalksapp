"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useHireDesk } from "@/components/hire/hire-desk-context";

export function HireJourney() {
  const { step, matchCount, gap } = useHireDesk();
  const railRef = useRef<HTMLElement>(null);
  const [trackEnd, setTrackEnd] = useState<number | null>(null);

  /**
   * Stop the rail at the last node.
   *
   * The line was `top: 48px; bottom: 48px`, both measured from the aside. The
   * top happened to land on node 1; the bottom did not land on node 3 — it ran
   * 50px past it, because what sits under the last node is its own paragraph,
   * not 48px of nothing.
   *
   * A different constant would only be wrong somewhere else: the stages are
   * `justify-content: space-between`, so the gaps between them are whatever is
   * left over, and step 2's text is replaced by the search's gap report, which
   * changes every height below it. So measure the node instead of predicting
   * where it will be, and re-measure whenever the text or the width changes.
   */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const measure = () => {
      const nodes = rail.querySelectorAll(".hire-node");
      const last = nodes[nodes.length - 1];
      if (!last) return;
      const r = rail.getBoundingClientRect();
      const n = last.getBoundingClientRect();
      setTrackEnd(Math.max(0, Math.round(r.bottom - (n.top + n.height / 2))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(rail);
    return () => ro.disconnect();
  }, [step, matchCount, gap]);
  const countLabel =
    matchCount == null
      ? "Matched candidates"
      : matchCount === 0
        ? "No matches yet"
        : `${matchCount} matched candidate${matchCount === 1 ? "" : "s"}`;

  return (
    <aside
      className="hire-journey"
      aria-label="Hiring workflow"
      data-step={step}
      ref={railRef}
    >
      <span
        className="hire-journey__track"
        aria-hidden="true"
        style={trackEnd == null ? undefined : { bottom: `${trackEnd}px` }}
      >
        <span className="hire-journey__track-fill" />
      </span>
      <div className={`hire-journey__stage ${step === 1 ? "is-active" : ""}`}>
        <span
          className={`hire-node ${step === 1 ? "hire-node--on" : step > 1 ? "hire-node--done" : "hire-node--off"}`}
        >
          {step > 1 ? "✓" : "1"}
        </span>
        {/* Shown only once the column has narrowed, where the full title and
            copy are hidden and a number on its own says nothing. */}
        <span className="hire-journey__short">Describe the role</span>
        <div>
          <h2 className="hire-journey__title">
            Tell us who you&apos;re looking for
          </h2>
        </div>
      </div>
      <div className={`hire-journey__stage ${step === 2 ? "is-active" : ""}`}>
        <span
          className={`hire-node ${step >= 2 ? "hire-node--on" : "hire-node--off"}`}
        >
          2
        </span>
        <span className="hire-journey__short">Ranked candidates</span>
        <div>
          <h2 className="hire-journey__title">{countLabel}</h2>
          {/* Only the real gap report. The placeholder it used to fall back to
              just restated the step title above it. */}
          {gap?.trim() && <p className="hire-journey__desc">{gap.trim()}</p>}
        </div>
      </div>
      <div className={`hire-journey__stage ${step === 3 ? "is-active" : ""}`}>
        <span
          className={`hire-node ${step === 3 ? "hire-node--on" : step > 3 ? "hire-node--done" : "hire-node--off"}`}
        >
          3
        </span>
        <span className="hire-journey__short">Track requests</span>
        <div>
          <h2 className="hire-journey__title">Track your requests</h2>
          <p className="hire-journey__desc">
            <Link href="/hire/requests" className="hire-journey__link">
              Open requests
            </Link>
          </p>
        </div>
      </div>
    </aside>
  );
}

/**
 * The same three stages as one line.
 *
 * Always been the phone layout; the desk now uses it too, once the recruiter
 * has started, so the workspace gets the full width. It reads `useHireDesk`
 * itself rather than taking props, so both renderings of the journey stay in
 * step with no plumbing between them.
 */
export function HireRail() {
  const { step, matchCount } = useHireDesk();
  const countLabel =
    matchCount == null
      ? "Matched candidates"
      : matchCount === 0
        ? "No matches yet"
        : `${matchCount} matched candidate${matchCount === 1 ? "" : "s"}`;

  return (
    <section className="hire-rail" aria-label="Hiring workflow">
      <div className="hire-rail__nodes" aria-hidden="true">
        <span className={step === 1 ? "is-on" : step > 1 ? "is-done" : ""}>
          1
        </span>
        <i />
        <span className={step === 2 ? "is-on" : step > 2 ? "is-done" : ""}>
          2
        </span>
        <i />
        <span className={step === 3 ? "is-on" : ""}>3</span>
      </div>
      <p>
        <strong>
          {step === 1 ? "Tell us who you're looking for" : countLabel}
        </strong>
      </p>
    </section>
  );
}
