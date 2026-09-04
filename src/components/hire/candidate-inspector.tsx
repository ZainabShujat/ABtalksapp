"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ExternalLink, Lock } from "lucide-react";
import { refPublicId, type CandidateSource } from "@/features/hire/candidate-ref";
import { isLockedPreview } from "@/features/hire/locked-preview";
import {
  LockedField,
  UpgradeNotice,
  useUpgradePrompt,
} from "@/components/hire/locked-field";
import { COMPENSATION_DISCLAIMER } from "@/features/hire/compensation";
import { DeskShortlistButton } from "@/components/hire/desk-shortlist-button";
import {
  evidenceResumeHref,
  rememberEvidence,
} from "@/components/hire/evidence-cache";
import { ShortlistButton } from "@/components/talent/shortlist-button";
import { HireScoreChart } from "@/components/hire/hire-score-chart";
import { skillTint, trackLabel } from "@/components/hire/hire-card-facts";
import type { MatchCardData } from "@/components/hire/match-card";
import { cn } from "@/lib/utils";
import { MaskedName } from "@/components/hire/desk-match-card";
import {
  SubscriptionGate,
  type GateReason,
} from "@/components/hire/subscription-gate";

function trackLongLabel(source?: CandidateSource): string | null {
  switch (source) {
    case "CLAUDE":
      return "Claude challenge";
    case "CHALLENGE_60":
      return "60-day challenge";
    case "HACKATHON":
      return "Hackathon";
    case "PROGRAM":
      return "US cohort";
    default:
      return null;
  }
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function coverageLede(match: MatchCardData): string {
  if (match.coverageNote?.trim()) return match.coverageNote.trim();
  const e = match.evidence ?? {};
  const have: string[] = [];
  const missing: string[] = [];
  const push = (label: string, on: boolean) => {
    (on ? have : missing).push(label);
  };
  push("completed missions", typeof e.missionsPassed === "number");
  push("first-attempt review outcome", typeof e.cleanPassCount === "number");
  push("verified commits", typeof e.commitDayCount === "number");
  push("graded projects", Boolean(e.projectScores?.length));
  push(
    "exit interviews",
    typeof e.interviewOverall === "number" && e.interviewOverall !== null,
  );
  push("availability", !match.availabilityUnknown);
  push("compensation expectation", Boolean(match.compensationDeclared));
  if (missing.length === 0) {
    return `Ranked on ${have.length} of 7 evidence dimensions.`;
  }
  const verb = missing.length === 1 ? "has" : "have";
  const they = missing.length === 1 ? "it is" : "they are";
  return (
    `Ranked on ${have.length} of 7 evidence dimensions — ${joinList(missing)} ` +
    `${verb} not been recorded for this candidate yet, so ${they} excluded rather than counted as zero.`
  );
}

export function CandidateInspector({
  match,
  onClose,
  onCartToggle,
}: {
  match: MatchCardData;
  onClose: () => void;
  onCartToggle?: (inCart: boolean) => void;
}) {
  const e = match.evidence ?? {};
  const publicId = refPublicId(match.candidateRef);
  const sample = match.candidateRef.startsWith("SAMPLE:");
  const preview = isLockedPreview(match) ? match.preview : null;
  const { upgradeOpen, openUpgrade, dismissUpgrade } = useUpgradePrompt();
  const track = trackLongLabel(match.source);
  const isChallenge = match.source === "CLAUDE" || match.source === "CHALLENGE_60";
  const workLabel = isChallenge ? "Days shipped" : "Missions";
  const totalDays = e.totalTrackDays;
  const skills = e.skills ?? [];
  const missions =
    typeof e.missionsPassed === "number"
      ? totalDays
        ? `${e.missionsPassed} of ${totalDays}`
        : String(e.missionsPassed)
      : match.source === "HACKATHON"
        ? "Shipped project"
        : null;
  const firstAttempt =
    typeof e.cleanPassCount === "number"
      ? e.cleanPassCount > 0
        ? String(e.cleanPassCount)
        : "None recorded"
      : null;
  const commits =
    typeof e.commitDayCount === "number" ? String(e.commitDayCount) : null;
  const projects = e.projectScores?.length
    ? e.projectScores.join(" / ")
    : null;
  const resumeHref = evidenceResumeHref(match.candidateRef);
  const [gate, setGate] = useState<GateReason | null>(null);

  useEffect(() => {
    rememberEvidence([match]);
  }, [match]);

  return (
    <aside className="hire-detail" aria-label="Candidate details">
      <div className="hire-detail__scroll">
        <button type="button" className="hire-back" onClick={onClose}>
          <ChevronLeft aria-hidden="true" />
          Back
        </button>

        <div className="hire-detail__top">
          <div>
            <h3 className="hire-detail__name">
              {preview ? (
                <LockedField
                  value={preview.displayName}
                  label="Candidate name"
                  onReveal={openUpgrade}
                />
              ) : (
                // Same treatment as the result card — see `MaskedName`.
                match.displayName ? (
                  <MaskedName name={match.displayName} />
                ) : (
                  match.jobRole
                )
              )}
            </h3>
            <p className="hire-detail__ref">
              {preview ? (
                <>
                  {match.jobRole}
                  {" · "}
                  <LockedField
                    value={preview.locationLabel}
                    label="Location"
                    onReveal={openUpgrade}
                  />
                  {" · "}
                  <LockedField
                    value={preview.educationLine}
                    label="Education"
                    onReveal={openUpgrade}
                  />
                </>
              ) : sample ? (
                "Sample profile — not a person in the pool"
              ) : (
                [match.jobRole, e.workMode, match.locationLabel, publicId]
                  .filter(Boolean)
                  .join(" · ")
              )}
            </p>
            {preview && (
              <div className="hire-detail__locked">
                <p className="hire-detail__ref">
                  Email{" "}
                  <LockedField
                    value={preview.email}
                    label="Email address"
                    onReveal={openUpgrade}
                  />
                </p>
                <p className="hire-detail__ref">
                  Phone{" "}
                  <LockedField
                    value={preview.phone}
                    label="Phone number"
                    onReveal={openUpgrade}
                  />
                </p>
                <p className="hire-detail__ref">
                  Expected{" "}
                  <LockedField
                    value={preview.compensationBand}
                    label="Expected compensation"
                    onReveal={openUpgrade}
                  />
                </p>
                {upgradeOpen && <UpgradeNotice onDismiss={dismissUpgrade} />}
                <p className="hire-detail__ref" style={{ marginTop: 10 }}>
                  This is an example of the full profile format — the details
                  behind the blur are generated, not a candidate.
                </p>
              </div>
            )}
          </div>
          {!sample && (
            <div className="hire-detail__score">
              <b>{match.score}</b>
              <span>out of 100</span>
            </div>
          )}
        </div>

        <div className="desk-card__facts" style={{ marginTop: 16 }}>
          {track && <span className="desk-pill">{trackLabel(match.source)}</span>}
          {typeof e.missionsPassed === "number" && (
            <span className="desk-pill desk-pill--good">
              {e.missionsPassed}
              {totalDays ? ` of ${totalDays}` : ""}{" "}
              {isChallenge ? "days shipped" : "missions passed"}
            </span>
          )}
          {match.source === "HACKATHON" && (
            <span className="desk-pill desk-pill--good">Shipped project</span>
          )}
          {e.certificateIssued && (
            <span className="desk-pill desk-pill--good">Certified</span>
          )}
          {typeof e.yearsExperience === "number" && e.yearsExperience > 0 && (
            <span className="desk-pill">{e.yearsExperience} yrs</span>
          )}
          {match.tier && match.tier !== "NONE" && !sample && (
            <span className="desk-pill">{match.tier}</span>
          )}
          {skills.slice(0, 6).map((s) => (
            <span key={s} className={`desk-pill ${skillTint(s)}`}>
              {s}
            </span>
          ))}
          {match.availabilityUnknown && (
            <span className="desk-pill desk-pill--warn">Availability unconfirmed</span>
          )}
        </div>

        {/* Was a link reading "View full evidence profile" that opened
            `resumeHref` in a new tab. It is now the gated "Resume" action from
            the reference: the click opens the plan dialog rather than the
            document. `evidenceResumeHref` and the route behind it are
            untouched — nothing about the evidence data changed, only what this
            control does. */}
        {!sample && (
          <button
            type="button"
            className="hire-detail__resume"
            onClick={() => setGate("resume")}
            aria-haspopup="dialog"
          >
            <Lock className="size-3.5" aria-hidden="true" />
            Resume
          </button>
        )}

        <p className="hire-detail__lede">
          {sample
            ? "This is an illustration of the requirement — nobody in the pool matches it yet. Figures below are taken from what you asked for, not from a candidate."
            : coverageLede(match)}
        </p>

        {/* Two controls on one row, as in the reference: the collapse on the
            left and the evidence profile beside it. "See less details" sat here
            alone before, which is why it read as an orphaned control.

            The evidence link is kept rather than dropped when "Resume" took
            over the gated slot above — deleting it would have made a working
            route unreachable from the desk, which is a functional loss, not a
            UI one. `justify-content: space-between` puts them at the two ends
            and the existing `flex-wrap` still stacks them on a narrow panel. */}
        <div className="hire-detail__topcta">
          <button type="button" className="desk-ghost" onClick={onClose}>
            See less details
            <ChevronLeft className="size-3.5" aria-hidden="true" />
          </button>
          {!sample && (
            <Link
              href={resumeHref}
              className="desk-ghost"
              target="_blank"
              rel="noopener noreferrer"
            >
              Full evidence profile
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>

        <div className="hire-detail__rule" />

        <div className="hire-metrics">
          <Metric k="AB score" v={sample ? null : `${match.score}/100`} />
          <Metric
            k="Tier"
            v={
              sample
                ? null
                : match.tier === "STRONG"
                  ? "RECOMMENDED"
                  : match.tier
            }
          />
          <Metric
            k="Experience"
            v={
              typeof e.yearsExperience === "number"
                ? `${e.yearsExperience} yrs`
                : null
            }
          />
          <Metric k={workLabel} v={missions} />
          <Metric k="First-attempt" v={firstAttempt} />
          <Metric k="Verified commits" v={commits} />
          <Metric k="Projects" v={projects} />
          <Metric
            k={match.compensationDeclared ? "Expected CTC" : "Est. compensation"}
            v={match.compensationBand ?? null}
          />
          <Metric k="Location" v={match.locationLabel ?? null} />
          <Metric k="Work mode" v={e.workMode ?? null} />
          <Metric k="Education" v={e.educationLevel ?? null} />
          <Metric k="Track" v={track} />
          <Metric
            k="Interview"
            v={
              typeof e.interviewOverall === "number"
                ? `${e.interviewOverall}/5`
                : null
            }
          />
          <Metric k="Reference" v={sample ? null : publicId} />
        </div>
        {match.compensationBand && !match.compensationDeclared && (
          <p className="hire-detail__note">{COMPENSATION_DISCLAIMER}</p>
        )}
        <p className="hire-detail__note">
          Mission, first-attempt, commit and project figures are verified by
          ABTalks. Experience, skills and role are self-declared. Compensation
          and availability are shown only when the candidate shared them.
        </p>

        <section className="hire-detail__section">
          <h3 className="hire-detail__h">AI candidate summary</h3>
          {match.rationale ? (
            <p className="hire-detail__p hire-detail__p--summary">
              {match.rationale}
            </p>
          ) : (
            <p className="hire-detail__p is-empty">
              Resume analysis has not been recorded for this candidate yet.
            </p>
          )}
        </section>

        {!sample && match.scores && (
          <section className="hire-detail__section">
            <h3 className="hire-detail__h">Candidate parameters</h3>
            <HireScoreChart scores={match.scores} total={match.score} />
            <p className="hire-detail__note hire-detail__note--tight">
              Slice size is each parameter&apos;s share of this candidate&apos;s
              combined score; the exact value out of 100 is listed beside it.
              Scores are derived from the evidence on record — indicative, not a
              validated psychometric measure.
            </p>
          </section>
        )}

        {skills.length > 0 && (
          <section className="hire-detail__section">
            <h3 className="hire-detail__h">Skills — declared by the candidate</h3>
            <div className="desk-card__facts" style={{ marginTop: 0 }}>
              {skills.map((s) => (
                <span key={s} className={`desk-pill ${skillTint(s)}`}>
                  {s}
                </span>
              ))}
            </div>
          </section>
        )}

        {!sample && (
          <section className="hire-detail__section">
            <h3 className="hire-detail__h">Platform scores</h3>
            <ul className="hire-plat">
              <PlatformRow
                name="GitHub"
                value={
                  e.githubConnected
                    ? typeof e.commitDayCount === "number"
                      ? `${e.commitDayCount} verified commit days`
                      : "Connected"
                    : null
                }
              />
              <PlatformRow
                name="LinkedIn"
                value={e.linkedinConnected ? "Connected" : null}
              />
            </ul>
          </section>
        )}

        {match.rationale && (
          <section className="hire-detail__section">
            <h3 className="hire-detail__h">Why this ranking</h3>
            <p className="hire-detail__p">{match.rationale}</p>
          </section>
        )}

        {/* The Gaps block is not rendered on the Scout desk. `match.gaps` is
            untouched and still produced by the scorer — the panel simply does
            not print it. The whole element goes rather than being hidden, so
            no empty row or margin is left behind. */}


        <div className="hire-detail__actions">
          {!sample && (
            <>
              <ShortlistButton
                candidateRef={match.candidateRef}
                programMemberId={match.programMemberId}
                initialShortlisted={match.shortlisted ?? false}
                jobRole={match.jobRole}
                totalScore={match.score}
                displayName={match.displayName}
                skills={skills}
                snapshot={match}
                onToggle={onCartToggle}
                className={cn(
                  "desk-pod",
                  match.shortlisted && "desk-pod--on",
                )}
                podLabel
              />
              <DeskShortlistButton
                candidateRef={match.candidateRef}
                jobRole={match.jobRole}
                match={match}
              />
              {/* "Request an intro" is not offered from the desk any more —
                  neither on the result card nor here. `RequestIntroButton`,
                  its server action and the whole engagement flow are untouched;
                  `MatchCard` (the guest-matches and request pages) still
                  renders it. Only the Scout desk stops surfacing it. */}
            </>
          )}
        </div>
      </div>

      <SubscriptionGate reason={gate} onClose={() => setGate(null)} />
    </aside>
  );
}

function Metric({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="hire-metric">
      <span className="hire-metric__k">{k}</span>
      <div className={v ? "hire-metric__v" : "hire-metric__v is-empty"}>
        {v ?? "Not disclosed"}
      </div>
    </div>
  );
}

function PlatformRow({ name, value }: { name: string; value: string | null }) {
  return (
    <li className="hire-plat__row">
      <span className="hire-plat__name">{name}</span>
      {value ? (
        <span className="hire-plat__score">{value}</span>
      ) : (
        <span className="hire-plat__score is-empty">Not available</span>
      )}
    </li>
  );
}
