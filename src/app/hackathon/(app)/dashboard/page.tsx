import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  VIDEOTHON,
  getVideothonSubmissionWindow,
} from "@/features/hackathon-video/config";
import { getMyVideoRegistration } from "@/features/hackathon-video/get-my-registration";
import { VideothonCountdown } from "@/components/hackathon-video/countdown";
import { VideoSubmissionForm } from "@/components/hackathon-video/submission-form";
import "@/components/hackathon-video/landing.css";

export const metadata: Metadata = {
  title: `Your desk · ${VIDEOTHON.name}`,
};

/**
 * VideoThon participant dashboard, rendered inside the shared hackathon shell
 * (sidebar + header, see `(app)/layout.tsx`).
 *
 * The whole page is black. Top to bottom:
 *   - Reel hero — the exact `/hackathon` hero markup (CRT layers + film
 *     reels), full bleed across the content column, "VideoThon" title with
 *     the participant's welcome underneath, status and the countdown
 *   - Flat sections on the page (hairline dividers, no cards): problem
 *     statement (locked until kickoff), submission form, four guidelines,
 *     schedule
 *   - Registration on file — a black matte event pass on a white band
 *
 * Monochrome on purpose: the desk overrides the landing's yellow / pink / blue
 * accents in `landing.css`; only the red REC dot stays, as on the landing.
 *
 * Does NOT call `registrationRedirect` — VideoThon participants skip the
 * candidate-profile funnel. The only "am I registered" check is the
 * `HackathonVideoRegistration` row; anyone signed in without one goes back
 * to `/hackathon`, where the Register button opens the form.
 */
export default async function VideothonDashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?from=/hackathon");
  }

  const registration = await getMyVideoRegistration(session.user.id);
  if (!registration) {
    redirect("/hackathon");
  }

  const window = getVideothonSubmissionWindow();
  const firstName = registration.fullName.split(" ")[0] ?? registration.fullName;
  const phase = window.closed ? "ended" : window.unlocked ? "live" : "pre";
  
  const lede =
    phase === "ended"
      ? `Submissions are closed. ${VIDEOTHON.resultsLabel}.`
      : phase === "live"
        ? "The clock is running. Cut, export, and save your link before the deadline."
        : "You're in. The problem statement unlocks here.";
  const resultsDate = VIDEOTHON.resultsLabel.replace(/^Winners announced: /, "");

  return (
    <div className="vt-mono vt-desk">
      {/* ============ HERO — same reel treatment as /hackathon ============ */}
      <section className="hk-hero vt-hero" aria-labelledby="vt-desk-title">
        <div className="vt-hero__bg" aria-hidden>
          <span className="vt-hero__scan" />
          <span className="vt-hero__noise" />
          <span className="vt-hero__dust" />
          <span className="vt-hero__signal" />
        </div>
        <div className="vt-hero__reel vt-hero__reel--left" aria-hidden />
        <div className="vt-hero__reel vt-hero__reel--right" aria-hidden />
        <div className="vt-hero__inner">
          

          <h1 className="vt-hero__title" id="vt-desk-title">
            <em data-glitch={VIDEOTHON.name}>{VIDEOTHON.name}</em>
            <span className="vt-hero__title-sub">Welcome to the Dashboard, {firstName}</span>
          </h1>

          <p className="vt-hero__lede">{lede}</p>

          <div className="vt-hero__timer">
            <VideothonCountdown
              kickoffUtc={VIDEOTHON.kickoffUtc}
              deadlineUtc={VIDEOTHON.deadlineUtc}
            />
          </div>

          <dl className="vt-hero__meta" aria-label="Event window">
            <div>
              <dt>Kickoff</dt>
              <dd>{VIDEOTHON.kickoffLabel}</dd>
            </div>
            <div>
              <dt>Deadline</dt>
              <dd>{VIDEOTHON.deadlineLabel}</dd>
            </div>
            <div>
              <dt>Results</dt>
              <dd>{resultsDate}</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ============ PROBLEM STATEMENT — full width ============ */}
      <section
        className={`vt-card vt-card--dark vt-brief${window.unlocked ? " is-open" : " is-locked"}`}
        aria-labelledby="vt-brief-title"
      >
        <header className="vt-card__head">
          <p className="vt-card__eyebrow">Scene 01 · Problem statement</p>
          {/* <span className="vt-card__tag" data-tone={window.unlocked ? "live" : "locked"}>
            {window.unlocked ? "Unlocked" : "Locked"}
          </span> */}
        </header>

        {window.unlocked ? (
          <>
            <div className="vt-brief__lock">
              <span className="vt-brief__lock-icon" aria-hidden>
                <svg viewBox="0 0 24 24" focusable="false">
                  <rect x="4" y="10.5" width="16" height="10.5" rx="2.4" />
                  <path d="M8 10.5V7.6a4 4 0 0 1 7.7-1.5" />
                </svg>
              </span>
              <div>
                <h2 className="vt-card__title" id="vt-brief-title">
                  The problem statement is unlocked
                </h2>
                <p className="vt-card__body">
                  Dropped at {VIDEOTHON.kickoffLabel}.
                </p>
              </div>
            </div>
            <p className="vt-brief__text">{VIDEOTHON.brief}</p>
          </>
        ) : (
          <>
            <div className="vt-brief__lock">
              <span className="vt-brief__lock-icon" aria-hidden>
                <svg viewBox="0 0 24 24" focusable="false">
                  <rect x="4" y="10.5" width="16" height="10.5" rx="2.4" />
                  <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" />
                </svg>
              </span>
              <div>
                <h2 className="vt-card__title" id="vt-brief-title">
                  The problem statement is locked
                </h2>
                <p className="vt-card__body">
                  Unlocks at kickoff, {VIDEOTHON.kickoffLabel}. 
                </p>
              </div>
            </div>
          </>
        )}

        {/* {VIDEOTHON.whatsappLink ? (
          <Link
            href={VIDEOTHON.whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            className="vt-card__link"
          >
            Open the WhatsApp group
            <svg viewBox="0 0 24 24" aria-hidden focusable="false">
              <path d="M4 12h15M13 6l6 6-6 6" />
            </svg>
          </Link>
        ) : null} */}
      </section>

      {/* ============ SUBMISSION ============ */}
      <VideoSubmissionForm
        initial={registration.submission}
        editable={window.editable}
        closed={window.closed}
      />

      {/* ============ GUIDELINES — four, 2×2 ============ */}
      <section className="vt-card vt-card--dark" aria-labelledby="vt-guidelines-title">
        <header className="vt-card__head">
          <p className="vt-card__eyebrow" id="vt-guidelines-title">
            Scene 03 · Guidelines
          </p>
          
        </header>
        <ol className="vt-guidelines">
          <li>
            <strong>One public link anyone can open.</strong> Drive, Behance,
            YouTube or Vimeo, set to &quot;Anyone with the link can
            view&quot;. Judges won&apos;t request access.
          </li>
          <li>
            <strong>Solo, and only work you have rights to.</strong> No
            collaborators, no client or copyrighted footage. Licensed stock is
            fine; credit it in the notes.
          </li>
          <li>
            <strong>Everything inside the 24 hours.</strong> Cut, grade, sound
            and export happen after kickoff. Disclose any pre-built templates.
          </li>
          <li>
            <strong>Re-save until the deadline.</strong> The last save is what
            judges see; late saves don&apos;t count. Notes are optional.
          </li>
        </ol>
      </section>

      {/* ============ SCHEDULE ============ */}
      <section className="vt-card vt-card--dark vt-schedule-strip" aria-labelledby="vt-schedule-title">
        <header className="vt-card__head">
          <p className="vt-card__eyebrow" id="vt-schedule-title">
            Scene 04 · Schedule
          </p>
          
        </header>
        <ol className="vt-schedule vt-schedule--horizontal">
          <li className={phase !== "pre" ? "is-past" : "is-next"}>
            <span className="vt-schedule__pip" aria-hidden />
            <div>
              <p className="vt-schedule__label">Kickoff</p>
              <p className="vt-schedule__value">{VIDEOTHON.kickoffLabel}</p>
            </div>
          </li>
          <li className={phase === "ended" ? "is-past" : ""}>
            <span className="vt-schedule__pip" aria-hidden />
            <div>
              <p className="vt-schedule__label">Halfway check-in</p>
              {/* <p className="vt-schedule__value">Optional pulse in WhatsApp</p> */}
            </div>
          </li>
          <li className={phase === "ended" ? "is-past" : phase === "live" ? "is-next" : ""}>
            <span className="vt-schedule__pip" aria-hidden />
            <div>
              <p className="vt-schedule__label">Deadline</p>
              <p className="vt-schedule__value">{VIDEOTHON.deadlineLabel}</p>
            </div>
          </li>
          <li className={phase === "ended" ? "is-next" : ""}>
            <span className="vt-schedule__pip" aria-hidden />
            <div>
              <p className="vt-schedule__label">Results</p>
              <p className="vt-schedule__value">{resultsDate}</p>
            </div>
          </li>
        </ol>
      </section>

      {/* ============ REGISTRATION — black event pass on a white band ============ */}
      <div className="vt-pass">
        <div className="vt-pass__inner">
          <section className="vt-ticket" aria-labelledby="vt-reg-title">
            <div className="vt-ticket__main">
              <header className="vt-card__head">
                <p className="vt-card__eyebrow" id="vt-reg-title">
                  Your registration on file
                </p>
                <span className="vt-card__tag" data-tone="info">
                  Read-only
                </span>
              </header>
              <p className="vt-ticket__title">
                {VIDEOTHON.name}
                <span className="vt-ticket__title-sub">Participant pass</span>
              </p>
              <dl className="vt-ticket__grid">
                <div>
                  <dt>Name</dt>
                  <dd>{registration.fullName}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{registration.email}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{registration.phoneDisplay}</dd>
                </div>
                <div>
                  <dt>City</dt>
                  <dd>{registration.city}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    {registration.employment === "WORKING" ? "Working" : "Learner"}
                    {registration.employment === "WORKING" && registration.currentCtc
                      ? ` · CTC ${registration.currentCtc}`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt>Portfolio</dt>
                  <dd>
                    <a
                      href={registration.portfolioUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="vt-ticket__link"
                    >
                      {registration.portfolioUrl}
                    </a>
                  </dd>
                </div>
              </dl>
            </div>

            {/* Tear-off stub — decorative. */}
            <div className="vt-ticket__stub" aria-hidden>
              <div>
                <p className="vt-ticket__stub-label">Admit</p>
                <p className="vt-ticket__stub-big">One</p>
                <p className="vt-ticket__stub-label">Solo entry · 24 hrs</p>
              </div>
              <span className="vt-ticket__barcode" />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
