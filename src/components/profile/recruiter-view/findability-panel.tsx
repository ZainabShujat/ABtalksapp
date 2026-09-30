"use client";

import Link from "next/link";
import type { CandidateFindability } from "@/features/profile/recruiter-view-checks";
import { ArrowRightIcon, LockIcon, TickIcon, WarnIcon } from "./rv-icons";

/**
 * Can a recruiter actually find you, and what is holding it back.
 *
 * The rows arrive already reworded by `recruiter-view-checks.ts`, which is where
 * the rule lives: a platform or admin gate is collapsed into one neutral row with
 * no fix link, because no candidate action can clear it and implying otherwise
 * would describe a platform that does not exist.
 *
 * `fixStep` is a plain string key. The link is built here, and `buttonVariants` is
 * deliberately not used — these are a bespoke pill, and Base UI button semantics
 * rule out `<Button asChild>` anyway.
 */
export function FindabilityPanel({
  findability,
  performance,
}: {
  findability: CandidateFindability;
  performance: { searchAppearances: number; recruiterActions: number };
}) {
  return (
    <div className="rv-find">
      <div
        className={
          findability.appears
            ? "rv-verdict rv-verdict--yes"
            : "rv-verdict rv-verdict--no"
        }
      >
        <span className="rv-verdict__icon" aria-hidden="true">
          {findability.appears ? <TickIcon /> : <WarnIcon />}
        </span>
        <p className="rv-verdict__text">{findability.headline}</p>
      </div>

      {findability.rows.length > 0 && (
        <div className="rv-rows">
          {findability.rows.map((row) => (
            <div className={`rv-row rv-row--${row.tone}`} key={row.id}>
              <span className="rv-row__icon" aria-hidden="true">
                {row.tone === "ok" ? (
                  <TickIcon />
                ) : row.tone === "blocked" ? (
                  <LockIcon />
                ) : (
                  <WarnIcon />
                )}
              </span>

              <div className="rv-row__body">
                <span className="rv-row__label">{row.label}</span>
                <p className="rv-row__detail">{row.detail}</p>
              </div>

              {row.fixStep && row.fixLabel && (
                <Link className="rv-row__fix" href={`/profile?step=${row.fixStep}`}>
                  {row.fixLabel}
                  <ArrowRightIcon />
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="rv-perf">
        <div className="rv-perf__cell">
          <span className="rv-perf__n">{performance.searchAppearances}</span>
          <span className="rv-perf__k">Recruiters opened your details</span>
          <span className="rv-perf__sub">Last 90 days</span>
        </div>
        <div className="rv-perf__cell">
          <span className="rv-perf__n">{performance.recruiterActions}</span>
          <span className="rv-perf__k">Recruiters unlocked your contact</span>
          <span className="rv-perf__sub">
            Last 90 days. An unlock costs a recruiter credits, so it means real
            interest.
          </span>
        </div>
      </div>
    </div>
  );
}
