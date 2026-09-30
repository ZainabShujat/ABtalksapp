"use client";

import type { MouseEvent } from "react";
import {
  Briefcase,
  ChevronDown,
  ChevronRight,
  Clock,
  GraduationCap,
  MapPin,
  UserCheck,
  UserRound,
  X,
} from "lucide-react";
import { DeskShortlistButton } from "@/components/hire/desk-shortlist-button";
import { ShortlistButton } from "@/components/talent/shortlist-button";
import { buttonVariants } from "@/components/ui/button";
import {
  SampleCardNotice,
  type SampleDemand,
} from "@/components/hire/sample-card-notice";
import type {
  MatchCardData,
  MatchDecision,
  MatchTriage,
} from "@/components/hire/match-card";
import { isLockedPreview } from "@/features/hire/locked-preview";
import {
  LockedField,
  UpgradeNotice,
  useUpgradePrompt,
} from "@/components/hire/locked-field";
import { cn } from "@/lib/utils";
import { OpenToWorkBadge } from "@/components/hire/hire-card-facts";
import {
  candidateSummaryLine,
  summaryInputFromMatch,
} from "@/features/hire/candidate-summary";

/** Skill chips on a result card before the rest collapse into "+N". */
const CARD_SKILLS = 8;

/** Roughly two lines on the card, before the sentence-boundary trim below. */
const SUMMARY_PREVIEW_CHARS = 165;

/**
 * The card's share of the AI summary — a preview, not the rationale.
 *
 * The card exists to be scanned: a recruiter reads down a list deciding who to
 * open, and a full paragraph per candidate turns eight cards into a page of
 * prose and one candidate per screen. The whole rationale is two clicks away
 * in the detail panel, and nothing is dropped from the data — this only
 * changes what the card shows.
 *
 * Cuts on a sentence end where there is one in range, so the preview reads as
 * a finished thought rather than a severed clause; falls back to a word
 * boundary otherwise. The CSS line-clamp behind this is a second safety net
 * for a single very long sentence, not the primary mechanism — clamping alone
 * would still ship the whole string to the browser and still break mid-word.
 */
export function summaryPreview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= SUMMARY_PREVIEW_CHARS) return flat;

  const window = flat.slice(0, SUMMARY_PREVIEW_CHARS);
  // A sentence end, but only if it lands in the back half — cutting at the
  // first full stop of a long paragraph would throw away most of the preview.
  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );
  if (sentence > SUMMARY_PREVIEW_CHARS * 0.5) {
    return flat.slice(0, sentence + 1);
  }
  const space = window.lastIndexOf(" ");
  return `${flat.slice(0, space > 0 ? space : SUMMARY_PREVIEW_CHARS).trimEnd()}…`;
}

const WORK_MODE: Record<string, string> = {
  ONSITE: "Onsite",
  HYBRID: "Hybrid",
  REMOTE: "Remote",
  FLEXIBLE: "Flexible",
};

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
 *
 * `revealed` is true only after this recruiter has CONTACT_SHARED access.
 * Until then the family name stays a decoy behind the blur (D-1.7).
 */
export function MaskedName({
  name,
  revealed = false,
}: {
  name: string;
  revealed?: boolean;
}) {
  if (revealed) {
    return <span className="desk-name">{name}</span>;
  }
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
  onDecision,
  requestId,
}: {
  match: MatchCardData & Partial<MatchTriage>;
  rank?: number;
  selected?: boolean;
  onOpen?: () => void;
  onCartToggle?: (inCart: boolean) => void;
  sampleDemand?: SampleDemand;
  onDecision?: (decision: MatchDecision) => void;
  requestId?: string | null;
}) {
  const sample = match.candidateRef.startsWith("SAMPLE:");
  const preview = isLockedPreview(match) ? match.preview : null;
  const decision = match.decision ?? "UNDECIDED";
  const rejected = decision === "REJECTED";
  const showTriage = Boolean(requestId && match.candidateUserId && onDecision);

  function pickDecision(next: MatchDecision) {
    if (!onDecision) return;
    onDecision(decision === next ? "UNDECIDED" : next);
  }
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
          An example of what a full profile looks like, not a person in the
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

  // The result card (Figma 1646:209). Score and evidence pills are not on it —
  // the profile panel carries both; the card is who, where, which skills, and
  // Scout's reason. A missing fact drops out of the meta row rather than
  // printing a placeholder.
  const years =
    typeof e.yearsExperience === "number" && e.yearsExperience > 0
      ? `${e.yearsExperience} yr${e.yearsExperience === 1 ? "" : "s"} experience`
      : null;
  const meta = [
    { key: "location", Icon: MapPin, label: match.locationLabel },
    {
      key: "mode",
      Icon: Clock,
      label: e.workMode ? (WORK_MODE[e.workMode] ?? e.workMode) : null,
    },
    { key: "experience", Icon: Briefcase, label: years },
    { key: "education", Icon: GraduationCap, label: e.educationLevel },
  ].filter((m) => Boolean(m.label));
  const shownSkills = skills.slice(0, CARD_SKILLS);
  // Built here rather than read off `match.rationale`. The stored rationale is
  // two or three sentences written for the detail panel, and rows written
  // before this change still open with an `AB-####` label and a score, which
  // must never reach a card. `summaryPreview` stays as the length clamp.
  const summary = summaryPreview(candidateSummaryLine(summaryInputFromMatch(match)));

  return (
    <article
      className={cn(
        "desk-card",
        "desk-card--result",
        rank === 1 && "desk-card--top",
        selected && "is-selected",
        onOpen && "desk-card--clickable",
        rejected && "desk-card--rejected",
      )}
      onClick={openFromCard}
    >
      <div className="desk-card__row">
        <img
          src="/hire/avatar-card.png"
          alt=""
          width={55}
          height={55}
          className="desk-card__photo"
        />
        <div className="desk-card__body">
          <header className="desk-card__namerow">
            <div className="desk-card__nameblock">
              <div className="desk-card__header">
                <h3 className="desk-card__name">
                  {match.displayName ? (
                    <MaskedName
                      name={match.displayName}
                      revealed={match.engagementStatus === "CONTACT_SHARED"}
                    />
                  ) : (
                    match.jobRole
                  )}
                </h3>
                <OpenToWorkBadge openToWork={match.openToWork} />
                {rank === 1 && <span className="desk-card__badge">Top match</span>}
              </div>
              {meta.length > 0 && (
                <ul className="desk-card__meta">
                  {meta.map(({ key, Icon, label }) => (
                    <li key={key}>
                      <Icon
                        size={16}
                        strokeWidth={2}
                        absoluteStrokeWidth
                        aria-hidden="true"
                      />
                      {label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/* Save for later keeps its own label: "Shortlist" on this button
                as well as on the cart button below would be two controls with
                one name writing to different stores (TC-R-004). */}
            <DeskShortlistButton
              candidateRef={match.candidateRef}
              jobRole={match.jobRole}
              match={match}
            />
          </header>

          {skills.length > 0 && (
            <section className="desk-card__skills" aria-label="Skills">
              <h4 className="desk-card__skills-h">Skills</h4>
              <ul className="desk-card__chips">
                {shownSkills.map((s) => (
                  <li key={s} className="desk-chip">
                    {s}
                  </li>
                ))}
                {skills.length > shownSkills.length && (
                  <li className="desk-chip">
                    +{skills.length - shownSkills.length}
                  </li>
                )}
              </ul>
            </section>
          )}

          <div className="desk-card__ai">
            <p className="desk-card__ai-tab">
              <img
                src="/hire/ai-summary-sparkle.svg"
                alt=""
                width={15}
                height={15}
              />
              AI Summary
            </p>
            <p className="desk-card__ai-text">{summary}</p>
          </div>
        </div>
      </div>

      <div className="desk-card__cta">
        {showTriage && (
          <div className="desk-card__triage" onClick={(e) => e.stopPropagation()}>
            {match.viewedAt ? (
              <span className="desk-badge desk-badge--viewed">Viewed</span>
            ) : match.isNew ? (
              <span className="desk-badge desk-badge--new">New</span>
            ) : null}
            {rejected ? (
              <button
                type="button"
                className="desk-ghost"
                onClick={() => pickDecision("REJECTED")}
              >
                Undo
              </button>
            ) : (
              // Only Reject here. The shortlist action is the labelled button
              // beside it — two controls both reading "Shortlist" on one card,
              // writing to different stores, is what made the first TC-R-004
              // run untestable.
              <button
                type="button"
                className="desk-ghost"
                onClick={() => pickDecision("REJECTED")}
              >
                Reject
              </button>
            )}
          </div>
        )}
        <button type="button" className="desk-ghost" onClick={onOpen}>
          View More Details
          <ChevronDown
            size={12}
            strokeWidth={2}
            absoluteStrokeWidth
            aria-hidden="true"
          />
        </button>
        {showTriage ? (
          // PROJECT CONTEXT (T-149). This writes TalentRequestMatch.decision
          // through setMatchDecisionAction, keyed on requestId +
          // candidateUserId — no ProgramMember, no cohort, so it works for
          // every track. `decision` is read back from the persisted row, so
          // the state survives reload and a different browser rather than
          // living in React.
          //
          // The legacy cart button below is deliberately NOT rendered here:
          // it writes RecruiterShortlistItem (or localStorage) and would be a
          // second, differently-persisted "shortlist" on the same card.
          <button
            type="button"
            aria-pressed={decision === "SHORTLISTED"}
            aria-label={
              decision === "SHORTLISTED" ? "In shortlist" : "Add to shortlist"
            }
            title={
              decision === "SHORTLISTED" ? "In shortlist" : "Add to shortlist"
            }
            onClick={() => pickDecision("SHORTLISTED")}
            className={cn(
              buttonVariants({ variant: "secondary", size: "lg" }),
              "shrink-0 gap-1.5 desk-pod",
              decision === "SHORTLISTED" && "desk-pod--on",
            )}
          >
            {decision === "SHORTLISTED" ? (
              <X className="size-3.5" aria-hidden="true" />
            ) : (
              <UserCheck
                size={14}
                strokeWidth={2}
                absoluteStrokeWidth
                aria-hidden="true"
              />
            )}
            {decision === "SHORTLISTED" ? "In shortlist" : "Add to shortlist"}
          </button>
        ) : (
          // No project = no TalentRequestMatch row to decide on, so the desk
          // keeps its existing device/cart behaviour untouched.
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
        )}
        {/*
          "Request an intro" is deliberately not on this card.

          The button, its server action and the whole engagement flow are
          untouched — `RequestIntroButton` still renders in `MatchCard`, which
          is what the guest-matches and request pages use. Only the Scout
          desk's own card stops offering it, so the recruiter reads the profile
          before asking for an introduction rather than firing one off the
          results list.
        */}
      </div>
    </article>
  );
}
