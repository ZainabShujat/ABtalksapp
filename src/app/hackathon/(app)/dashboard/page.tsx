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
  title: `Your dashboard · ${VIDEOTHON.name}`,
};

/**
 * VideoThon participant dashboard.
 *
 * Notable deviation from the code hackathon: this page does NOT call
 * `registrationRedirect`. VideoThon participants intentionally do not go
 * through the general candidate-profile funnel — the only "am I registered"
 * check is the `HackathonVideoRegistration` row. Any signed-in user without
 * a row is bounced to `/hackathon` where the landing auto-opens the form.
 */
export default async function VideothonDashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?from=/hackathon");
  }

  const registration = await getMyVideoRegistration(session.user.id);
  if (!registration) {
    // Not registered for VideoThon — bounce back to the landing. The landing
    // detects "authed + no row" and pops the form dialog immediately.
    redirect("/hackathon");
  }

  const window = getVideothonSubmissionWindow();
  const firstName = registration.fullName.split(" ")[0] ?? registration.fullName;
  const pill = window.closed
    ? { tone: "ended", label: "Wrapped" }
    : window.unlocked
      ? { tone: "live", label: "Live · Editing window open" }
      : { tone: "pre", label: "Registered · Kickoff pending" };

  return (
    <div className="vt">
      <div className="vt-dash">
        <header className="vt-dash__welcome">
          <h1 className="vt-dash__hi">Welcome, {firstName}.</h1>
          <span className="vt-dash__pill" data-tone={pill.tone}>
            {pill.label}
          </span>
        </header>

        {/* Countdown as a compact strip. Same component as the landing hero
            so the phase logic is consistent — it just sits in a panel here. */}
        <section className="vt-panel">
          <p className="vt-panel__eyebrow">Timer</p>
          <VideothonCountdown
            kickoffUtc={VIDEOTHON.kickoffUtc}
            deadlineUtc={VIDEOTHON.deadlineUtc}
          />
          <p className="vt-panel__meta" style={{ marginTop: 16 }}>
            {window.closed
              ? `Deadline was ${VIDEOTHON.deadlineLabel}. ${VIDEOTHON.resultsLabel}.`
              : window.unlocked
                ? `Deadline: ${VIDEOTHON.deadlineLabel}`
                : `Kickoff: ${VIDEOTHON.kickoffLabel}`}
          </p>
        </section>

        {/* Brief card. Reads from config today; a future ticket can pull this
            from a HackathonProblem-style DB row once briefs are seeded. */}
        <section className="vt-panel">
          <p className="vt-panel__eyebrow">The brief</p>
          {window.unlocked ? (
            <p className="vt-panel__brief">{VIDEOTHON.brief}</p>
          ) : (
            <p className="vt-panel__brief vt-panel__brief--locked">
              The brief drops at kickoff. Watch the WhatsApp group.
            </p>
          )}
          {VIDEOTHON.whatsappLink ? (
            <p className="vt-panel__meta" style={{ marginTop: 16 }}>
              <Link
                href={VIDEOTHON.whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="vt-row__link"
              >
                Open WhatsApp group →
              </Link>
            </p>
          ) : null}
        </section>

        {/* Submission — the whole reason for the dashboard. */}
        <VideoSubmissionForm
          initial={registration.submission}
          editable={window.editable}
          closed={window.closed}
        />

        {/* Read-only echo of the identity + registration answers, so participants
            can double-check what they submitted (portfolio link especially). */}
        <section className="vt-panel">
          <p className="vt-panel__eyebrow">Your registration</p>
          <div className="vt-panel__stack">
            <div className="vt-row">
              <span className="vt-row__label">Name</span>
              <span className="vt-row__value">{registration.fullName}</span>
            </div>
            <div className="vt-row">
              <span className="vt-row__label">Email</span>
              <span className="vt-row__value">{registration.email}</span>
            </div>
            <div className="vt-row">
              <span className="vt-row__label">Phone</span>
              <span className="vt-row__value">{registration.phoneDisplay}</span>
            </div>
            <div className="vt-row">
              <span className="vt-row__label">City</span>
              <span className="vt-row__value">{registration.city}</span>
            </div>
            <div className="vt-row">
              <span className="vt-row__label">Status</span>
              <span className="vt-row__value">
                {registration.employment === "WORKING" ? "Working" : "Learner"}
                {registration.currentCtc
                  ? ` · CTC ${registration.currentCtc}`
                  : ""}
              </span>
            </div>
            <div className="vt-row">
              <span className="vt-row__label">Portfolio</span>
              <a
                className="vt-row__value vt-row__link"
                href={registration.portfolioUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {registration.portfolioUrl}
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
