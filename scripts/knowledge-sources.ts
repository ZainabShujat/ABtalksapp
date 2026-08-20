/**
 * The chatbot knowledge-ingestion allowlist (docs/plans/063-chatbot-dynamic-knowledge-ingestion.md).
 *
 * This is the single safety mechanism preventing private/internal app
 * content from ever reaching the chatbot corpus: `scripts/extract-public-content.ts`
 * reads ONLY from the entries listed here — it never crawls `src/app/`,
 * never auto-discovers new sources. Adding a new source requires a
 * deliberate addition to this file, and every entry must name the public
 * route(s) it backs so the auth-drift check (§5 of the plan) can verify —
 * on every build — that the route hasn't since become protected.
 *
 * DO NOT add a source here without confirming, by hand, that a signed-out
 * visitor can actually reach the route(s) listed (check `middleware.ts`'s
 * `protectedPaths`, and any in-page `auth()`/`redirect(...)`/`requireX()`
 * calls). See §3b/§3c of the plan for concrete examples of public-but-must-
 * NOT-ingest content (personal data, secret share links) and confirmed-
 * protected content that must never appear here.
 */

export type KnowledgeSource = {
  /** Stable id — becomes the generated filename (knowledge/generated/<id>.md) and the manifest key. */
  id: string;
  /** Public route(s) this content backs, purely for the auth-drift check and for humans reading this file. */
  routes: string[];
  /** Returns the normalized markdown body for this source (heading + prose/tables), or null if unavailable this run. */
  load: () => Promise<string | null>;
};

function mdList(items: readonly string[]): string {
  return items.map((i) => `- ${i}`).join("\n");
}

function mdFaq(items: { q: string; a: string }[]): string {
  return items.map((i) => `**Q: ${i.q}**\nA: ${i.a}`).join("\n\n");
}

export const KNOWLEDGE_SOURCES: KnowledgeSource[] = [
  {
    id: "footer-social-contact",
    // AppFooter is mounted site-wide in src/app/layout.tsx and only hides
    // itself on a few specific routes (marketplace/workshop/program/talent/
    // hackathon/landing, each of which ships its own footer or none) — it
    // renders on both of these already-verified-public routes.
    routes: ["/challenges", "/claude-signup"],
    async load() {
      const m = await import("../src/components/shared/app-footer");
      return `# ABTalks Social & Contact Links (live site footer)

## Support email
${m.SUPPORT_EMAIL}

## Official social channels
${m.SOCIAL_LINKS.map((s) => `- ${s.label}: ${s.href}`).join("\n")}
`;
    },
  },
  {
    id: "homepage",
    routes: ["/"],
    async load() {
      const m = await import("../src/components/landing/modernist/landing-content");
      return `# ABTalks Homepage (live site content, "/")

## Stats
${mdList(m.STATS.map((s) => `${s.figure} — ${s.label}`))}

## How it works
${m.STEPS.map((s) => `${s.number}. **${s.title}** — ${s.body}`).join("\n\n")}

## What counts as evidence
${m.EVIDENCE.map((e) => `- **${e.title}** — ${e.body}`).join("\n")}

## For candidates
${mdList(m.CANDIDATE_ITEMS)}

## For companies
${mdList(m.COMPANY_ITEMS)}

## Programs featured on the homepage
${m.PROGRAMS.map((p) => `- **${p.title}** (${p.tag}, ${p.cadence}) — ${p.body} → ${p.href}`).join("\n")}

## Homepage FAQ
${mdFaq(m.FAQS)}

## Homepage testimonials
${m.TESTIMONIALS.map((t) => `> "${t.quote}"\n> — ${t.attribution}`).join("\n\n")}
`;
    },
  },
  {
    id: "challenges-page",
    routes: ["/challenges"],
    async load() {
      const page = await import("../src/app/challenges/page");
      const domainPicker = await import("../src/components/challenges/domain-picker");
      return `# 60-Day Coding Challenge — Live Page Content ("/challenges")

## Domains
${domainPicker.DOMAINS.map((d) => `- **${d.label}** — ${d.blurb}`).join("\n")}

## How a day works
${page.DAY_STEPS.map((s) => `- ${s.label}`).join("\n")}

## FAQ
${mdFaq(page.FAQ_ITEMS)}
`;
    },
  },
  {
    id: "claude-signup-page",
    routes: ["/claude-signup"],
    async load() {
      const welcome = await import("../src/components/claude/slides/claude-welcome-slide");
      const why = await import("../src/components/claude/slides/claude-why-slide");
      const audience = await import("../src/components/claude/slides/claude-audience-slide");
      const roadmap = await import("../src/components/claude/slides/claude-roadmap-slide");
      const cta = await import("../src/components/claude/slides/claude-cta-slide");
      return `# 60-Day Claude AI Challenge — Live Onboarding Content ("/claude-signup")

Note: this is a DIFFERENT curriculum shape than any day-by-day table that
may exist elsewhere in the knowledge base — this is the authoritative one,
read directly from the live onboarding flow.

## Overview
${welcome.WELCOME_FACTS.headline} — ${welcome.WELCOME_FACTS.tagline} Launching ${welcome.WELCOME_FACTS.launchDate}.

## Why this challenge
${why.CLAUDE_WHY_ITEMS.map((i) => `- **${i.stat}** ${i.label} (${i.sub})`).join("\n")}

## Who it's for
${audience.ROLES.map((r) => `- **${r.title}** — ${r.desc}`).join("\n")}

## The 4-phase roadmap
${roadmap.PHASES.map((p) => `${p.number}. **${p.title}** (${p.days}) — ${p.desc}`).join("\n\n")}

## Challenge rules
${mdList(cta.CHALLENGE_RULES)}
`;
    },
  },
  {
    id: "ai-workshop-page",
    routes: ["/ai-workshop", "/ai-workshop/events"],
    async load() {
      const topics = await import("../src/components/workshop/TopicsSection");
      const stats = await import("../src/components/workshop/CommunityStats");
      const events = await import("../src/components/workshop/events-data");

      let configBlock = "";
      try {
        const { getWorkshopConfig } = await import("../src/lib/workshop-supabase");
        const cfg = await getWorkshopConfig();
        configBlock = `\n## Current webinar logistics\n- Date: ${cfg.webinarDate}\n- Time: ${cfg.webinarTime}\n- Platform: Zoom (link sent on registration)\n`;
      } catch {
        // Supabase config unreachable this run — omit rather than guess.
      }

      return `# AI Tools Workshop — Live Page Content ("/ai-workshop")

## Topics covered
${topics.TOPICS.map((t) => `- **${t.title}** — ${t.desc}`).join("\n")}

## Community stats
${stats.STATS.map((s) => `${s.value}${s.suffix} ${s.label} (${s.sub})`).join("\n")}
${configBlock}
## Events
${events.EVENTS.map((e) => `- **${e.title}** (${e.date}, ${e.time}) — ${e.desc} [${e.host}, ${e.location}]${e.registrationOpen ? " — registration OPEN" : ""}`).join("\n")}
`;
    },
  },
  {
    id: "ai-cohort-application-pages",
    routes: ["/ai-cohort-register", "/ai-cohort-india"],
    async load() {
      const hero = await import("../src/components/talent-hunt/hero");
      const glance = await import("../src/components/talent-hunt/program-at-a-glance");
      const build = await import("../src/components/talent-hunt/what-you-will-build");
      const audience = await import("../src/components/talent-hunt/who-this-is-for");

      const usaStats = glance.programAtAGlanceStats("USA");
      const indiaStats = glance.programAtAGlanceStats("India");

      return `# AI Cohort Training Program — Application Pages ("/ai-cohort-register", "/ai-cohort-india")

Note: this is a SEPARATE top-of-funnel application flow from the /program
AI Cohort product page — different shape (${hero.PROGRAM_FACTS.durationDays}-day here vs. 31-day on /program).
Do not merge these into one description; if a user asks about "the AI Cohort"
ambiguously, both may be relevant.

## Program facts
- Tagline: ${hero.PROGRAM_FACTS.tagline}
- Launch: ${hero.PROGRAM_FACTS.launchDate}
- Completion: ${hero.PROGRAM_FACTS.completionDate}
- Duration: ${hero.PROGRAM_FACTS.durationDays} days
- Pre-assessment required: ${hero.PROGRAM_FACTS.requiresPreAssessment ? "yes" : "no"}

## Program at a glance (US edition)
${usaStats.map((s) => `${s.value} ${s.label}`).join("\n")}

## Program at a glance (India edition)
${indiaStats.map((s) => `${s.value} ${s.label}`).join("\n")}

## What you will build
${build.modules.map((m) => `### ${m.title}\n${mdList(m.bullets)}`).join("\n\n")}

## Who this is for
${mdList(audience.audiences.map((a) => a.label))}
`;
    },
  },
  {
    id: "ai-cohort-application-flow",
    // Reachable by a signed-out visitor: confirmed — neither route is in
    // middleware.ts protectedPaths, and the only gate (ApplyGate,
    // src/components/talent-hunt/apply-gate.tsx) is a client-side
    // sessionStorage UX check (must click through the intro flow first),
    // not authentication. A direct/crawler GET just shows a loading shell
    // that client-redirects — the content itself is still public.
    routes: ["/ai-cohort-register/apply", "/ai-cohort-india/apply"],
    async load() {
      // application-form.tsx transitively imports a Server Action
      // (submitCohortApplicationAction) that creates a Supabase client at
      // module scope — that throws in any environment missing
      // NEXT_PUBLIC_SUPABASE_URL/ANON_KEY (this local dev env has neither
      // set). Same failure class as ai-workshop-page's getWorkshopConfig()
      // above; same fix: degrade gracefully rather than fail the build.
      try {
        const us = await import("../src/components/talent-hunt/application-form");
        const india = await import("../src/components/talent-hunt/application-form-india");

        const usCommitments = us.COMMITMENTS.map((c) => c.label);
        const indiaCommitments = india.COMMITMENTS.map((c) => c.label);

        return `# AI Cohort Application Flow — Live Content ("/ai-cohort-register/apply", "/ai-cohort-india/apply")

The 5-step application form applicants fill out after the intro flow on
/ai-cohort-register or /ai-cohort-india. Same step structure for both the
US and India editions.

## Steps
${Object.keys(us.STEP_TITLES).map((k) => `${k}. **${us.STEP_TITLES[Number(k)]}** — ${us.STEP_DESCRIPTIONS[Number(k)]}`).join("\n")}

## Commitments an applicant must confirm (US edition)
${mdList(usCommitments)}

## Commitments an applicant must confirm (India edition)
${mdList(indiaCommitments)}

Note: the India edition has no "based in the United States" commitment —
that is the only difference between the two editions' commitment lists.
`;
      } catch (err) {
        console.warn(
          `[knowledge-sources] ai-cohort-application-flow unavailable this run (${(err as Error).message}) — likely missing Supabase env vars locally; should succeed where NEXT_PUBLIC_SUPABASE_URL/ANON_KEY are set.`,
        );
        return null;
      }
    },
  },
  {
    id: "program-landing-page",
    routes: ["/program"],
    async load() {
      const landing = await import("../src/components/program/landing/program-landing");
      const roadmap = await import("../src/data/roadmap");

      return `# AI Cohort (Program) — Live Landing Page Content ("/program")

Note: this is the public marketing landing page only. It is separate from
/ai-cohort-register and /ai-cohort-india's application-funnel content (see
the ai-cohort-application-pages source) — different day count (31 here vs.
30 there). Do not merge them.

## Requirements
${landing.requirements.map((r) => `- ${r.text}${r.highlight}${r.suffix}`).join("\n")}

## Prerequisites
${landing.prerequisites.map((r) => `- ${r.text}${r.highlight}${r.suffix}`).join("\n")}

## 8-phase / 31-day roadmap
${roadmap.ROADMAP_PHASES.map((p: { title: string; subtitle: string; days: string }) => `- **${p.title}** (${p.days}) — ${p.subtitle}`).join("\n")}

## How it works
${roadmap.HOW_IT_WORKS_STEPS.map((s: { title: string; detail: string }) => `- **${s.title}** — ${s.detail}`).join("\n")}
`;
    },
  },
];
