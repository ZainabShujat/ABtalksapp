import type { LandingState, TrackCta } from "@/features/landing/get-landing-state";
import { LandingNav } from "./landing-nav";
import { HeroSection } from "./hero-section";
import { StatsStrip } from "./stats-strip";
import { BridgeSection } from "./bridge-section";
import { HowItWorksSection } from "./how-it-works-section";
import { KeepThreeSection } from "./keep-three-section";
import { CohortsSection } from "./cohorts-section";
import { TestimonialsSection } from "./testimonials-section";
import { FaqSection } from "./faq-section";
import { CommunitySection } from "./community-section";
import { ContactSection } from "./contact-section";
import { CtaBand } from "./cta-band";
import { SiteFooter } from "./site-footer";
import {
  COHORT_DEFAULTS,
  type CohortCard,
  type CohortKey,
} from "./landing-content";
import "./landing.css";

const DEFAULT_BADGE = "Enrolling now";

function resolveCard(
  key: CohortKey,
  override: TrackCta,
): Pick<CohortCard, "href" | "badge" | "ctaLabel"> {
  if (override) {
    return {
      href: override.href,
      badge: "Open dashboard",
      ctaLabel: override.ctaLabel,
    };
  }
  const defaults = COHORT_DEFAULTS.find((card) => card.key === key)!;
  return {
    href: defaults.href,
    badge: DEFAULT_BADGE,
    ctaLabel: DEFAULT_BADGE,
  };
}

export function LandingPage({
  claudeEnabled,
  state,
}: {
  claudeEnabled: boolean;
  state: LandingState;
}) {
  const overrides: Record<CohortKey, TrackCta> = {
    challenge: state.challengeCta,
    hackathon: state.hackathonCta,
    program: state.programCta,
    claude: state.claudeCta,
  };

  const cards: CohortCard[] = COHORT_DEFAULTS.filter(
    (card) => card.key !== "claude" || claudeEnabled,
  ).map((card) => {
    const resolved = resolveCard(card.key, overrides[card.key]);
    return {
      key: card.key,
      title: card.title,
      bullets: card.bullets,
      order: card.order,
      href: resolved.href,
      badge: resolved.badge,
      ctaLabel: resolved.ctaLabel,
    };
  });

  return (
    <div className="abtalks-landing">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <LandingNav user={state.user} />
      <main id="main">
        <HeroSection />
        <StatsStrip />
        <BridgeSection />
        <HowItWorksSection />
        <KeepThreeSection />
        <CohortsSection cards={cards} />
        <TestimonialsSection />
        <FaqSection />
        <CommunitySection />
        <ContactSection />
        <CtaBand />
      </main>
      <SiteFooter />
    </div>
  );
}
