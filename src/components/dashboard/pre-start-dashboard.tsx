"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { BookOpen, MessageCircle, Rocket, Sparkles } from "lucide-react";
import { ClaudeFAQ } from "@/components/shared/claude-faq";
import { buttonVariants } from "@/components/ui/button";
import { formatDateIST } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

interface Enrollment {
  id: string;
  domain: string;
}

interface Challenge {
  title: string;
  startsAt: Date | string;
}

interface Props {
  enrollment: Enrollment;
  challenge: Challenge;
}

function useCountdown(target: Date) {
  const [time, setTime] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });

  useEffect(() => {
    const tick = () => {
      const diff = Math.max(0, target.getTime() - Date.now());
      setTime({
        days: Math.floor(diff / 86_400_000),
        hours: Math.floor((diff % 86_400_000) / 3_600_000),
        minutes: Math.floor((diff % 3_600_000) / 60_000),
        seconds: Math.floor((diff % 60_000) / 1000),
      });
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [target]);

  return time;
}

export function PreStartDashboard({ enrollment, challenge }: Props) {
  const router = useRouter();
  const startsAt =
    typeof challenge.startsAt === "string"
      ? new Date(challenge.startsAt)
      : challenge.startsAt;
  const time = useCountdown(startsAt);

  useEffect(() => {
    if (
      time.days === 0 &&
      time.hours === 0 &&
      time.minutes === 0 &&
      time.seconds === 0 &&
      startsAt.getTime() <= Date.now()
    ) {
      router.refresh();
    }
  }, [time, startsAt, router]);

  const startLabel = formatDateIST(startsAt);

  const countdownUnits = [
    { label: "DAYS", value: time.days },
    { label: "HOURS", value: time.hours },
    { label: "MIN", value: time.minutes },
    { label: "SEC", value: time.seconds },
  ] as const;

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 md:px-6 md:py-8">
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border bg-gradient-to-br from-orange-500/10 via-pink-500/5 to-violet-500/10 p-6 text-center md:p-8"
      >
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <Rocket className="h-8 w-8 text-primary" />
        </div>

        <h1 className="font-display text-2xl font-bold md:text-3xl">
          You&apos;re in! Get ready for the challenge.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground md:text-base">
          {challenge.title} starts on {startLabel}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {enrollment.domain} track · All participants begin together
        </p>

        <div className="mx-auto mt-6 grid max-w-md grid-cols-4 gap-2 sm:gap-3">
          {countdownUnits.map((unit) => (
            <div
              key={unit.label}
              className="rounded-xl border bg-card p-2.5 sm:p-3"
            >
              <div className="font-display text-xl font-bold tabular-nums sm:text-2xl md:text-3xl">
                {String(unit.value).padStart(2, "0")}
              </div>
              <div className="text-[10px] font-medium tracking-wider text-muted-foreground">
                {unit.label}
              </div>
            </div>
          ))}
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl border bg-card p-6"
      >
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg font-semibold">Get Ready</h2>
        </div>

        <ul className="space-y-3 text-sm">
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              1
            </span>
            <div>
              <p className="font-medium">Sign up for Claude</p>
              <p className="text-muted-foreground">
                Create your account at{" "}
                <a
                  href="https://claude.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  claude.ai
                </a>
                . You can complete the challenge on Claude's free plan.
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              2
            </span>
            <div>
              <p className="font-medium">Join the community</p>
              <p className="text-muted-foreground">
                Connect with fellow builders on WhatsApp for daily updates
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              3
            </span>
            <div>
              <p className="font-medium">Block 30 minutes daily</p>
              <p className="text-muted-foreground">
                The challenge demands consistency. Pre-block calendar time for
                the next 60 days.
              </p>
            </div>
          </li>
        </ul>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-2xl border bg-emerald-500/5 p-6 text-center"
      >
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10">
          <MessageCircle className="h-6 w-6 text-emerald-500" />
        </div>
        <h2 className="font-display text-lg font-semibold">
          Join the WhatsApp Community
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Get updates, ask questions, and connect with fellow learners
        </p>
        <a
          href="https://chat.whatsapp.com/LSru1BgvifpEB4OMZsaZEi"
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "mt-4 inline-flex border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400",
          )}
        >
          Join WhatsApp Group
        </a>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="rounded-2xl border bg-card p-6"
      >
        <div className="mb-4 flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg font-semibold">What&apos;s Coming</h2>
        </div>

        <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-1 text-xs text-muted-foreground">
              Phase 1 · Days 1-15
            </div>
            <div className="font-medium">Foundation & Prompt Engineering</div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-1 text-xs text-muted-foreground">
              Phase 2 · Days 16-30
            </div>
            <div className="font-medium">Code, Research & Ecosystem</div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-1 text-xs text-muted-foreground">
              Phase 3 · Days 31-45
            </div>
            <div className="font-medium">Automation, Connectors & Agents</div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-1 text-xs text-muted-foreground">
              Phase 4 · Days 46-60
            </div>
            <div className="font-medium">Domain Mastery & Capstone</div>
          </div>
        </div>
      </motion.section>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
      >
        <ClaudeFAQ />
      </motion.div>
    </main>
  );
}
