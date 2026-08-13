import Image from "next/image";
import Link from "next/link";
import type { LandingState } from "@/features/landing/get-landing-state";
import { HubNav } from "./hub/hub-nav";
import { HeroHeadline } from "./hub/hero-headline";
import { HubStatsStrip } from "./hub/hub-stats-strip";
import { HowItWorks } from "./hub/how-it-works";
import { ConsentTiltCard } from "./hub/consent-tilt-card";
import { CommunityCollage } from "./hub/community-collage";
import { HubTestimonials } from "./hub/hub-testimonials";
import { GhostCursor } from "./hub/ghost-cursor";
import "./hub/landing-hub.css";
import { cn } from "@/lib/utils";
import { LandingUserMenu } from "./landing-user-menu";
import { TrackCard } from "./track-card";
import { TestimonialsCarousel } from "./testimonials-carousel";
import { WaitlistTrackCard } from "./waitlist-track-card";

const WHATSAPP_LINK = "https://chat.whatsapp.com/LSru1BgvifpEB4OMZsaZEi";

const CANDIDATE_ITEMS = [
  "Hackathons — weekend builds, judged and archived",
  "Cohorts — multi-week programs with mentors",
  "Challenges — scoped problems from real companies",
];

const COMPANY_ITEMS = [
  "Browse candidates by what they shipped",
  "Send us the role and the skills you need",
  "We build a cohort against that requirement",
];

type ProgramKey = "challenge" | "hackathon" | "program" | "claude";

const PROGRAMS: {
  key: ProgramKey;
  title: string;
  href: string;
  color: string;
  glow: string;
  lines: string[];
}[] = [
  {
    key: "challenge",
    title: "60 day coding challenge",
    href: "/challenges",
    color: "#7548e7",
    glow: "rgba(117, 72, 231, 0.55)",
    lines: [
      "Daily tasks across AI, data, and software",
      "Prove the work on GitHub and LinkedIn",
      "Streaks that recruiters can actually see",
    ],
  },
  {
    key: "hackathon",
    title: "abtalks Vicodathon",
    href: "/hackathon",
    color: "#009cf5",
    glow: "rgba(0, 156, 245, 0.55)",
    lines: [
      "A weekend build from brief to shipped demo",
      "Solo or with a team, judged and archived",
      "Output that goes on your profile, not slides",
    ],
  },
  {
    key: "program",
    title: "31 days ai cohort",
    href: "/program",
    color: "#97ea42",
    glow: "rgba(151, 234, 66, 0.55)",
    lines: [
      "Built for working professionals shipping AI",
      "Daily missions, projects, and an exit interview",
      "Visible to hiring partners after you consent",
    ],
  },
  {
    key: "claude",
    title: "claude challenge",
    href: "/claude-signup",
    color: "#ff7a00",
    glow: "rgba(255, 122, 0, 0.55)",
    lines: [
      "A focused track for Claude AI mastery",
      "Synchronized days with the cohort calendar",
      "Build real workflows and share the proof",
    ],
  },
];

const FAQS = [
const CLAUDE_TRACK = {
  key: "claude" as const,
  accent: "amber" as const,
  title: "Claude Challenge",
  blurb:
    "Master Claude through focused prompt-engineering tasks and build practical AI workflows.",
  pill: "New",
  chips: ["60 days", "AI mastery"],
  href: "/claude-signup",
  ctaLabel: "Join the Claude track",
};

const WAITLIST_TRACKS = [
  {
    accent: "orange" as const,
    title: "Databricks",
    blurb: "Lakehouse, Spark, Unity Catalog, and production data pipelines.",
    pill: "New",
    chips: ["Cohort"],
    ctaLabel: "Enroll now",
  },
  {
    accent: "indigo" as const,
    title: "Google Cloud (GCP)",
    blurb: "BigQuery, Cloud Run, and cloud data engineering.",
    pill: "New",
    chips: ["Cohort"],
    ctaLabel: "Enroll now",
  },
  {
    accent: "violet" as const,
    title: "Snowflake",
    blurb: "Cloud data warehouse skills — SQL, pipelines, and analytics.",
    pill: "New",
    chips: ["Cohort"],
    ctaLabel: "Enroll now",
  },
  {
    accent: "amber" as const,
    title: "Cyber Security",
    blurb: "Practical security fundamentals — threats, hardening, and defense.",
    pill: "New",
    chips: ["Cohort"],
    ctaLabel: "Enroll now",
  },
];

const STATS = [
  { value: "10,000+", label: "members" },
  { value: "500+", label: "projects" },
  { value: "100+", label: "hiring partners" },
];

const STEPS = [
  {
    q: "Does it cost anything to join a cohort?",
    a: "Taking part is free for candidates. Companies pay us when they hire, so nobody is ever charged for the chance to be seen.",
  },
  {
    q: "What exactly do companies see before I consent?",
    a: "The work and the scores, with your name, contact details and employer hidden. They can ask for access; you decide whether to grant it, company by company.",
  },
  {
    q: "Do I need to be a student or a developer?",
    a: "No. Cohorts run across engineering, design, data and product. Some people are in their first year of college, some are ten years into a career and want a different door.",
  },
  {
    q: "We have a niche requirement. Can you build a cohort for it?",
    a: "Yes — that is the normal way we work with companies. Send us the role, the stack and the timeline, and we design the challenge and recruit the cohort around it.",
  },
];

const COMMUNITY_BULLETS = [
  "Daily motivation and peer support",
  "Feedback that helps you improve",
  "Opportunities, events and workshops",
  "A network that grows with you",
];

function ctaForProgram(key: ProgramKey, state: LandingState) {
  switch (key) {
    case "challenge":
      return state.challengeCta;
    case "claude":
      return state.claudeCta;
    case "program":
      return state.programCta;
    case "hackathon":
      return state.hackathonCta;
  }
}

export function LandingHub({
  claudeEnabled,
  state,
}: {
  claudeEnabled: boolean;
  state: LandingState;
}) {
  const programs = PROGRAMS.filter(
    (program) => program.key !== "claude" || claudeEnabled,
  ).map((program) => {
    const cta = ctaForProgram(program.key, state);
    return {
      ...program,
      href: cta?.href ?? program.href,
      badge: cta?.ctaLabel ?? "enrolling now",
    };
  });

  return (
    <div className="landing-hub">
      <HubNav user={state.user} />

      {/* —— hero + stats (above-fold; scales only under 1080px height) —— */}
      <div className="hub-above-fold">
        <section className="hub-hero-band">
          <div className="hub-shell hub-hero">
            <div className="hub-hero-copy">
              <HeroHeadline />
              <p
                style={{
                  margin: "28px 0 0",
                  maxWidth: 775,
                  fontSize: 20,
                  lineHeight: 1.6,
                  color: "var(--hub-muted)",
                }}
              >
                ABTalks runs hackathons, cohorts and challenges where people
                build in public. Companies see the work, not a rehearsed answer.
                We sit in the middle: matching real output to real requirements,
                and never sharing a profile without the candidate saying yes
                first.
              </p>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 16,
                  marginTop: 40,
                }}
              >
                <Link
                  href="/program"
                  className="hub-btn hub-btn-primary hub-btn-hero"
                >
                  Get Started
                </Link>
                <Link
                  href="/talent"
                  className="hub-btn hub-btn-ghost hub-btn-hero"
                >
                  Post a requirement
                </Link>
              </div>
            </div>
            <div className="hub-hero-spacer" aria-hidden />
          </div>
        </section>

        <HubStatsStrip />
      </div>

      {/* —— bridge —— */}
      <section id="about" style={{ padding: "56px 0" }}>
        <div
          className="hub-shell"
          style={{
            borderRadius: 25,
            background:
              "radial-gradient(ellipse at center, rgba(189,157,255,0.12), transparent 70%), #fafafc",
            padding: "clamp(28px, 4vw, 48px)",
          }}
        >
          <p className="hub-kicker">The bridge</p>
          <h2 className="hub-h2">
            Talent on one side. Requirements on the other.
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr)",
              gap: 16,
              alignItems: "stretch",
              marginTop: 36,
            }}
            className="hub-bridge-grid"
          >
            <BridgeSideCard
              tag="Candidates"
              title="Make yourself visible by building."
              items={CANDIDATE_ITEMS}
            />
            <BridgeArrow />
            <div
              style={{
                borderRadius: 15,
                padding: "28px 24px",
                background:
                  "linear-gradient(152deg, #7c5cff 2%, #755cdd 100%)",
                color: "#fff",
                minHeight: 260,
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#ebe3ff",
                  letterSpacing: "0.04em",
                }}
              >
                THE BRIDGE
              </p>
              <p
                style={{
                  margin: "12px 0 0",
                  fontSize: 32,
                  fontWeight: 800,
                }}
              >
                ABTalks
              </p>
              <p
                style={{
                  margin: "18px 0 0",
                  fontSize: 16,
                  lineHeight: 1.6,
                  color: "#ebe3ff",
                }}
              >
                We run the programs, score the work, and match evidence to
                requirements. Profiles move only when the candidate releases
                them.
              </p>
            </div>
            <BridgeArrow />
            <BridgeSideCard
              tag="Companies"
              title="Hire from proof, or commission it."
              items={COMPANY_ITEMS}
            />
          </div>
        </div>
      </section>

      <HowItWorks />

      {/* —— consent —— */}
      <section
        id="privacy"
        className="hub-shell hub-consent-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr)",
          gap: "clamp(32px, 5vw, 72px)",
          alignItems: "center",
          padding: "48px 0 72px",
        }}
      >
        <div>
          <p className="hub-kicker">Consent first</p>
          <h2
            className="hub-h2"
            style={{ fontSize: "clamp(28px, 3.6vw, 48px)", fontWeight: 500 }}
          >
            We do not share a candidate&apos;s profile{" "}
            <em
              style={{
                fontStyle: "italic",
                fontWeight: 700,
                color: "var(--hub-accent-700)",
              }}
            >
              until they allow
            </em>{" "}
            us to.
          </h2>
        </div>
        <ConsentTiltCard />
      </section>
        <section
          aria-label="Choose an ABTalks track"
          className="mx-auto grid max-w-7xl gap-5 px-5 md:grid-cols-3 md:px-8 lg:grid-cols-4"
        >
          {TRACKS.map(({ key, ...track }) => (
            <TrackCard key={track.title} {...track} {...(ctaByKey[key] ?? {})} />
          ))}
          {claudeEnabled ? (
            <TrackCard {...claudeTrackProps} {...(ctaByKey.claude ?? {})} />
          ) : null}
          {WAITLIST_TRACKS.map((track) => (
            <WaitlistTrackCard
              key={track.title}
              {...track}
              isAuthenticated={Boolean(state.user)}
            />
          ))}
        </section>

      {/* —— programs —— */}
      <section id="programs" style={{ padding: "56px 0 72px" }}>
        <div className="hub-shell">
          <p className="hub-kicker">Open right now</p>
          <h2 className="hub-h2">
            Something is always running. Come build in it.
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 20,
              marginTop: 40,
            }}
            className="hub-programs-grid"
          >
            {programs.map((program) => (
              <Link
                key={program.key}
                href={program.href}
                className="hub-program-card"
              >
                <GhostCursor
                  color={program.color}
                  brightness={1.25}
                  edgeIntensity={0}
                  trailLength={50}
                  inertia={0.5}
                  grainIntensity={0}
                  bloomStrength={0.04}
                  bloomRadius={0.6}
                  bloomThreshold={0.25}
                  fadeDelayMs={400}
                  fadeDurationMs={700}
                  zIndex={0}
                  mixBlendMode="screen"
                />
                <div className="hub-program-card-body">
                  <span
                    style={{
                      alignSelf: "flex-start",
                      border: "1px solid var(--hub-accent)",
                      borderRadius: 8,
                      padding: "6px 12px",
                      fontSize: 12,
                      textTransform: "capitalize",
                    }}
                  >
                    {program.badge}
                  </span>
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      top: 18,
                      right: 22,
                      fontSize: 28,
                      color: "#626262",
                      transform: "rotate(135deg)",
                    }}
                  >
                    ←
                  </span>
                  <p
                    className="hub-program-title"
                    style={{ color: program.color }}
                  >
                    {program.title}
                  </p>
                  <p
                    style={{
                      margin: "auto 0 0",
                      paddingTop: 24,
                      fontSize: 15,
                      lineHeight: 1.5,
                      color: "#333",
                    }}
                  >
                    {program.lines.map((line, i) => (
                      <span key={line}>
                        {i > 0 ? <br /> : null}
                        {line}
                      </span>
                    ))}
                  </p>
                  <span
                    className="hub-program-glow"
                    style={{ background: program.glow }}
                    aria-hidden
                  />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* —— testimonials —— */}
      <section style={{ padding: "48px 0 72px" }}>
        <div className="hub-shell">
          <p className="hub-kicker">From both sides of the bridge</p>
          <div style={{ marginTop: 24 }}>
            <HubTestimonials />
          </div>
        </div>
      </section>

      {/* —— FAQ —— */}
      <section id="faq" style={{ padding: "48px 0 72px" }}>
        <div className="hub-shell hub-faq">
          <p className="hub-kicker">Questions people ask us</p>
          <div style={{ marginTop: 16 }}>
            {FAQS.map((faq) => (
              <details key={faq.q}>
                <summary>{faq.q}</summary>
                <p>{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* —— community —— */}
      <section style={{ padding: "48px 0 80px" }}>
        <div
          className="hub-shell hub-community-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 0.85fr) minmax(0, 1.15fr)",
            gap: "clamp(28px, 4vw, 56px)",
            alignItems: "center",
          }}
        >
          <div>
            <h2
              className="hub-h2"
              style={{
                fontSize: "clamp(28px, 3vw, 36px)",
                textTransform: "uppercase",
              }}
            >
              Join a Community That Builds
            </h2>
            <ul
              style={{
                listStyle: "none",
                margin: "28px 0 0",
                padding: 0,
                display: "grid",
                gap: 14,
              }}
            >
              {COMMUNITY_BULLETS.map((item) => (
                <li
                  key={item}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    color: "#a3a3a3",
                    fontSize: 16,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 999,
                      background: "var(--hub-accent)",
                      color: "#fff",
                      fontSize: 12,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: "none",
                      marginTop: 2,
                    }}
                  >
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <a
              href={WHATSAPP_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="hub-whatsapp"
              style={{ marginTop: 32 }}
            >
              Join WhatsApp Community →
            </a>
          </div>
          <CommunityCollage />
        </div>
      </section>

      {/* —— poster CTA —— */}
      {/* —— poster CTA (453px) —— */}
      <section className="hub-poster">
        <Image
          src="/landing/poster-field.png"
          alt=""
          width={1024}
          height={719}
          className="hub-poster-art"
          aria-hidden
          priority={false}
        />
        <div className="hub-shell hub-poster-content">
          <div className="hub-poster-copy">
            <p className="hub-poster-headline">
              <span className="hub-poster-light">
                Stop guessing in interviews.
              </span>
              <span className="hub-poster-bold">
                Hire what you have already seen.
              </span>
            </p>
            <div className="hub-poster-actions">
              <Link href="/talent" className="hub-btn hub-btn-outline-light">
                Post a requirement
              </Link>
              <Link href="/program" className="hub-btn hub-btn-solid-light">
                Join the next cohort
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* —— footer —— */}
      <footer
        style={{
          background: "var(--hub-lavender)",
          padding: "56px 0 28px",
        }}
      >
        <div className="hub-shell">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr repeat(3, 1fr)",
              gap: 32,
            }}
            className="hub-footer-grid"
          >
            <div>
              <Image
                src="/landing/abtalks-logo-mark.png"
                alt="ABTalks"
                width={561}
                height={168}
                className="hub-footer-logo hub-logo-mark"
              />
            </div>
            <FooterCol
              title="Company"
              links={[
                { href: "/mission", label: "About Us" },
                { href: "/talent", label: "Talent" },
                { href: "/jobs", label: "Jobs" },
              ]}
            />
            <FooterCol
              title="Programs"
              links={[
                { href: "/challenges", label: "60-Day Challenge" },
                { href: "/program", label: "AI Cohort" },
                { href: "/hackathon", label: "Hackathon" },
                { href: "/claude-signup", label: "Claude Challenge" },
              ]}
            />
            <FooterCol
              title="Help"
              links={[
                { href: "#faq", label: "FAQs" },
                { href: "/terms", label: "Terms" },
                { href: "/privacy", label: "Privacy" },
                { href: "/cookies", label: "Cookies" },
                { href: "/contact", label: "Contact" },
                { href: "/login", label: "Sign in" },
              ]}
            />
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              gap: 12,
              marginTop: 48,
              paddingTop: 20,
              borderTop: "1px solid color-mix(in srgb, #7c5cff 25%, transparent)",
              fontSize: 13,
              color: "#888",
            }}
          >
            <span>ABTalks © 2026</span>
            <span>Profiles are shared only with candidate consent.</span>
          </div>
        </div>
      </footer>

      <style>{`
        @media (max-width: 960px) {
          .landing-hub .hub-consent-grid,
          .landing-hub .hub-community-grid {
            grid-template-columns: 1fr !important;
          }
          .landing-hub .hub-bridge-grid {
            grid-template-columns: 1fr !important;
          }
          .landing-hub .hub-bridge-arrow { display: none !important; }
          .landing-hub .hub-programs-grid {
            grid-template-columns: 1fr 1fr !important;
          }
          .landing-hub .hub-footer-grid {
            grid-template-columns: 1fr 1fr !important;
          }
          .landing-hub .hub-stats-grid {
            grid-template-columns: 1fr !important;
            gap: 20px !important;
          }
        }
        @media (max-width: 700px) {
          .landing-hub .hub-programs-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

function BridgeSideCard({
  tag,
  title,
  items,
}: {
  tag: string;
  title: string;
  items: string[];
}) {
  return (
    <div
      style={{
        background: "#fdfdfd",
        border: "1px solid var(--hub-border)",
        borderRadius: 15,
        padding: "22px 24px",
        minHeight: 260,
      }}
    >
      <span
        style={{
          display: "inline-block",
          border: "1px solid var(--hub-accent)",
          background: "rgba(107,56,209,0.12)",
          color: "var(--hub-accent-700)",
          borderRadius: 3,
          padding: "4px 10px",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {tag}
      </span>
      <p
        style={{
          margin: "18px 0 0",
          fontSize: 20,
          fontWeight: 800,
          lineHeight: 1.25,
        }}
      >
        {title}
      </p>
      <ul
        style={{
          listStyle: "none",
          margin: "18px 0 0",
          padding: 0,
          display: "grid",
          gap: 10,
        }}
      >
        {items.map((item) => (
          <li
            key={item}
            style={{
              display: "flex",
              gap: 8,
              fontSize: 14,
              lineHeight: 1.4,
              color: "#555",
            }}
          >
            <span style={{ color: "#6c5ce7", fontWeight: 700 }}>■</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BridgeArrow() {
  return (
    <div
      className="hub-bridge-arrow"
      aria-hidden
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--hub-accent)",
        fontSize: 28,
        fontWeight: 700,
      }}
    >
      →
    </div>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <p
        style={{
          margin: 0,
          fontSize: 16,
          fontWeight: 600,
          textTransform: "uppercase",
          color: "#353535",
        }}
      >
        {title}
      </p>
      <ul
        style={{
          listStyle: "none",
          margin: "16px 0 0",
          padding: 0,
          display: "grid",
          gap: 10,
        }}
      >
        {links.map((link) => (
          <li key={link.href + link.label}>
            <Link
              href={link.href}
              style={{
                color: "#4b4b4b",
                textDecoration: "none",
                fontSize: 15,
              }}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
