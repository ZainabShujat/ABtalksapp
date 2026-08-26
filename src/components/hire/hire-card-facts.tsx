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
/**
 * Three skill pills, everywhere.
 *
 * Three cards drew this row and each picked its own number — 5, 5 and 4 — so
 * capping one of them left the others as tag clouds. A card carrying five skill
 * pills on top of the evidence pills is read to the second one and abandoned.
 *
 * The evidence pills are not capped with them: "24 of 31 missions passed" is the
 * one thing on this card a CV cannot claim, so it is the last thing that should
 * be trimmed for space.
 */
export const SKILL_PILL_CAP = 3;

/** Hard ceiling on the row. Everything else lives behind View details. */
export const MAX_CARD_PILLS = 5;


export type CardPill = { key: string; label: string; className: string };

/**
 * The pills a card shows, in the order they earn their place — and no more
 * than five of them.
 *
 * Five because everything is on the card behind "View details" anyway. A row
 * that wraps to three lines is not more information, it is less: the reader
 * stops at the second pill either way, so the only question is which two they
 * see.
 *
 * The order is the answer to that. Matched skills come first, because they are
 * why this person surfaced at all. Then the evidence headline, which is the one
 * claim here a CV cannot make. Then an availability warning, because it changes
 * what the recruiter does next. Everything after that is context, and context
 * is what the details view is for.
 *
 * One builder, used by every card that draws this row. Three components used to
 * each keep their own copy of this list and they had already drifted apart —
 * different skill caps, and pills on one that were absent from another.
 */
export function buildCardPills(
  match: Pick<
    MatchCardData,
    | "evidence"
    | "source"
    | "highlightSkills"
    | "compensationBand"
    | "compensationDeclared"
    | "availabilityUnknown"
  >,
  max: number = MAX_CARD_PILLS,
): CardPill[] {
  const e = match.evidence ?? {};
  const skills = e.skills ?? [];
  const needles = match.highlightSkills ?? [];
  const track = trackLabel(match.source);
  const isChallenge = match.source === "CLAUDE" || match.source === "CHALLENGE_60";
  const workLabel = isChallenge ? "days shipped" : "missions passed";

  const isHit = (s: string) =>
    needles.some((n) => s.toLowerCase().includes(n.toLowerCase()));
  // Matched skills first, in the recruiter's own order of interest.
  const ranked = [...skills.filter(isHit), ...skills.filter((s) => !isHit(s))];

  const out: CardPill[] = [];
  const push = (key: string, label: string, className: string) =>
    out.push({ key, label, className });

  for (const s of ranked.slice(0, SKILL_PILL_CAP)) {
    push(
      `skill:${s}`,
      s,
      isHit(s) ? "desk-pill desk-pill--hit" : `desk-pill ${skillTint(s)}`,
    );
  }

  if (match.source === "HACKATHON") {
    push("shipped", "Shipped project", "desk-pill desk-pill--good");
  } else if (typeof e.missionsPassed === "number") {
    const total = e.totalTrackDays ? ` of ${e.totalTrackDays}` : "";
    push("missions", `${e.missionsPassed}${total} ${workLabel}`, "desk-pill desk-pill--good");
  }

  if (match.availabilityUnknown) {
    push("availability", "Availability unconfirmed", "desk-pill desk-pill--warn");
  }
  if (e.certificateIssued) push("certified", "Certified", "desk-pill desk-pill--good");
  if (typeof e.cleanPassCount === "number" && e.cleanPassCount > 0) {
    push("clean", `${e.cleanPassCount} first-attempt`, "desk-pill desk-pill--good");
  }
  if (typeof e.quizAverage === "number") {
    push("quiz", `Quiz ${e.quizAverage}`, "desk-pill desk-pill--good");
  }
  if (match.compensationBand) {
    const prefix = match.compensationDeclared ? "" : "est. ";
    push("band", `${prefix}${match.compensationBand}`, "desk-pill");
  }
  if (track) push("track", track, "desk-pill");

  return out.slice(0, Math.max(0, max));
}

/**
 * `compact` is still accepted because callers pass it, but it no longer changes
 * the row: the cap is five everywhere, and a card that showed fewer pills in a
 * narrow column was the same card telling a recruiter less for no reason.
 */
export function MatchPills({
  match,
}: {
  match: MatchCardData;
  compact?: boolean;
}) {
  return (
    <div className="desk-card__facts">
      {buildCardPills(match).map((pill) => (
        <span key={pill.key} className={pill.className}>
          {pill.label}
        </span>
      ))}
    </div>
  );
}
