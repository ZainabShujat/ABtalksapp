"use client";

import type { CandidateRecruiterView } from "@/features/profile/recruiter-view";
import { InfoIcon, MetaIcon, TickIcon } from "./rv-icons";

/**
 * The ranked card a recruiter meets first, rebuilt for the candidate's own page.
 *
 * Content-faithful to `components/hire/match-card.tsx`, styled from
 * `recruiter-view.css` rather than the recruiter stylesheet. What is deliberately
 * NOT here: the AB score and tier (they belong to one recruiter's search, not to
 * the candidate), the shortlist and cart controls, and anything contact-shaped.
 *
 * Pure render. Every value arrives pre-computed from the server.
 */
export function SearchCardPreview({
  card,
}: {
  card: CandidateRecruiterView["card"];
}) {
  const initials = card.givenName.trim().slice(0, 2).toUpperCase() || "AB";

  return (
    <div className="rv-frame">
      <div className="rv-frame__bar">
        <span className="rv-frame__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="rv-frame__label">ABTalks Hire · search results</span>
      </div>

      <div className="rv-frame__body">
        <article className="rv-card">
          <div className="rv-card__top">
            <div className="rv-card__avatar" aria-hidden="true">
              {initials}
            </div>

            <div className="rv-card__ident">
              <h3 className="rv-card__name">
                <span>{card.givenName}</span>
                {card.maskedLength !== null && (
                  <span
                    className="rv-card__masked"
                    aria-label="Your surname is not shown here"
                  >
                    {/* A run of blocks sized from a LENGTH the server sent. Not
                        your surname, and not a decoy of it either — nothing
                        name-shaped goes into this page's HTML. */}
                    {"█".repeat(Math.min(card.maskedLength, 8))}
                  </span>
                )}
                {card.openToWork && (
                  <span className="rv-badge rv-badge--open">Open to work</span>
                )}
                {card.trackLabel && (
                  <span className="rv-badge rv-badge--track">{card.trackLabel}</span>
                )}
              </h3>
              <p className="rv-card__role">{card.roleLabel}</p>
            </div>
          </div>

          {card.pills.length > 0 && (
            <div className="rv-card__metas">
              {card.pills.map((pill) => (
                <span className="rv-meta" key={`${pill.kind}:${pill.text}`}>
                  <MetaIcon kind={pill.kind} />
                  <span>{pill.text}</span>
                </span>
              ))}
              {card.hasLinkedin && (
                <span className="rv-meta">
                  <span aria-hidden="true">in</span>
                  <span>LinkedIn on file</span>
                </span>
              )}
              {card.hasGithub && (
                <span className="rv-meta">
                  <span>GitHub on file</span>
                </span>
              )}
            </div>
          )}

          {card.skills.length > 0 && (
            <div className="rv-chips">
              {card.skills.slice(0, 12).map((skill) => (
                <span
                  key={skill.name}
                  className={
                    skill.evidenceBacked ? "rv-chip rv-chip--verified" : "rv-chip"
                  }
                  title={
                    skill.evidenceBacked
                      ? "Verified by ABTalks — earned by finishing a track that teaches it"
                      : "Your own claim"
                  }
                >
                  {skill.evidenceBacked && <TickIcon className="rv-chip__tick" />}
                  {skill.name}
                </span>
              ))}
            </div>
          )}

          <p className="rv-card__evidence">{card.summary}</p>
        </article>
      </div>
    </div>
  );
}

/** What the card shows, and what it deliberately holds back. */
export function CardNote({
  masked,
  availabilityUnknown,
  noLocation,
}: {
  masked: boolean;
  availabilityUnknown: boolean;
  noLocation: boolean;
}) {
  const lines: string[] = [];

  if (masked) {
    lines.push(
      "Recruiters see your given name. Your surname, email, phone number and résumé are released separately — a recruiter has to pay to reach them, and they are never on this card.",
    );
  }
  if (noLocation) {
    lines.push(
      "Your card shows no location. The location on a card comes from the cities you say you want to work in, not the city on your profile — so filling in Opportunity preferences is what puts it there.",
    );
  }
  if (availabilityUnknown) {
    lines.push(
      "You have not filled in your work preferences, so recruiters see your availability as unconfirmed.",
    );
  }

  if (lines.length === 0) return null;

  return (
    <div className="rv-callout">
      <InfoIcon />
      <div>
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  );
}
