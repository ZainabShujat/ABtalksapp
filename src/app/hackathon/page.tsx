import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import {
  VIDEOTHON,
  isVideothonRegistrationOpen,
} from "@/features/hackathon-video/config";
import { getMyVideoRegistration } from "@/features/hackathon-video/get-my-registration";
import { HackathonShell } from "@/components/hackathon-v2/hackathon-shell";
import { FaqAccordion } from "@/components/hackathon-v2/faq-accordion";
import { VideothonCountdown } from "@/components/hackathon-video/countdown";
import { VideothonRegisterCTA } from "@/components/hackathon-video/register-cta";
import "@/app/hackathon/_styles/hackathon-v2.css";
import "@/components/hackathon-video/landing.css";

export const metadata: Metadata = {
  title: `${VIDEOTHON.name} · ABTalks`,
  description:
    "A 48-hour hackathon for video editors. Solo. One brief. Ship one cut.",
};

const HIW_STEPS = [
  {
    title: "Register",
    body: "Sign in with Google, fill a short form. Solo entry — no team code, no group chase.",
  },
  {
    title: "Join the WhatsApp group",
    body: "Every participant joins the group. Kickoff, the brief, judge Q&A and last-minute updates land there first.",
  },
  {
    title: "Cut for 48 hours",
    body: "From Friday kickoff to Sunday deadline. Any software, any sources you have rights to. Ship one cut.",
  },
  {
    title: "Submit before the deadline",
    body: "One public link — Drive, Behance, YouTube, Vimeo, anything a judge can open. Late is not counted.",
  },
];

const TIMELINE = [
  {
    title: "Kickoff",
    body: "The brief lands in the WhatsApp group. The clock starts. Open your project.",
  },
  {
    title: "Halfway",
    body: "Optional pulse check. Share rough cuts, get notes, keep cutting.",
  },
  {
    title: "Deadline",
    body: "Submit the public link before the timer hits zero. Anything late is not counted.",
  },
  {
    title: "Results",
    body: "Winners announced with a public reel. Every entry gets a written judge note.",
  },
];

const FAQ_ITEMS = [
  {
    q: "Who's it for?",
    a: "Anyone who edits video — students, self-taught cutters, in-house editors, freelancers. All skill levels, worldwide.",
  },
  {
    q: "Do I need to be in India?",
    a: "No. It's a 48-hour online hackathon. Register with any phone number from the country-code list; submit from anywhere.",
  },
  {
    q: "What software can I use?",
    a: "Anything. Premiere, DaVinci, Final Cut, CapCut, After Effects — whatever ships your best cut. Your call.",
  },
  {
    q: "What's the brief?",
    a: "It lands in the WhatsApp group at kickoff. One prompt everyone edits to — the constraint is what makes it interesting.",
  },
  {
    q: "Do I get feedback if I don't win?",
    a: "Yes. Every entry gets a short note from the judges. That's the point.",
  },
  {
    q: "Is it free?",
    a: "Yes. Registration and entry are completely free.",
  },
];

const RULES = [
  {
    n: "01.",
    title: "Solo entries only",
    body: "Individual competition. No credited collaborators — one editor, one cut.",
    variant: "rule--1",
  },
  {
    n: "02.",
    title: "Sources allowed, credited",
    body: "Stock is fine. Client work is not. If a shot isn't yours, name where it came from in your notes.",
    variant: "rule--2",
  },
  {
    n: "03.",
    title: "Everything inside 48 hours",
    body: "The cut, the grade, the sound, the export — all after kickoff. Pre-built templates disclosed in submission notes.",
    variant: "rule--3",
  },
  {
    n: "04.",
    title: "One link, before the timer",
    body: "Drive, Behance, YouTube, Vimeo — any public link a judge can open. Late is not counted.",
    variant: "rule--4",
  },
];

export default async function HackathonPage() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isAuthed = Boolean(userId);
  const registration = userId ? await getMyVideoRegistration(userId) : null;
  const registered = registration !== null;
  const registrationOpen = isVideothonRegistrationOpen();
  const prefill =
    session?.user?.name && session.user.email
      ? { fullName: session.user.name, email: session.user.email }
      : null;

  const headerCta = (
    <VideothonRegisterCTA
      isAuthed={isAuthed}
      registered={registered}
      registrationOpen={registrationOpen}
      prefill={prefill}
      variant="pill"
    />
  );

  return (
    <HackathonShell
      headerCta={headerCta}
      isAuthed={isAuthed}
      user={{
        name: session?.user?.name ?? "",
        email: session?.user?.email ?? "",
        image: session?.user?.image ?? null,
      }}
    >
      <a className="ab-skip ab-sr" href="#vt-hero-title">
        Skip to main content
      </a>

      <div className="vt-mono">

      {/* 1 · HERO — reuses .hk-hero as the wrapper (background grid, ambient
          fill from hackathon-v2.css) but overrides its layout via `.vt-hero`
          so the head sits centered without expecting a right-side stage. */}
      <section className="hk-hero vt-hero" aria-labelledby="vt-hero-title">
        <div className="vt-hero__bg" aria-hidden>
          <span className="vt-hero__scan" />
          <span className="vt-hero__noise" />
          <span className="vt-hero__dust" />
          <span className="vt-hero__signal" />
        </div>
        <div className="vt-hero__reel vt-hero__reel--left" aria-hidden />
        <div className="vt-hero__reel vt-hero__reel--right" aria-hidden />
        <div className="vt-hero__inner">
          <p className="vt-hero__eyebrow" aria-hidden>
            <span className="vt-hero__dot" />
            REC · 48 HOURS · ONE BRIEF
          </p>

          <h1
            className="vt-hero__title"
            id="vt-hero-title"
            data-glitch={VIDEOTHON.name}
          >
            <em data-glitch={VIDEOTHON.name}>{VIDEOTHON.name}</em>
            <span className="vt-hero__title-sub">for video editors</span>
          </h1>

          <p className="vt-hero__lede">{VIDEOTHON.tagline}</p>

          <div className="vt-hero__timer">
            <VideothonCountdown
              kickoffUtc={VIDEOTHON.kickoffUtc}
              deadlineUtc={VIDEOTHON.deadlineUtc}
            />
          </div>

          <div className="vt-hero__ctas">
            <VideothonRegisterCTA
              isAuthed={isAuthed}
              registered={registered}
              registrationOpen={registrationOpen}
              prefill={prefill}
              variant="cta"
            />
            <Link className="ab-btn ab-btn--ghost vt-hero__learn" href="#hk-how">
              Learn more
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <path d="M4 12h15M13 6l6 6-6 6" />
              </svg>
            </Link>
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
              <dd>{VIDEOTHON.resultsLabel.replace(/^Winners announced: /, "")}</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* 2 · HOW IT WORKS */}
      <section className="hk-how" id="hk-how" aria-labelledby="hk-how-title">
        <h2 className="hk-h2" id="hk-how-title">
          How it works
        </h2>
        <ol className="hk-how__grid">
          {HIW_STEPS.map((step, i) => (
            <li key={step.title} className="hiw">
              <span className="hiw__tab" aria-hidden>
                {i + 1}
              </span>
              <div className="hiw__body">
                <h3 className="hiw__title">{step.title}</h3>
                <p className="hiw__text">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 3 · WhatsApp callout — the brief lands there first */}
      {VIDEOTHON.whatsappLink ? (
        <section
          className="hk-discord"
          id="hk-whatsapp"
          aria-labelledby="hk-whatsapp-title"
        >
          <div className="hk-discord__card">
            <div className="hk-discord__body">
              <span className="hk-discord__eyebrow">Community · Required</span>
              <h2 className="hk-discord__title" id="hk-whatsapp-title">
                Every participant joins the WhatsApp group
              </h2>
              <p className="hk-discord__text">
                Kickoff announcements, the brief, judge Q&amp;A and last-minute
                updates all happen there first. If you&rsquo;re not in the group,
                you will miss it.
              </p>
            </div>
            <div className="hk-discord__cta">
              <Link
                href={VIDEOTHON.whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="ab-btn ab-btn--primary hk-discord__btn"
              >
                Join the WhatsApp group →
              </Link>
              <p className="hk-discord__note">Opens WhatsApp in a new tab.</p>
            </div>
          </div>
        </section>
      ) : null}

      {/* 4 · TIMELINE */}
      <section
        className="hk-timeline"
        data-timeline
        aria-labelledby="hk-timeline-title"
      >
        <div className="tl">
          <h2 className="hk-h2 tl__title" id="hk-timeline-title">
            Timeline
          </h2>
          <ol className="tl__cards">
            {TIMELINE.map((t, i) => (
              <li
                key={t.title}
                className="tl-card"
                style={{ ["--i" as string]: String(i) } as React.CSSProperties}
              >
                <h3 className="tl-card__title">{t.title}</h3>
                <p className="tl-card__text">{t.body}</p>
              </li>
            ))}
          </ol>
          <div className="tl__rail" aria-hidden>
            <span className="tl__line" />
            {["14.77%", "38.26%", "61.74%", "85.23%"].map((x, i) => (
              <span
                key={x}
                className="tl-tab"
                style={
                  {
                    ["--x" as string]: x,
                    ["--i" as string]: String(i),
                  } as React.CSSProperties
                }
              >
                {i + 1}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* 5 · FAQ */}
      <section className="hk-faq" aria-labelledby="hk-faq-title">
        <div className="hk-faq__intro">
          <h2 className="hk-h2 hk-faq__title" id="hk-faq-title">
            Frequently asked
            <br />
            <em>questions</em>
          </h2>
          <p className="hk-faq__sub">Common questions before you register.</p>
        </div>
        <FaqAccordion items={FAQ_ITEMS} />
      </section>

      {/* 6 · RULES */}
      <section className="hk-rules" aria-labelledby="hk-rules-title">
        <h2 className="ab-sr" id="hk-rules-title">
          Rules
        </h2>
        <div className="rules">
          <span className="rules__word" aria-hidden>
            RULES
          </span>
          {RULES.map((r) => (
            <article key={r.n} className={`rule ${r.variant}`} tabIndex={0}>
              <div className="rule__note">
                <h3 className="rule__title">
                  <b>{r.n}</b> {r.title}
                </h3>
                <p className="rule__text">{r.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      </div>
    </HackathonShell>
  );
}
