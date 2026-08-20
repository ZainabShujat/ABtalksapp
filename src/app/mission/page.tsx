import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  EyeOff,
  MessageCircle,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { auth } from "@/auth";
import { AppHeader } from "@/components/shared/app-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DISCORD_URL = "https://discord.gg/j4Q8tvDj6";

export default async function MissionPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const headerUser = {
    name: session.user.name ?? null,
    email: session.user.email ?? "",
    image: session.user.image ?? null,
    role: session.user.role ?? "STUDENT",
    isAdmin: session.user.isAdmin ?? false,
  };

  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <AppHeader user={headerUser} />
      <div className="mx-auto w-full max-w-4xl flex-1 animate-in fade-in space-y-12 px-4 py-10 duration-500 sm:space-y-16 sm:py-14">
        {/* Hero */}
        <section className="relative rounded-2xl bg-gradient-to-b from-primary/5 to-transparent px-4 py-8 text-center sm:px-8 sm:py-12">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="size-3.5" aria-hidden />
            Our Mission
          </span>
          <h1 className="mt-6 font-display text-3xl font-bold tracking-tight sm:text-5xl">
            Talent isn&apos;t the problem. Proof is.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            ABTalks is that bridge, a community run by students, for students,
            founded by Anil Bajpai after watching capable people get overlooked
            and undervalued.
          </p>
        </section>

        {/* Why ABTalks exists */}
        <section className="space-y-6">
          <div className="space-y-3">
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              Why ABTalks exists
            </h2>
            <p className="text-base leading-relaxed text-muted-foreground">
              Two real problems, one missing bridge.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
                <AlertTriangle className="size-5" aria-hidden />
              </div>
              <h3 className="font-display text-lg font-semibold">
                Students pay the price
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Too many students pour months into internships that pay nothing
                - or worse, ones they have to pay to join - and still come out
                without a real path to a first job.
              </p>
            </article>
            <article className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-slate-500/10 text-slate-600 dark:text-slate-400">
                <EyeOff className="size-5" aria-hidden />
              </div>
              <h3 className="font-display text-lg font-semibold">
                Recruiters hire half-blind
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                On the other side, recruiters are hiring half-blind: a resume
                can&apos;t tell them who genuinely knows their craft.
              </p>
            </article>
          </div>
        </section>

        {/* How it works */}
        <section className="space-y-6">
          <div className="space-y-3">
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              How it works
            </h2>
            <p className="text-base leading-relaxed text-muted-foreground">
              Every day you build, push your work to GitHub,
              and share your progress in public, tagging us so the community can
              follow along and verify it&apos;s real. Working in the open is the
              whole point: it forces you to actually grow, and it leaves behind
              a track record anyone can check.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <article className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm">
              <div
                className="absolute inset-x-0 top-0 h-1 bg-domains-se"
                aria-hidden
              />
              <div className="mb-4 flex size-9 items-center justify-center rounded-full bg-domains-se-bg font-display text-sm font-bold text-domains-se">
                1
              </div>
              <h3 className="font-display font-semibold">Enroll in a challenge</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Start by enrolling in the challenge.
              </p>
            </article>
            <article className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm">
              <div
                className="absolute inset-x-0 top-0 h-1 bg-domains-ds"
                aria-hidden
              />
              <div className="mb-4 flex size-9 items-center justify-center rounded-full bg-domains-ds-bg font-display text-sm font-bold text-domains-ds">
                2
              </div>
              <h3 className="font-display font-semibold">Build in public</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Every day you build, push to GitHub, and share your progress,
                tagging us so the community can verify it&apos;s real.
              </p>
            </article>
            <article className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm">
              <div
                className="absolute inset-x-0 top-0 h-1 bg-domains-ai"
                aria-hidden
              />
              <div className="mb-4 flex size-9 items-center justify-center rounded-full bg-domains-ai-bg font-display text-sm font-bold text-domains-ai">
                3
              </div>
              <h3 className="font-display font-semibold">
                Leave a track record
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Working in the open forces real growth and leaves proof anyone
                can check.
              </p>
            </article>
          </div>
        </section>

        {/* What you're working toward */}
        <section
          className="rounded-2xl bg-gradient-to-br from-primary to-violet-500 p-6 text-primary-foreground sm:p-8"
          aria-labelledby="mission-outcome-heading"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary-foreground/15 p-2">
              <Trophy className="size-6 shrink-0" aria-hidden />
            </div>
            <div className="space-y-3">
              <h2
                id="mission-outcome-heading"
                className="font-display text-2xl font-semibold tracking-tight"
              >
                What you&apos;re working toward
              </h2>
              <p className="text-base leading-relaxed text-primary-foreground/90">
                Complete the 60 days and you move into mock interviews to get
                you sharp and confident. From there you become visible to the
                HRs and leaders in our network, and they reach out to you. No
                applications shouted into the void.
              </p>
            </div>
          </div>
        </section>

        {/* Community */}
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Users className="size-5" aria-hidden />
          </div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            You&apos;re not doing it alone
          </h2>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            ABTalks is students lifting each other up. Our Discord runs weekly
            communication practice and plenty more, with a lot still on the
            way. Show up, do the work in public, and let it speak for you.
          </p>
          <Link
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            className={cn(
              buttonVariants({ variant: "default" }),
              "mt-6 inline-flex gap-2",
            )}
          >
            <MessageCircle className="size-4" aria-hidden />
            Join our Discord
          </Link>
        </section>
      </div>
    </div>
  );
}
