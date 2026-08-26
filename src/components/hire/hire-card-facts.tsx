import type { CandidateSource } from "@/features/hire/candidate-ref";
import type { MatchCardData } from "@/components/hire/match-card";

export function trackLabel(source?: CandidateSource): string | null {
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
export function skillTint(skill: string): string {
  let hash = 0;
  for (let i = 0; i < skill.length; i += 1) {
    hash = (hash * 31 + skill.charCodeAt(i)) % 997;
  }
  return `desk-pill--c${hash % 6}`;
}

function MetaTag({
  kind,
  children,
}: {
  kind: "exp" | "location" | "employment" | "education";
  children: string;
}) {
  return (
    <span className={`hire-meta hire-meta--${kind}`}>
      <MetaIcon kind={kind} />
      <span>{children}</span>
    </span>
  );
}

function MetaIcon({
  kind,
}: {
  kind: "exp" | "location" | "employment" | "education";
}) {
  if (kind === "exp") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }
  if (kind === "location") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
        <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
        <circle cx="12" cy="10" r="2.4" />
      </svg>
    );
  }
  if (kind === "education") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
        <path d="m3 9 9-5 9 5-9 5-9-5Z" />
        <path d="M7 11.5v4.2c0 .5 2.2 2.3 5 2.3s5-1.8 5-2.3v-4.2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
    </svg>
  );
}

/** Recruiter-facing attributes that sit under the name. Missing stays off. */
export function MatchMetaTags({ match }: { match: Pick<MatchCardData, "evidence" | "locationLabel"> }) {
  const e = match.evidence ?? {};
  const years =
    typeof e.yearsExperience === "number" && e.yearsExperience > 0
      ? `${e.yearsExperience} yr${e.yearsExperience === 1 ? "" : "s"}`
      : null;
  return (
    <p className="hire-meta-row">
      {years && <MetaTag kind="exp">{years}</MetaTag>}
      {match.locationLabel && (
        <MetaTag kind="location">{match.locationLabel}</MetaTag>
      )}
      {e.workMode && <MetaTag kind="employment">{e.workMode}</MetaTag>}
      {e.educationLevel && (
        <MetaTag kind="education">{e.educationLevel}</MetaTag>
      )}
    </p>
  );
}

/** Evidence + skill pills used on list cards. */
export function MatchPills({
  match,
  compact = false,
}: {
  match: MatchCardData;
  compact?: boolean;
}) {
  const e = match.evidence ?? {};
  const skills = e.skills ?? [];
  const needles = match.highlightSkills ?? [];
  const track = trackLabel(match.source);
  const isChallenge = match.source === "CLAUDE" || match.source === "CHALLENGE_60";
  const workLabel = isChallenge ? "days shipped" : "missions passed";
  const totalDays = e.totalTrackDays;
  const skillCap = compact ? 4 : 5;

  return (
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
      {skills.slice(0, skillCap).map((s) => {
        const hit = needles.some((n) =>
          s.toLowerCase().includes(n.toLowerCase()),
        );
        return (
          <span
            key={s}
            className={
              hit ? "desk-pill desk-pill--hit" : `desk-pill ${skillTint(s)}`
            }
          >
            {s}
          </span>
        );
      })}
      {match.compensationBand && (
        <span className="desk-pill">
          {match.compensationDeclared ? "" : "est. "}
          {match.compensationBand}
        </span>
      )}
      {match.availabilityUnknown && (
        <span className="desk-pill desk-pill--warn">Availability unconfirmed</span>
      )}
    </div>
  );
}
