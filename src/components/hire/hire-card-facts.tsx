import type { CandidateSource } from "@/features/hire/candidate-ref";
import { missionsLine } from "@/features/hire/candidate-summary";
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

/**
 * "Open to work", beside the candidate's name.
 *
 * One component, seven call sites: the alternative is seven copies of the same
 * conditional, which is exactly how the pill rows drifted apart before
 * `buildCardPills` pulled them together.
 *
 * It renders nothing unless the answer is a definite yes — `false` and a missing
 * value are the same thing here, and neither is a claim about the candidate. The
 * null return lives inside the component so every call site stays a bare tag
 * with no surrounding conditional to forget.
 *
 * Deliberately NOT part of `buildCardPills`: every surface that draws that row
 * also prints a name, so a pill would be a duplicate and would spend one of the
 * four or five slots that carry matched skills and the evidence headline.
 *
 * This says the candidate is *looking*. It says nothing about whether a
 * recruiter may find them — that is `CandidateVisibility.searchableByRecruiters`,
 * enforced in `repositories/talent.ts`, and the two must never be wired together.
 */
export function OpenToWorkBadge({ openToWork }: { openToWork?: boolean }) {
  if (openToWork !== true) return null;
  return (
    <span
      className="hire-open-to-work inline-flex items-center rounded-full bg-[#18D39B]/10 px-2 py-0.5 text-xs font-semibold text-[#197E23] dark:text-[#D6F7EC]"
      title="This candidate has told us they are actively looking. It does not change who can find them."
    >
      Open to work
    </span>
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

  const isHit = (s: string) =>
    needles.some((n) => s.toLowerCase().includes(n.toLowerCase()));
  // Matched skills first, in the recruiter's own order of interest.
  const ranked = [...skills.filter(isHit), ...skills.filter((s) => !isHit(s))];

  const out: CardPill[] = [];
  // Set once the mission pill has already named the track, so the row does not
  // then print "60-day" beside "42 of 60 missions of 60-Day Challenge".
  let namedTrack = false;
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
  } else {
    // One wording for the mission count, shared with the evidence section and
    // the summaries: "42 of 60 missions of 60-Day Challenge". Null when there
    // is nothing passed, so a bare "0" never reads as a result.
    const missions = missionsLine({
      source: match.source,
      missionsPassed: e.missionsPassed ?? null,
      totalTrackDays: e.totalTrackDays ?? null,
    });
    if (missions) {
      push("missions", missions, "desk-pill desk-pill--good");
      namedTrack = true;
    }
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
  if (track && !namedTrack) push("track", track, "desk-pill");

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

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Which of the seven evidence dimensions this ranking actually used.
 *
 * The result card's AI Summary falls back to this when Scout wrote no
 * rationale, and the profile panel prints it under its own summary — so it
 * lives here, beside the other card facts, rather than in either component.
 */
export function coverageLede(match: MatchCardData): string {
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
  const absent = joinList(missing);
  return (
    `Ranked on ${have.length} of 7 evidence dimensions. ` +
    `${absent.charAt(0).toUpperCase()}${absent.slice(1)} ` +
    `${verb} not been recorded for this candidate yet, so ${they} excluded rather than counted as zero.`
  );
}
