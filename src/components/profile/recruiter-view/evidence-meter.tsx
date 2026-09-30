"use client";

import type { EvidenceDim } from "@/features/profile/recruiter-view";
import { InfoIcon } from "./rv-icons";

/**
 * One dimension of the ranking, in the candidate's own terms.
 *
 * Three states, and the distinction between them is the honest part:
 *
 *  - `measured` — a real number about this candidate. Bar plus value.
 *  - `unavailable` — their track cannot produce this evidence. A dash and a
 *    reason, NEVER a zero: `scoreBreakdown` reports `null` for exactly this case
 *    so that "the evidence could not exist" is never confused with "the evidence
 *    exists and it was bad".
 *  - `search-relative` — the dimension only exists against a recruiter's spec, so
 *    there is no number to show at all. The underlying fact goes beside it.
 */
export function EvidenceMeter({ dim }: { dim: EvidenceDim }) {
  if (dim.kind === "measured") {
    return (
      <div className="rv-meter">
        <div className="rv-meter__row">
          <span className="rv-meter__label">{dim.label}</span>
          <span className="rv-meter__value">{dim.value}</span>
        </div>
        <div className="rv-meter__track">
          <div className="rv-bar">
            <div
              className="rv-bar__fill"
              style={{ width: `${Math.max(0, Math.min(100, dim.value))}%` }}
              role="meter"
              aria-valuenow={dim.value}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={dim.label}
            />
          </div>
        </div>
        <p className="rv-meter__caption">{dim.caption}</p>
      </div>
    );
  }

  if (dim.kind === "unavailable") {
    return (
      <div className="rv-meter">
        <div className="rv-meter__row">
          <span className="rv-meter__label">{dim.label}</span>
          <span className="rv-meter__none">Not measured</span>
        </div>
        <div className="rv-meter__track">
          <div className="rv-bar--dashed" />
        </div>
        <p className="rv-meter__caption">{dim.caption}</p>
      </div>
    );
  }

  return (
    <div className="rv-meter rv-meter--rel">
      <div className="rv-meter__row">
        <span className="rv-meter__label">{dim.label}</span>
        <span className="rv-meter__tag">
          <InfoIcon />
          Set by the search
        </span>
      </div>
      <div className="rv-meter__track">
        {dim.fact && <p className="rv-meter__fact">{dim.fact}</p>}
      </div>
      <p className="rv-meter__caption">{dim.caption}</p>
    </div>
  );
}
