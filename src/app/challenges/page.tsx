import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Eye,
  GitBranch,
  Share2,
  ShieldX,
  Wrench,
} from "lucide-react";
import { DomainPicker } from "@/components/challenges/domain-picker";
import { StreakGrid } from "@/components/challenges/streak-grid";
import { FaqAccordion } from "@/components/shared/faq-accordion";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "60-Day Coding Challenge | ABTalks",
  description:
    "Build every day, publish your progress, and finish with a portfolio recruiters can discover.",
};

const FAQ_ITEMS = [
  {
    q: "Do I need prior experience?",
    a: "No. Pick the domain that matches what you want to learn. Tasks build progressively, and each day includes a focused problem and learning resources.",
  },
  {
    q: "What if I miss a day?",
    a: "You can continue the challenge, but a missed day breaks your current streak. Submissions follow IST day boundaries.",
  },
  {
    q: "How do I submit my work?",
    a: "Push your solution to GitHub, then publish your progress on LinkedIn. Both links become proof of work on your ABTalks profile.",
  },
  {
    q: "Do I get a certificate?",
    a: "Completing the challenge gives you a finished public portfolio and completion recognition. The core outcome is visible proof of consistent work.",
  },
];

const DAY_STEPS = [
  { label: "Open today’s task", icon: Wrench },
  { label: "Build it", icon: Wrench },
  { label: "Push to GitHub", icon: GitBranch },
  { label: "Post on LinkedIn", icon: Share2 },
];

export default function ChallengesPage() {
  return (
    <div className="relative min-h-svh overflow-hidden bg-background">
      <BackgroundBlobs />

      <header className="relative z-20 border-b border-border/60 bg-background/75 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5 md:px-8">
          <Link
            href="/"
            aria-label="Back to ABTalks home"
            className="focus-spark inline-flex items-center gap-2 text-foreground"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span className="logo-link">
              <Image
                src="/abtalks-logo.png"
                alt="ABTalks"
                width={300}
                height={84}
                priority
                className="logo-image"
              />
            </span>
          </Link>
          <Link
            href="/login"
            className={buttonVariants({ variant: "ghost" })}
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-5 pb-28 pt-14 md:px-8 md:pb-24 md:pt-20">
        <section>
          <span className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            Enrolling now
          </span>
          <h1 className="mt-5 max-w-3xl font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl md:text-6xl">
            60 Days. One task a day.
            <span className="mt-1 block bg-gradient-to-r from-primary to-violet-500 bg-clip-text text-transparent">
              A portfolio that speaks.
            </span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted-foreground md:text-lg">
            Code consistently. Post publicly. Get noticed.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="#choose-domain"
              className={cn(
                buttonVariants({ size: "lg" }),
                "h-12 rounded-xl bg-gradient-to-r from-primary to-violet-500 px-6 text-primary-foreground hover:from-primary/90 hover:to-violet-500/90",
              )}
            >
              Start the challenge
            </Link>
            <a
              href="#how-a-day-works"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-12 rounded-xl px-6",
              )}
            >
              See a sample day
            </a>
          </div>
        </section>

        <section
          id="choose-domain"
          className="mt-16 scroll-mt-24 md:mt-24"
        >
          <h2 className="font-display text-2xl font-bold text-foreground">
            Pick your domain
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose one track for your 60-day journey.
          </p>
          <div className="mt-6">
            <DomainPicker />
          </div>
        </section>

        <section
          id="how-a-day-works"
          className="mt-16 scroll-mt-24 md:mt-24"
        >
          <h2 className="font-display text-2xl font-bold text-foreground">
            How a day works
          </h2>
          <ol className="relative mt-8 space-y-0">
            {DAY_STEPS.map((step, index) => {
              const Icon = step.icon;
              return (
                <li
                  key={step.label}
                  className="relative flex items-center gap-4 pb-7 last:pb-0"
                >
                  {index < DAY_STEPS.length - 1 ? (
                    <span
                      className="absolute left-5 top-10 h-[calc(100%-1rem)] border-l border-dashed border-primary/30"
                      aria-hidden
                    />
                  ) : null}
                  <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-card text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="mr-2 text-xs font-semibold text-primary">
                      0{index + 1}
                    </span>
                    <span className="font-medium text-foreground">
                      {step.label}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="mt-14 grid gap-5 md:mt-20 md:grid-cols-2">
          <StreakGrid />
          <div className="flex flex-col items-center justify-center rounded-3xl border border-border/60 bg-card/70 p-7 text-center shadow-card backdrop-blur-md">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Eye className="h-6 w-6" />
            </span>
            <h2 className="mt-5 font-display text-xl font-bold text-foreground">
              Finish and get discovered
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Top portfolios get exclusive visibility to our network of tech
              recruiters.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {["AI startups", "Product teams", "Hiring network"].map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-16 md:mt-24">
          <h2 className="font-display text-2xl font-bold text-foreground">
            Community rules
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            ABTalks is a place to grow with serious learners. Read these
            carefully.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
              <div className="flex items-start gap-3">
                <ShieldX className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                <div>
                  <h3 className="font-display text-sm font-semibold text-foreground">
                    Foul Language or Harassment
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Any abusive language, harassment, or harmful messaging will
                    lead to{" "}
                    <strong className="text-foreground">permanent ban</strong>{" "}
                    from ABTalks.
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                <div>
                  <h3 className="font-display text-sm font-semibold text-foreground">
                    Cheating or Platform Misuse
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Submitting plagiarized work or misusing the platform will
                    result in a{" "}
                    <strong className="text-foreground">
                      60-day challenge ban
                    </strong>
                    .
                  </p>
                </div>
              </div>
            </div>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            By continuing, you agree to follow these rules. Be real, be
            respectful, and ship real work.
          </p>
        </section>

        <section className="mt-16 md:mt-24">
          <h2 className="font-display text-2xl font-bold text-foreground">
            FAQ
          </h2>
          <div className="mt-6">
            <FaqAccordion items={FAQ_ITEMS} />
          </div>
        </section>

      </main>
    </div>
  );
}

function BackgroundBlobs() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className="absolute -right-32 top-12 h-96 w-96 rounded-full bg-primary/15 blur-3xl" />
      <div className="absolute -left-40 top-[46rem] h-96 w-96 rounded-full bg-violet-500/10 blur-3xl" />
    </div>
  );
}
