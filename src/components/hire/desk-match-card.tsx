"use client";

import { ChevronRight, UserRound } from "lucide-react";
import { refPublicId, type CandidateSource } from "@/features/hire/candidate-ref";
import { RequestIntroButton } from "@/components/hire/request-intro-button";
import { DeskShortlistButton } from "@/components/hire/desk-shortlist-button";
import { ShortlistButton } from "@/components/talent/shortlist-button";
import {
  SampleCardNotice,
  type SampleDemand,
} from "@/components/hire/sample-card-notice";
import type { MatchCardData } from "@/components/hire/match-card";
import { cn } from "@/lib/utils";

function trackLabel(source?: CandidateSource): string | null {
  switch (source) {
    case "CLAUDE":
      return "Claude";
    case "CHALLENGE_60":
      return "60-day";
    case "HACKATHON":
      return "Hackathon";
    case "PROGRAM":
      return "US cohort";
    default:
      return null;
  }
}

/**
 * A stable tint index for a skill name.
 *
 * Same hash the design mockup uses, so "React" is the same hue on every card,
 * in the inspector, and between sessions — the colour is information about the
 * skill, not about where it happened to be rendered.
 */
function skillTint(skill: string): string {
  let hash = 0;
  for (let i = 0; i < skill.length; i += 1) {
    hash = (hash * 31 + skill.charCodeAt(i)) % 997;
  }
  return `desk-pill--c${hash % 6}`;
}

export function DeskMatchCard({
  match,
  rank,
  selected,
  onOpen,
  onCartToggle,
  sampleDemand,
}: {
  match: MatchCardData;
  rank?: number;
  selected?: boolean;
  onOpen?: () => void;
  onCartToggle?: (inCart: boolean) => void;
  sampleDemand?: SampleDemand;
}) {
  const sample = match.candidateRef.startsWith("SAMPLE:");
  const e = match.evidence ?? {};
  const publicId = refPublicId(match.candidateRef);
  const skills = e.skills ?? [];
  const needles = match.highlightSkills ?? [];
  const track = trackLabel(match.source);
  const isChallenge = match.source === "CLAUDE" || match.source === "CHALLENGE_60";
  const workLabel = isChallenge ? "days shipped" : "missions passed";
  const totalDays = e.totalTrackDays;

  if (sample) {
    return (
      <article className="desk-card desk-card--sample">
        {sampleDemand && <SampleCardNotice {...sampleDemand} />}
        <h3 className="desk-card__role" style={{ marginTop: 12 }}>
          {match.jobRole}
        </h3>
        {typeof e.yearsExperience === "number" && e.yearsExperience > 0 && (
          <p className="desk-card__ref">{e.yearsExperience}+ years</p>
        )}
        {skills.length > 0 && (
          <div className="desk-card__facts">
            {skills.map((s) => (
              <span key={s} className={`desk-pill ${skillTint(s)}`}>
                {s}
              </span>
            ))}
          </div>
        )}
        <p className="desk-card__why">
          This is what a match would look like. Nobody in the pool fits it yet.
        </p>
        {onOpen && (
          <div className="desk-card__cta">
            <button type="button" className="desk-ghost" onClick={onOpen}>
              View more details
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </article>
    );
  }

  return (
    <article
      className={cn(
        "desk-card",
        rank === 1 && "desk-card--top",
        selected && "is-selected",
      )}
    >
      <header className="desk-card__head">
        <div className="desk-card__who">
          <span className="desk-card__avatar" aria-hidden="true">
            <UserRound className="size-7" />
          </span>
          <div>
            <p className="desk-card__role">
              {match.displayName || match.jobRole}
              {rank === 1 && <span className="desk-card__top">Top match</span>}
            </p>
            {(skills.length > 0 || match.displayName) && (
              <p className="desk-card__stack">
                {skills.length > 0
                  ? skills.slice(0, 6).join(" · ")
                  : match.jobRole}
              </p>
            )}
            <p className="desk-card__ref">
              {[match.locationLabel, publicId].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <div className="desk-card__right">
          <div className="desk-card__score">
            <div>
              <b>{match.score}</b>
              {match.tier !== "STRONG" && (
                <span className="desk-card__partial">{match.tier}</span>
              )}
            </div>
            <span>out of 100</span>
          </div>
          <DeskShortlistButton
            candidateRef={match.candidateRef}
            jobRole={match.jobRole}
            match={match}
          />
        </div>
      </header>

      <div className="desk-card__facts">
        {track && <span className="desk-pill">{track}</span>}
        {match.source === "HACKATHON" && (
          <span className="desk-pill desk-pill--good">Shipped project</span>
        )}
        {match.source !== "HACKATHON" && typeof e.missionsPassed === "number" && (
          <span className="desk-pill desk-pill--good">
            {e.missionsPassed}
            {totalDays ? ` of ${totalDays}` : ""} {workLabel}
          </span>
        )}
        {e.certificateIssued && (
          <span className="desk-pill desk-pill--good">Certified</span>
        )}
        {typeof e.quizAverage === "number" && (
          <span className="desk-pill desk-pill--good">Quiz {e.quizAverage}</span>
        )}
        {typeof e.cleanPassCount === "number" && e.cleanPassCount > 0 && (
          <span className="desk-pill desk-pill--good">
            {e.cleanPassCount} first-attempt
          </span>
        )}
        {typeof e.yearsExperience === "number" && e.yearsExperience > 0 && (
          <span className="desk-pill">{e.yearsExperience} yrs</span>
        )}
        {(e.workingLanguages ?? []).slice(0, 3).map((l) => (
          <span key={l} className="desk-pill desk-pill--good">
            {l.toLowerCase()}
          </span>
        ))}
        {skills.slice(0, 5).map((s) => {
          const hit = needles.some((n) =>
            s.toLowerCase().includes(n.toLowerCase()),
          );
          return (
            <span
              key={s}
              // A skill the recruiter asked for keeps the emphasis mark; the
              // rest take their own tint. Dropping the hit state to match the
              // mockup would lose which skill actually answered the search.
              className={
                hit ? "desk-pill desk-pill--hit" : `desk-pill ${skillTint(s)}`
              }
            >
              {s}
            </span>
          );
        })}
        {match.compensationBand && (
          <span className="desk-pill">est. {match.compensationBand}</span>
        )}
        {match.availabilityUnknown && (
          <span className="desk-pill desk-pill--warn">Availability unconfirmed</span>
        )}
      </div>

      {match.rationale && <p className="desk-card__why">{match.rationale}</p>}

      <div className="desk-card__cta">
        <button type="button" className="desk-ghost" onClick={onOpen}>
          View more details
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </button>
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
          className={cn("desk-pod", match.shortlisted && "desk-pod--on")}
          podLabel
        />
        <RequestIntroButton
          candidateRef={match.candidateRef}
          existingStatus={match.engagementStatus ?? null}
          publicId={publicId}
          className="desk-request"
        />
      </div>
    </article>
  );
}
