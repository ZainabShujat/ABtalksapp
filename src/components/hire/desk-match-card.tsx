"use client";

import type { MouseEvent } from "react";
import { ChevronRight, UserRound } from "lucide-react";
import { DeskShortlistButton } from "@/components/hire/desk-shortlist-button";
import { ShortlistButton } from "@/components/talent/shortlist-button";
import {
  SampleCardNotice,
  type SampleDemand,
} from "@/components/hire/sample-card-notice";
import type { MatchCardData } from "@/components/hire/match-card";
import { isLockedPreview } from "@/features/hire/locked-preview";
import {
  LockedField,
  UpgradeNotice,
  useUpgradePrompt,
} from "@/components/hire/locked-field";
import { cn } from "@/lib/utils";
import { buildCardPills } from "@/components/hire/hire-card-facts";

/**
 * Tags shown on a Scout result card.
 *
 * Four, not the shared `MAX_CARD_PILLS` of five: the row sits beside the score
 * column and a fifth tag is what pushed it onto a second line. Saved for later
 * and the shortlist pod keep the shared cap — they have the full width.
 */
const DESK_CARD_PILLS = 4;

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

/**
 * A stand-in surname of the same length as the real one.
 *
 * Deterministic from the name itself, so a candidate's block does not change
 * shape between renders, and never derived from the real letters — the point is
 * that the actual surname is not written into the page at all. It is only ever
 * seen through a blur, so the letters carry no meaning; what matters is that the
 * word is the right length and has a name-like silhouette.
 */
const MASK_LETTERS = "abcdefghijklmnopqrstuvwxyz";

function decoySurname(seedText: string, length: number): string {
  let seed = 0;
  for (let i = 0; i < seedText.length; i += 1) {
    seed = (seed * 31 + seedText.charCodeAt(i)) % 9973;
  }
  let out = "";
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 73 + 41) % 9973;
    out += MASK_LETTERS[seed % MASK_LETTERS.length];
  }
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/**
 * Given name in the clear, family name behind a blur.
 *
 * The blur is CSS, but the text under it is a decoy — the real surname is never
 * put in the DOM, so this is not the "blur over real text" that `LockedField`
 * warns about. Reading the page source yields nothing.
 *
 * A single-token name is left alone: there is no family name to hide, and
 * blurring the only word would leave the card anonymous.
 */
export function splitName(name: string): { given: string; masked: string | null } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { given: name.trim(), masked: null };
  const family = parts.slice(1).join(" ");
  return {
    given: parts[0]!,
    // At least four glyphs so a two-letter surname still reads as a word.
    masked: decoySurname(name, Math.max(4, Array.from(family).length)),
  };
}

/**
 * The card's name treatment, as a component so the inspector can render the
 * identical thing. Two hand-rolled copies would drift, and the surname showing
 * clear in the panel while blurred on the card is exactly the inconsistency
 * this exists to stop.
 */
export function MaskedName({ name }: { name: string }) {
  const { given, masked } = splitName(name);
  return (
    <span className="desk-name">
      <span>{given}</span>
      {masked && (
        <span className="desk-name__gate" aria-label="Surname hidden">
          <span aria-hidden="true">{masked}</span>
        </span>
      )}
    </span>
  );
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
  const preview = isLockedPreview(match) ? match.preview : null;
  const { upgradeOpen, openUpgrade, dismissUpgrade } = useUpgradePrompt();
  const e = match.evidence ?? {};
  const skills = e.skills ?? [];

  // The card is the click target, not just the "View more details" link.
  // Everything interactive inside it — the two shortlist buttons, the intro
  // button, the locked-field reveals — must keep its own click, and a click that
  // ends a text selection is a read, not a request to open the panel.
  function openFromCard(event: MouseEvent<HTMLElement>) {
    if (!onOpen) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, label, select, textarea, [role='button']")) {
      return;
    }
    if ((window.getSelection()?.toString() ?? "").length > 0) return;
    onOpen();
  }

  if (preview) {
    const p = preview;
    return (
      <article
        className={cn("desk-card", "desk-card--locked", onOpen && "desk-card--clickable")}
        onClick={openFromCard}
      >
        {sampleDemand && <SampleCardNotice {...sampleDemand} />}
        <div className="desk-card__head" style={{ marginTop: 12 }}>
          <div className="desk-card__who">
            <span className="desk-card__avatar" aria-hidden="true">
              <UserRound className="size-5" />
            </span>
            <div className="min-w-0">
              <h3 className="desk-card__role">
                <LockedField
                  value={p.displayName}
                  label="Candidate name"
                  onReveal={openUpgrade}
                />
              </h3>
              <p className="desk-card__ref">
                {match.jobRole}
                {typeof e.yearsExperience === "number" && e.yearsExperience > 0
                  ? ` · ${e.yearsExperience}+ yrs`
                  : ""}
              </p>
              <p className="desk-card__stack">
                <LockedField
                  value={p.locationLabel}
                  label="Location"
                  onReveal={openUpgrade}
                />
                {" · "}
                <LockedField
                  value={p.educationLine}
                  label="Education"
                  onReveal={openUpgrade}
                />
              </p>
            </div>
          </div>
        </div>

        {(e.skills ?? []).length > 0 && (
          <div className="desk-card__facts">
            {(e.skills ?? []).map((sk) => (
              <span key={sk} className={`desk-pill ${skillTint(sk)}`}>
                {sk}
              </span>
            ))}
          </div>
        )}

        <p className="desk-card__stack" style={{ marginTop: 10 }}>
          Expected{" "}
          <LockedField
            value={p.compensationBand}
            label="Expected compensation"
            onReveal={openUpgrade}
          />
        </p>

        {upgradeOpen && <UpgradeNotice onDismiss={dismissUpgrade} />}

        <p className="desk-card__why">
          An example of what a full profile looks like — not a person in the
          pool. Blurred fields are what Pro fills in.
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

  if (sample) {
    return (
      <article
        className={cn("desk-card", "desk-card--sample", onOpen && "desk-card--clickable")}
        onClick={openFromCard}
      >
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
        onOpen && "desk-card--clickable",
      )}
      onClick={openFromCard}
    >
      <header className="desk-card__head">
        <div className="desk-card__who">
          <span className="desk-card__avatar" aria-hidden="true">
            <UserRound className="size-7" />
          </span>
          <div>
            <p className="desk-card__role">
              {match.displayName ? (
                <MaskedName name={match.displayName} />
              ) : (
                match.jobRole
              )}
              {rank === 1 && <span className="desk-card__top">Top match</span>}
            </p>
            {(skills.length > 0 || match.displayName) && (
              <p className="desk-card__stack">
                {skills.length > 0
                  ? skills.slice(0, 6).join(" · ")
                  : match.jobRole}
              </p>
            )}
            {/* The public id (AB-xxxx) is not shown on this card. `refPublicId`
                is untouched and every other surface still uses it — the
                inspector derives its own, and the shortlist and evidence cache
                key on it. The filter already drops empties, so a card with no
                location renders nothing rather than a stray separator. */}
            <p className="desk-card__ref">
              {[match.locationLabel].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <div className="desk-card__right">
          <div className="desk-card__score">
            {/* The tier label (PARTIAL / NONE) is not printed. `match.tier`
                is untouched and still drives ordering, the gap report and the
                inspector — the number and its denominator are what the card
                shows. */}
            <div>
              <b>{match.score}</b>
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

      {/*
        The "Availability unconfirmed" pill is dropped here rather than in
        `buildCardPills`, which is shared: `MatchPills` draws the same row in
        Saved for later and in the shortlist pod, and both should keep the
        warning. Filtering on the builder's own `key` — the same string it
        pushes — keeps the two in step without a second copy of the list.

        The underlying `match.availabilityUnknown` is untouched, so the gap it
        drives in the inspector and the outreach note still say it.

        The row is capped at four here rather than the shared MAX_CARD_PILLS of
        five — the reference card carries four tags and the fifth is what made
        the row wrap on a narrow column. The builder is asked for more than four
        and re-capped after the filter, because it slices to its own cap first:
        filtering its result alone would leave four minus one whenever
        availability landed inside the slice, i.e. a dropped pill rather than a
        hidden one.
      */}
      <div className="desk-card__facts">
        {buildCardPills(match, DESK_CARD_PILLS + 2)
          .filter((pill) => pill.key !== "availability")
          .slice(0, DESK_CARD_PILLS)
          .map((pill) => (
            <span key={pill.key} className={pill.className}>
              {pill.label}
            </span>
          ))}
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
        {/*
          "Request an intro" is deliberately not on this card.

          The button, its server action and the whole engagement flow are
          untouched — `RequestIntroButton` still renders in `CandidateInspector`
          (behind "View more details") and in `MatchCard`, which is what the
          guest-matches and request pages use. Only the Scout desk's own card
          stops offering it, so the recruiter reads the profile before asking
          for an introduction rather than firing one off the results list.

          `desk-card__cta` is flex with `justify-content: flex-end`, so the two
          remaining actions close up on their own; no spacing to adjust.
        */}
      </div>
    </article>
  );
}
