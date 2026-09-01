import { PROGRAM_AI_COHORT_BASE } from "@/features/program/constants";

export const WHATSAPP_INVITE =
  "https://chat.whatsapp.com/LSru1BgvifpEB4OMZsaZEi";

export const NAV_LINKS = [
  { href: "#bridge", id: "bridge", label: "Platform" },
  { href: "#how", id: "how", label: "How it works" },
  { href: "#cohorts", id: "cohorts", label: "Cohorts" },
  { href: "#faq", id: "faq", label: "FAQ" },
] as const;

export const GET_STARTED_ITEMS = [
  { href: "/register", label: "Candidates" },
  { href: "/hire", label: "Recruiter" },
] as const;

export const STATS = [
  { count: 10, suffix: "k+", label: "People on the platform" },
  { count: 100, suffix: "+", label: "Companies in the recruiter network" },
  { count: 15, suffix: "+", label: "Profiles shared with consent" },
] as const;

export const BRIDGE_SLABS = [
  { key: "top", slab: 3, label: "100+ companies" },
  { key: "middle", slab: 2, label: "ABTalks" },
  { key: "bottom", slab: 1, label: "12k+ users" },
] as const;

export const BRIDGE_PANELS = [
  {
    label: "The Bridge",
    title: "Talent on one side.\nRequirements on the other.",
    body: "We don't forward CVs. We watch people build, score the output against what a company actually asked for, and only then make an introduction.",
    items: null,
  },
  {
    label: "For the candidates",
    title: "Make yourself visible by building.",
    body: null,
    items: [
      "Hackathons — weekend builds, judged and archived",
      "Cohorts — multi-week programs with mentors",
      "Challenges — scoped problems from real companies",
    ],
  },
  {
    label: "The Bridge",
    title: "ABTalks",
    body: "We run the programs, score the work, and match evidence to requirements. Profiles move only when the candidate releases them.",
    items: null,
  },
  {
    label: "For the companies",
    title: "Hire from proof, or commission it.",
    body: null,
    items: [
      "Browse candidates by what they shipped",
      "Send us the role and the skills you need",
      "We build a cohort against that requirement",
    ],
  },
] as const;

export const ROLLER_STEPS = [
  {
    num: "01",
    title: "A requirement comes in",
    body: "A company tells us the role, the stack, the level and the timeline. If a matching cohort is already running, we point at it. If not, we design one around the requirement.",
    image: "/landing/site/how-01.webp",
    alt: "A hiring team writing up a role brief",
    mediaClass: "",
    width: 1693,
    height: 929,
  },
  {
    num: "02",
    title: "People build in public",
    body: "Candidates ship inside a cohort, hackathon or challenge. Every commit, demo and review is recorded, so the evidence is the work itself — not a claim on a résumé.",
    image: "/landing/site/how-02.webp",
    alt: "Cohort members building and reviewing code together",
    mediaClass: "how__media--alt",
    width: 1602,
    height: 982,
  },
  {
    num: "03",
    title: "You see verified output",
    body: "We rank candidates against your threshold and share the shortlist — with scores, artefacts and context. Profiles move only after the candidate consents.",
    image: "/landing/site/how-03.webp",
    alt: "A scored shortlist of candidates with their build evidence",
    mediaClass: "how__media--alt2",
    width: 1610,
    height: 977,
  },
] as const;

export const PIPELINE = [
  {
    title: "Define",
    note: "A company tells us the role, the stack, the level and the timeline. We scan live cohorts and the archive for people who already solved something close.",
  },
  {
    title: "Discover",
    note: "A longlist is assembled from verified build history, not keyword matches. If a matching cohort is already running, we point at it. If not, we design one around the requirement.",
  },
  {
    title: "Connect",
    note: "You meet a short list that has already cleared the technical bar. Scores, artefacts and reviewer notes travel with every candidate. We recommend the closest fit and explain exactly why. Profiles are released with consent, and the offer goes out.",
  },
] as const;

export type DashFilter = { label: string; value: string };

export type DashCard = {
  title: string;
  titleEm?: string;
  star?: boolean;
  when?: string;
  role?: string;
  chips?: readonly string[];
  meters?: readonly number[];
  score?: string;
  scoreNote?: string;
  fade?: boolean;
};

export type DashStage = {
  id: number;
  meta: string;
  pill: string;
  pillOk?: boolean;
  filters?: readonly DashFilter[];
  scan?: number;
  cards?: readonly DashCard[];
};

export const DASHBOARD_STAGES: readonly DashStage[] = [
  {
    id: 0,
    meta: "New requirement · Razorpay",
    pill: "Draft",
    filters: [
      { label: "Role", value: "Senior Backend Engineer" },
      { label: "Stack", value: "Python, Kafka" },
      { label: "Level", value: "5+ yrs" },
      { label: "Start", value: "4 weeks" },
    ],
    cards: [
      {
        title: "Brief received",
        role: "Scope, seniority and timeline captured. Matching begins automatically.",
      },
    ],
  },
  {
    id: 1,
    meta: "Scanning 14 cohorts · 3 archives",
    pill: "Live",
    filters: [
      { label: "Search", value: "senior python backend" },
      { label: "Skills", value: "python, distributed" },
      { label: "Min years", value: "5" },
      { label: "Min score", value: "800" },
    ],
    scan: 5,
  },
  {
    id: 2,
    meta: "38 candidates matched the requirement",
    pill: "Longlist",
    cards: [
      {
        title: "#1 Sohail Khan",
        titleEm: "· 8 yrs",
        role: "Senior Backend Engineer",
      },
      {
        title: "#2 Shivansh Rai",
        titleEm: "· 6 yrs",
        role: "Platform Engineer",
      },
      { title: "#3 Ishita ", titleEm: "· 5 yrs", fade: true },
    ],
  },
  {
    id: 3,
    meta: "5 candidates above threshold · ranked by verified performance",
    pill: "2 shortlisted",
    cards: [
      {
        title: "#1 Sohail Khan",
        titleEm: "· 8 yrs",
        star: true,
        role: "Senior Backend Engineer",
        chips: [
          "Python",
          "Distributed Systems",
          "AWS",
          "Kafka",
          "PostgreSQL",
          "Go",
        ],
        meters: [92, 86],
        score: "943",
        scoreNote: "86% clean passes",
      },
      {
        title: "#2 Shivansh Rai",
        titleEm: "· 6 yrs",
        star: true,
        role: "Platform Engineer",
        chips: ["Python", "Kubernetes", "gRPC", "Redis", "Terraform"],
        meters: [78, 71],
        score: "902",
        scoreNote: "79% clean passes",
      },
    ],
  },
  {
    id: 4,
    meta: "Interview slots · this week",
    pill: "3 booked",
    cards: [
      {
        title: "Sohail Khan",
        when: "Tue · 11:00",
        role: "System design · 60 min",
      },
      {
        title: "Shivansh Rai",
        when: "Wed · 15:30",
        role: "Platform deep dive · 45 min",
      },
      { title: "Ishita ", when: "Fri · 10:00", fade: true },
    ],
  },
  {
    id: 5,
    meta: "Evidence attached to every candidate",
    pill: "Scored",
    cards: [
      {
        title: "Sohail Khan",
        score: "943",
        meters: [94, 88, 81],
      },
      {
        title: "Shivansh Rai",
        score: "902",
        meters: [80, 74, 69],
      },
    ],
  },
  {
    id: 6,
    meta: "Recommendation sent to the hiring team",
    pill: "1 of 5",
    cards: [
      {
        title: "Sohail Khan",
        titleEm: "· closest fit",
        star: true,
        role: "Shipped an event-driven payments service in the 60-day cohort — same stack, same load profile as your brief.",
        chips: ["Kafka", "Idempotency", "Postgres"],
      },
    ],
  },
  {
    id: 7,
    meta: "Profile released with consent",
    pill: "Hired",
    pillOk: true,
    cards: [
      {
        title: "Sohail Khan",
        when: "Offer accepted",
        role: "Senior Backend Engineer · start in 4 weeks",
        meters: [100],
      },
    ],
  },
];

export type CohortKey = "challenge" | "hackathon" | "program" | "claude";

export type CohortCard = {
  key: CohortKey;
  title: string;
  badge: string;
  href: string;
  ctaLabel: string;
  bullets: readonly string[];
  order: number;
};

export const COHORT_DEFAULTS: readonly Omit<
  CohortCard,
  "badge" | "ctaLabel"
>[] = [
  {
    key: "challenge",
    title: "60 Day Coding Challenge",
    href: "/challenges",
    order: 0,
    bullets: [
      "Choose AI, Data Science, or Software Engineering",
      "One task a day for 60 days",
      "Proof of work on GitHub and LinkedIn",
    ],
  },
  {
    key: "hackathon",
    title: "Databricks Cohort",
    href: "/t",
    order: 2,
    bullets: [
      "Spark, lakehouse, and production pipelines",
      "Build against a real data brief",
      "Dates announced to the waitlist",
    ],
  },
  {
    key: "program",
    title: "31 Days AI Cohort",
    href: PROGRAM_AI_COHORT_BASE,
    order: 1,
    bullets: [
      "Ship a production-grade healthcare chatbot",
      "RAG, agents, MCP, and deploy",
      "Recruiter-visible after you finish",
    ],
  },
  {
    key: "claude",
    title: "Claude Challenge",
    href: "/claude-signup",
    order: 3,
    bullets: [
      "60 days building with Claude",
      "Prompt engineering through real projects",
      "Daily public builds",
    ],
  },
];

export const FAQ_ITEMS = [
  {
    q: "Does it cost anything to join a cohort?",
    a: "Most challenges are free to join. Paid cohorts are always priced up front, and anyone placed through the recruiter network never pays a placement fee.",
  },
  {
    q: "What exactly do companies see before I consent?",
    a: "An anonymised performance summary: score band, stack and cohort. Your name, contact details and repositories stay hidden until you approve the share.",
  },
  {
    q: "Do I need to be a student or a developer?",
    a: "Neither is required. Designers, data folks and career switchers run the same cohorts — the only requirement is that you ship something we can evaluate.",
  },
  {
    q: "We have a niche requirement. Can you build a cohort for it?",
    a: "Yes. Send us the role, stack and timeline and we'll design a challenge around it, usually running within three to four weeks.",
  },
] as const;

export const COMMUNITY_BULLETS = [
  "Daily motivation and peer support",
  "Feedback that helps you improve",
  "Opportunities, events and workshops",
  "A network that grows with you",
] as const;

export const COMMUNITY_PHOTOS = [
  {
    src: "/landing/site/photo-1.webp",
    alt: "Builders at an ABTalks hackathon",
    tile: 1,
    width: 230,
    height: 400,
  },
  {
    src: "/landing/site/photo-2.webp",
    alt: "A mentor reviewing work during a cohort session",
    tile: 2,
    width: 230,
    height: 400,
  },
  {
    src: "/landing/site/photo-3.webp",
    alt: "Demo night at an ABTalks community meetup",
    tile: 3,
    width: 220,
    height: 400,
  },
  {
    src: "/landing/site/photo-4.webp",
    alt: "Members pairing on a challenge brief",
    tile: 4,
    width: 218,
    height: 400,
  },
  {
    src: "/landing/site/photo-5.webp",
    alt: "The ABTalks community at a workshop",
    tile: 5,
    width: 220,
    height: 400,
  },
] as const;

export const QUOTE_TINTS = ["pink", "coral", "cream", "peach"] as const;

export const GLOBE_LATS = [
  { r: 0.1, h: 0.995 },
  { r: 0.15, h: 0.989 },
  { r: 0.2, h: 0.98 },
  { r: 0.25, h: 0.968 },
  { r: 0.3, h: 0.954 },
  { r: 0.35, h: 0.937 },
  { r: 0.4, h: 0.917 },
  { r: 0.45, h: 0.893 },
  { r: 0.5, h: 0.866 },
  { r: 0.545, h: 0.838 },
  { r: 0.58, h: 0.815 },
  { r: 0.62, h: 0.785 },
  { r: 0.66, h: 0.751 },
  { r: 0.7, h: 0.714 },
  { r: 0.73, h: 0.683 },
  { r: 0.76, h: 0.65 },
  { r: 0.79, h: 0.613 },
  { r: 0.845, h: 0.535 },
  { r: 0.89, h: 0.456 },
  { r: 0.925, h: 0.38 },
  { r: 0.952, h: 0.306 },
  { r: 0.972, h: 0.235 },
  { r: 0.986, h: 0.167 },
  { r: 0.996, h: 0.089 },
] as const;

export const FOOTER_COLUMNS = [
  {
    title: "Company",
    links: [
      { href: "/mission", label: "About Us" },
      { href: "/hire", label: "Talent" },
      { href: "/jobs", label: "Jobs" },
    ],
  },
  {
    title: "Programs",
    links: [
      { href: "/challenges", label: "60-Day Challenge" },
      { href: PROGRAM_AI_COHORT_BASE, label: "AI Cohort" },
      { href: "/hackathon", label: "Hackathon" },
      { href: "/claude-signup", label: "Claude Challenge" },
    ],
  },
  {
    title: "Help",
    links: [
      { href: "#faq", label: "FAQs" },
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
      { href: "/cookies", label: "Cookies" },
    ],
  },
] as const;
