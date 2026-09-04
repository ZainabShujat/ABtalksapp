import type { Domain } from "@prisma/client";
import type { HubEnrollment } from "@/features/dashboard/get-hub-data";
import type {
  AvailableCohortInterview,
  AvailableMockInterview,
} from "@/components/dashboard-hub/mock-interviews";
import { NAV_ITEMS } from "@/components/dashboard-hub/nav-items";
import { DASHBOARD_FAQ } from "@/components/dashboard-hub/faq-content";
import { EVENTS } from "@/components/workshop/events-data";
import { PROGRAM_AI_COHORT_BASE } from "@/features/program/constants";

export const HUB_SEARCH_GROUPS = [
  "Pages",
  "Continue",
  "Challenges",
  "Interviews",
  "Prep Kit",
  "Events",
  "FAQ",
] as const;

export type HubSearchGroup = (typeof HUB_SEARCH_GROUPS)[number];

export type HubSearchItem = {
  id: string;
  group: HubSearchGroup;
  title: string;
  subtitle?: string;
  href: string;
  keywords: string;
};

const TRACK_PATH: Record<Domain, string> = {
  AI: "/ai",
  DS: "/ds",
  SE: "/se",
  CLAUDE: "/claude",
};

const DOMAIN_LABEL: Record<Domain, string> = {
  AI: "Artificial Intelligence",
  DS: "Data Science",
  SE: "Software Engineering",
  CLAUDE: "Claude Challenge",
};

const ROADMAPS: { domain: Domain; label: string; keywords: string }[] = [
  { domain: "AI", label: "Artificial Intelligence", keywords: "ai artificial intelligence 60-day challenge track" },
  { domain: "DS", label: "Data Science", keywords: "ds data science 60-day challenge track" },
  { domain: "SE", label: "Software Engineering", keywords: "se software engineering 60-day challenge track" },
];

const PAGE_KEYWORDS: Record<string, string> = {
  "/dashboard": "dashboard hub home",
  "/workshop": "workshop workshops events live",
  "/marketplace": "marketplace synergy points rewards redeem",
  "/jobs": "jobs career hiring recruiter",
  "/achievements": "achievements certificate certificates",
  "/profile": "profile account",
};

export type HubSearchIndexInput = {
  enrollments: HubEnrollment[];
  joinedDomains: Domain[];
  abandonedDomains: Domain[];
  hasProgramMembership: boolean;
  hasDatabricksAccess: boolean;
  hasDsArchitectAccess: boolean;
  hasPowerBiAccess: boolean;
  isAdmin: boolean;
  claudeEnabled: boolean;
  programEnabled: boolean;
  mock: AvailableMockInterview[];
  cohort: AvailableCohortInterview[];
};

function trackHref(
  domain: Domain,
  joined: Set<Domain>,
  abandoned: Set<Domain>,
): string {
  if (joined.has(domain) || abandoned.has(domain)) {
    return TRACK_PATH[domain];
  }
  return `/register?domain=${domain}`;
}

function eventHref(event: {
  id: string;
  href?: string;
  register?: boolean;
}): string {
  return (
    event.href ??
    (event.register ? `/workshop/events#${event.id}` : "/workshop/events")
  );
}

export function buildHubSearchIndex(input: HubSearchIndexInput): HubSearchItem[] {
  const joined = new Set(input.joinedDomains);
  const abandoned = new Set(input.abandonedDomains);
  const items: HubSearchItem[] = [];

  for (const nav of NAV_ITEMS) {
    items.push({
      id: `page:${nav.href}`,
      group: "Pages",
      title: nav.label,
      href: nav.href,
      keywords: PAGE_KEYWORDS[nav.href] ?? nav.label,
    });
  }

  if (input.isAdmin) {
    items.push({
      id: "page:/admin",
      group: "Pages",
      title: "Admin",
      href: "/admin",
      keywords: "admin",
    });
  }

  items.push(
    {
      id: "page:#your-challenge",
      group: "Pages",
      title: "Your Challenges",
      href: "#your-challenge",
      keywords: "continue journey your challenges streak",
    },
    {
      id: "page:#domains",
      group: "Pages",
      title: "Domains",
      href: "#domains",
      keywords: "domains tracks challenge tracks roadmaps",
    },
    {
      id: "page:#events",
      group: "Pages",
      title: "Events",
      href: "#events",
      keywords: "events workshops",
    },
    {
      id: "page:#faq",
      group: "Pages",
      title: "FAQ",
      href: "#faq",
      keywords: "faq questions frequently asked",
    },
    {
      id: "page:#mock-interviews",
      group: "Pages",
      title: "AI agent interviews",
      href: "#mock-interviews",
      keywords: "interview mock interviews voice",
    },
  );

  if (input.programEnabled) {
    items.push({
      id: "page:#prep-kit",
      group: "Pages",
      title: "Prep Kit",
      href: "#prep-kit",
      keywords: "prep kit cohort program",
    });
  }

  for (const enrollment of input.enrollments) {
    items.push({
      id: `continue:${enrollment.id}`,
      group: "Continue",
      title: DOMAIN_LABEL[enrollment.domain],
      subtitle: enrollment.challengeTitle,
      href: TRACK_PATH[enrollment.domain],
      keywords: `continue streak journey ${enrollment.domain} ${DOMAIN_LABEL[enrollment.domain]} ${enrollment.challengeTitle}`,
    });
  }

  for (const roadmap of ROADMAPS) {
    items.push({
      id: `challenge:${roadmap.domain}`,
      group: "Challenges",
      title: roadmap.label,
      subtitle: "60-day challenge track",
      href: trackHref(roadmap.domain, joined, abandoned),
      keywords: roadmap.keywords,
    });
  }

  if (input.claudeEnabled) {
    const claudeHref =
      joined.has("CLAUDE") || abandoned.has("CLAUDE")
        ? "/claude"
        : "#other-challenges";
    items.push({
      id: "challenge:CLAUDE",
      group: "Challenges",
      title: "Claude Challenge",
      subtitle: "Build with Claude · 60 days",
      href: claudeHref,
      keywords: "claude challenge 60-day anthropic",
    });
  }

  items.push({
    id: "challenge:browse",
    group: "Challenges",
    title: "Browse challenges",
    href: "/challenges",
    keywords: "browse challenges tracks join",
  });

  items.push(
    {
      id: "interview:all",
      group: "Interviews",
      title: "All mock interviews",
      href: "/mock-interviews",
      keywords: "interview mock interviews all",
    },
    {
      id: "interview:history",
      group: "Interviews",
      title: "Practice history",
      href: "/mock-interviews/history",
      keywords: "interview practice history reports",
    },
  );

  for (const mock of input.mock) {
    items.push({
      id: `interview:mock:${mock.slug}`,
      group: "Interviews",
      title: mock.label,
      subtitle: mock.blurb,
      href: `/mock-interviews/${mock.slug}`,
      keywords: `interview mock ${mock.label} ${mock.blurb} ${mock.slug}`,
    });
  }

  for (const cohort of input.cohort) {
    items.push({
      id: `interview:cohort:${cohort.key}`,
      group: "Interviews",
      title: cohort.label,
      subtitle: cohort.blurb,
      href: cohort.href,
      keywords: `interview cohort ${cohort.label} ${cohort.blurb}`,
    });
  }

  if (input.programEnabled) {
    items.push({
      id: "prep:ai-cohort",
      group: "Prep Kit",
      title: "31 Days AI Cohort",
      subtitle:
        "Build and deploy a production-grade enterprise AI chatbot in 31 days.",
      href: input.hasProgramMembership
        ? `${PROGRAM_AI_COHORT_BASE}/dashboard`
        : `${PROGRAM_AI_COHORT_BASE}/apply`,
      keywords: "prep kit cohort program 31 days ai chatbot",
    });
  }

  if (input.hasDatabricksAccess) {
    items.push({
      id: "prep:databricks",
      group: "Prep Kit",
      title: "31 Days Databricks",
      subtitle:
        "Build a healthcare-claims Lakehouse on Databricks in 31 days.",
      href: "/program/databricks",
      keywords: "prep kit databricks lakehouse 31 days",
    });
  }

  if (input.hasDsArchitectAccess) {
    items.push({
      id: "prep:ds-architect",
      group: "Prep Kit",
      title: "10 Days Data Solutions Architect",
      subtitle: "Design AWS-first data and AI platforms in 10 days.",
      href: "/program/ds-architect",
      keywords: "prep kit ds architect data solutions aws 10 days",
    });
  }

  if (input.hasPowerBiAccess) {
    items.push({
      id: "prep:powerbi",
      group: "Prep Kit",
      title: "7 Days Power BI & Analytics",
      subtitle: "Ship recruiter-grade Power BI dashboards in 7 days.",
      href: "/program/powerbi",
      keywords: "prep kit power bi powerbi analytics dax dashboard 7 days",
    });
  }

  for (const event of EVENTS) {
    items.push({
      id: `event:${event.id}`,
      group: "Events",
      title: event.title,
      subtitle: event.desc,
      href: eventHref(event),
      keywords: `event workshop ${event.title} ${event.desc} ${event.tag} ${event.location}`,
    });
  }

  DASHBOARD_FAQ.forEach((faq, index) => {
    items.push({
      id: `faq:${index}`,
      group: "FAQ",
      title: faq.q,
      subtitle: faq.a,
      href: "#faq",
      keywords: `faq ${faq.q} ${faq.a} streak synergy certificate`,
    });
  });

  return items;
}
