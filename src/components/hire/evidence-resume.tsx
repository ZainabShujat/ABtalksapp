"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { COMPENSATION_DISCLAIMER } from "@/features/hire/compensation";
import { refPublicId, type CandidateSource } from "@/features/hire/candidate-ref";
import {
  recallEvidence,
} from "@/components/hire/evidence-cache";
import type { MatchCardData } from "@/components/hire/match-card";

function trackLabel(source?: CandidateSource): string | null {
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

function firstAttempt(e: MatchCardData["evidence"]): string | null {
  if (typeof e.cleanPassCount !== "number") return null;
  if (e.cleanPassCount <= 0) return "None recorded";
  return String(e.cleanPassCount);
}

function evidenceBlurb(match: MatchCardData): string {
  if (match.rationale?.trim()) return match.rationale.trim();
  const e = match.evidence ?? {};
  const bits: string[] = [];
  if (typeof e.missionsPassed === "number") {
    const total = e.totalTrackDays;
    bits.push(
      total
        ? `${e.missionsPassed} of ${total} missions passed`
        : `${e.missionsPassed} missions passed`,
    );
  }
  if (typeof e.cleanPassCount === "number" && e.cleanPassCount > 0) {
    bits.push(`${e.cleanPassCount} first-attempt passes`);
  }
  if (typeof e.commitDayCount === "number" && e.commitDayCount > 0) {
    bits.push(`${e.commitDayCount} verified commit days`);
  }
  if (e.projectScores?.length) {
    bits.push(`${e.projectScores.length} graded project${e.projectScores.length === 1 ? "" : "s"}`);
  }
  if (e.certificateIssued) bits.push("certificate issued");
  if (bits.length === 0) {
    return (
      match.coverageNote ??
      "Identity stays hidden until you place a request and the candidate agrees. Figures below are platform-verified where labelled."
    );
  }
  return `Verified: ${bits.join(", ")}.`;
}

function Cell({ k, v }: { k: string; v: string | null }) {
  return (
    <div>
      <div className="hire-sheet__k">{k}</div>
      <div className={v ? "hire-sheet__v" : "hire-sheet__v is-empty"}>
        {v ?? "Not shared"}
      </div>
    </div>
  );
}

function BackToScout() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="hire-back"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push("/hire");
      }}
    >
      <ChevronLeft aria-hidden="true" />
      Back to Scout
    </button>
  );
}

export function EvidenceResume({ lookup }: { lookup: string }) {
  const [match, setMatch] = useState<MatchCardData | null | undefined>(
    undefined,
  );

  useEffect(() => {
    setMatch(recallEvidence(lookup));
  }, [lookup]);

  if (match === undefined) {
    return (
      <main className="hire-sheet">
        <BackToScout />
        <p className="hire-sheet__missing">Loading evidence…</p>
      </main>
    );
  }

  if (!match) {
    return (
      <main className="hire-sheet">
        <BackToScout />
        <p className="hire-sheet__missing">
          No candidate matches the reference
          {lookup ? (
            <>
              {" "}
              <b>{lookup}</b>
            </>
          ) : (
            " provided"
          )}
          . Run a search in Scout, then open Resume from the card.
        </p>
      </main>
    );
  }

  const e = match.evidence ?? {};
  const sample = match.candidateRef.startsWith("SAMPLE:");
  const publicId = refPublicId(match.candidateRef);
  const track = trackLabel(match.source);
  const isChallenge =
    match.source === "CLAUDE" || match.source === "CHALLENGE_60";
  const missionsLabel = isChallenge ? "Days shipped" : "Missions passed";
  const missionsValue =
    typeof e.missionsPassed === "number"
      ? e.totalTrackDays
        ? `${e.missionsPassed} of ${e.totalTrackDays}`
        : String(e.missionsPassed)
      : match.source === "HACKATHON"
        ? "Shipped project"
        : null;

  return (
    <main className="hire-sheet">
      <BackToScout />

      <div className="hire-sheet__top">
        <div>
          <h1 className="hire-sheet__name">{match.jobRole}</h1>
          <p className="hire-sheet__sub">
            {sample
              ? "Sample profile — not a person in the pool"
              : [match.locationLabel, publicId, track]
                  .filter(Boolean)
                  .join(" · ")}
          </p>
        </div>
        {!sample && (
          <div className="hire-sheet__score">
            <b>{match.score}</b>
            <span>out of 100</span>
          </div>
        )}
      </div>

      <div className="hire-sheet__tags">
        {track && <span className="desk-pill">{track}</span>}
        {missionsValue && (
          <span className="desk-pill desk-pill--good">
            {missionsValue} {isChallenge ? "days shipped" : "missions passed"}
          </span>
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
        {match.availabilityUnknown && (
          <span className="desk-pill desk-pill--warn">
            Availability unconfirmed
          </span>
        )}
      </div>

      <div className="hire-sheet__rule" />

      <div className="hire-sheet__grid">
        <Cell k="AB score" v={sample ? null : `${match.score}/100`} />
        <Cell k="Tier" v={sample ? null : match.tier || null} />
        <Cell
          k="Experience"
          v={
            typeof e.yearsExperience === "number"
              ? `${e.yearsExperience} yrs`
              : null
          }
        />
        <Cell k={missionsLabel} v={missionsValue} />
        <Cell k="First-attempt" v={firstAttempt(e)} />
        <Cell
          k="Verified commits"
          v={
            typeof e.commitDayCount === "number"
              ? String(e.commitDayCount)
              : null
          }
        />
        <Cell
          k="Projects"
          v={
            e.projectScores?.length
              ? e.projectScores.join(" / ")
              : null
          }
        />
        <Cell
          k="Quiz average"
          v={typeof e.quizAverage === "number" ? String(e.quizAverage) : null}
        />
        <Cell k="Certificate" v={e.certificateIssued ? "Issued" : null} />
        <Cell
          k="Cohort day"
          v={typeof e.cohortDay === "number" ? `Day ${e.cohortDay}` : null}
        />
        <Cell k="Track" v={track} />
        <Cell k="Location" v={match.locationLabel ?? null} />
        <Cell
          k="Languages"
          v={(e.workingLanguages ?? []).join(" · ") || null}
        />
        <Cell k="Est. compensation" v={match.compensationBand ?? null} />
        <Cell k="Reference" v={sample ? null : publicId} />
      </div>

      <section className="hire-sheet__section">
        <h2 className="hire-sheet__h">Verified evidence</h2>
        <p className="hire-sheet__p">{evidenceBlurb(match)}</p>
      </section>

      {(e.skills?.length ?? 0) > 0 && (
        <section className="hire-sheet__section">
          <h2 className="hire-sheet__h">Skills — declared by the candidate</h2>
          <div className="hire-sheet__tags" style={{ marginTop: 0 }}>
            {e.skills!.map((s) => (
              <span key={s} className="desk-pill">
                {s}
              </span>
            ))}
          </div>
        </section>
      )}

      {match.gaps.length > 0 && (
        <section className="hire-sheet__section">
          <h2 className="hire-sheet__h">Gaps</h2>
          {match.gaps.map((g) => (
            <p key={g} className="hire-sheet__li">
              {g}
            </p>
          ))}
        </section>
      )}

      <p className="hire-sheet__note">
        This is an ABTalks evidence record, not a self-written resume. Mission,
        first-attempt, commit and project figures are verified by the platform.
        Experience, skills and role are declared by the candidate.
        {match.compensationBand ? ` ${COMPENSATION_DISCLAIMER}` : ""}{" "}
        Compensation and availability are confirmed at outreach.
      </p>
    </main>
  );
}
