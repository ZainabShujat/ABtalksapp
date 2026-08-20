import Image from "next/image";
import Link from "next/link";
import {
  BriefcaseBusiness,
  CodeXml,
  FolderGit2,
  GraduationCap,
  MessageCircle,
  Trophy,
  UsersRound,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import type { LandingState } from "@/features/landing/get-landing-state";
import { cn } from "@/lib/utils";
import { LandingUserMenu } from "./landing-user-menu";
import { TrackCard } from "./track-card";
import { TestimonialsCarousel } from "./testimonials-carousel";
import { WaitlistTrackCard } from "./waitlist-track-card";

const WHATSAPP_LINK = "https://chat.whatsapp.com/LSru1BgvifpEB4OMZsaZEi";

const TRACKS = [
  {
    key: "challenge" as const,
    accent: "violet" as const,
    title: "60-Day Coding Challenge",
    blurb:
      "One real task every day across AI, Data Science, or Software Engineering. Build a streak and a public portfolio.",
    pill: "Enrolling now",
    chips: ["60 days"],
    href: "/challenges",
    ctaLabel: "Start the challenge",
  },
  {
    key: "hackathon" as const,
    accent: "indigo" as const,
    title: "Vibe Code Hackathon",
    blurb:
      "Build anything using AI in 48 hours. Compete solo or with a team of up to three and ship something real.",
    pill: "Registration closed",
    chips: ["48 hours", "Teams of 1–3"],
    href: "https://abtalks.in",
    ctaLabel: "Explore ABTalks",
  },
  {
    key: "program" as const,
    accent: "indigo" as const,
    title: "31 Days AI Cohort",
    blurb:
      "Build and deploy a production AI chatbot in 31 days. Learn RAG, agents, MCP, and get in front of recruiters.",
    pill: "Applications open",
    chips: ["31 days"],
    href: "/program",
    ctaLabel: "Apply now",
  },
];

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
    title: "Learn Daily",
    description:
      "Choose your track and build practical skills through focused challenges and live sessions.",
  },
  {
    title: "Build & Showcase",
    description:
      "Ship real work, publish your progress, and turn consistent effort into a visible portfolio.",
  },
  {
    title: "Get Hired",
    description:
      "Stand out through proof of work and become discoverable to recruiters in the ABTalks network.",
  },
];

type LandingHubProps = {
  claudeEnabled: boolean;
  state: LandingState;
};

export function LandingHub({ claudeEnabled, state }: LandingHubProps) {
  const ctaByKey = {
    challenge: state.challengeCta,
    hackathon: state.hackathonCta,
    program: state.programCta,
    claude: state.claudeCta,
  } as const;

  const { key: _claudeKey, ...claudeTrackProps } = CLAUDE_TRACK;

  return (
    <div className="relative min-h-svh overflow-hidden bg-background">
      <BackgroundBlobs />

      <header className="relative z-20 border-b border-border/60 bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 md:px-8">
          <Link href="/" className="logo-link focus-spark shrink-0">
            <Image
              src="/abtalks-logo.png"
              alt="ABTalks"
              width={300}
              height={84}
              priority
              className="logo-image"
            />
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            {state.user ? (
              <LandingUserMenu user={state.user} />
            ) : (
              <Link
                href="/login"
                className={cn(buttonVariants({ variant: "ghost" }), "h-10")}
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto max-w-5xl px-5 pb-14 pt-16 text-center md:px-8 md:pb-20 md:pt-24">
          <p className="text-sm font-semibold text-primary">
            Build in public. Grow together.
          </p>
          <h1 className="mx-auto mt-4 max-w-4xl font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl md:text-7xl">
            Code consistently.
            <br />
            Post publicly.
            <br />
            <span className="bg-gradient-to-r from-violet-500 via-indigo-500 to-fuchsia-500 bg-clip-text text-transparent">
              Get noticed.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
            Join India&apos;s coding community for college students to learn,
            build, and accelerate their careers through visible proof of work.
          </p>
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

        <section className="mx-auto max-w-7xl px-5 py-14 md:px-8 md:py-20">
          <div className="grid divide-y divide-border/60 rounded-2xl border border-border/60 bg-card/60 px-6 py-3 shadow-card backdrop-blur-md sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:py-6">
            {STATS.map((stat, index) => (
              <div
                key={stat.label}
                className="flex items-center justify-center gap-3 py-4 sm:py-0"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  {index === 0 ? (
                    <UsersRound className="h-5 w-5" />
                  ) : index === 1 ? (
                    <FolderGit2 className="h-5 w-5" />
                  ) : (
                    <BriefcaseBusiness className="h-5 w-5" />
                  )}
                </span>
                <span>
                  <strong className="block font-display text-xl text-foreground">
                    {stat.value}
                  </strong>
                  <span className="text-sm text-muted-foreground">
                    {stat.label}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 pb-16 md:px-8 md:pb-24">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight text-foreground md:text-4xl">
              How ABTalks works
            </h2>
          </div>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <div
                key={step.title}
                className="rounded-2xl border border-border/60 bg-card/50 p-6 backdrop-blur-md"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  {index === 0 ? (
                    <GraduationCap className="h-5 w-5" />
                  ) : index === 1 ? (
                    <CodeXml className="h-5 w-5" />
                  ) : (
                    <Trophy className="h-5 w-5" />
                  )}
                </span>
                <h3 className="mt-5 font-display text-lg font-bold text-foreground">
                  {index + 1}. {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 pb-20 md:px-8 md:pb-24">
          <div className="relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-emerald-500/15 p-7 backdrop-blur-md md:flex md:items-center md:justify-between md:gap-8 md:p-10">
            <div className="relative z-10 flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-300">
                <MessageCircle className="h-6 w-6" />
              </span>
              <div>
                <h2 className="font-display text-xl font-bold text-foreground md:text-2xl">
                  Join our community for instant updates
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Meet builders, get event alerts, and stay accountable.
                </p>
              </div>
            </div>
            <a
              href={WHATSAPP_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="relative z-10 mt-6 inline-flex h-12 w-full items-center justify-center rounded-xl bg-emerald-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 md:mt-0 md:w-auto"
            >
              Join now
            </a>
            <div
              className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-emerald-400/20 blur-3xl"
              aria-hidden
            />
          </div>
        </section>

        <TestimonialsCarousel />
      </main>

      <footer className="relative z-10 border-t border-border/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between md:px-8">
          <p>© 2026 ABTalks. Build in public.</p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Footer">
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/cookies" className="hover:text-foreground">
              Cookies
            </Link>
            <Link href="/contact" className="hover:text-foreground">
              Contact
            </Link>
            <Link href="/mission" className="hover:text-foreground">
              Mission
            </Link>
            <Link href="/jobs" className="hover:text-foreground">
              Jobs
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function BackgroundBlobs() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className="absolute -right-32 top-20 h-96 w-96 rounded-full bg-violet-500/15 blur-3xl" />
      <div className="absolute -left-40 top-[34rem] h-96 w-96 rounded-full bg-indigo-500/15 blur-3xl" />
      <div className="absolute right-0 top-[62rem] h-80 w-80 rounded-full bg-orange-500/10 blur-3xl" />
    </div>
  );
}
