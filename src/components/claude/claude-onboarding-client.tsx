"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Rocket } from "lucide-react";
import { SignupTicker } from "@/components/claude/signup-ticker";
import { ClaudeWelcomeSlide } from "@/components/claude/slides/claude-welcome-slide";
import { ClaudeWhySlide } from "@/components/claude/slides/claude-why-slide";
import { ClaudeRoadmapSlide } from "@/components/claude/slides/claude-roadmap-slide";
import { ClaudeAudienceSlide } from "@/components/claude/slides/claude-audience-slide";
import { ClaudeCtaSlide } from "@/components/claude/slides/claude-cta-slide";
import { ProgressDots } from "@/components/landing/progress-dots";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SLIDES = ["welcome", "why", "audience", "roadmap", "cta"] as const;

const LOGIN_HREF = `/login?from=${encodeURIComponent("/register?domain=CLAUDE")}`;

const CHALLENGE_START = new Date("2026-06-01T00:00:00+05:30");

const TRANSITION_MS = 600;

interface Signup {
  firstName: string;
  context: string;
  joinedAt: string;
}

const slideVariants = {
  initial: (dir: "next" | "prev") => ({
    opacity: 0,
    x: dir === "next" ? 60 : -60,
    scale: 0.96,
  }),
  animate: { opacity: 1, x: 0, scale: 1 },
  exit: (dir: "next" | "prev") => ({
    opacity: 0,
    x: dir === "next" ? -60 : 60,
    scale: 0.96,
  }),
};

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

function CountdownDisplay() {
  const time = useCountdown(CHALLENGE_START);

  return (
    <>
      <div
        className="hidden items-center gap-3 rounded-2xl border bg-card/80 px-5 py-2.5 backdrop-blur-sm md:flex"
        aria-live="polite"
      >
        <div className="text-xs font-medium text-muted-foreground">Starts in</div>
        <div className="flex items-center gap-3 font-display font-bold tabular-nums">
          <div className="flex flex-col items-center">
            <span className="text-lg md:text-xl">
              {String(time.days).padStart(2, "0")}
            </span>
            <span className="text-[9px] font-normal tracking-wider text-muted-foreground">
              DAYS
            </span>
          </div>
          <span className="text-muted-foreground">:</span>
          <div className="flex flex-col items-center">
            <span className="text-lg md:text-xl">
              {String(time.hours).padStart(2, "0")}
            </span>
            <span className="text-[9px] font-normal tracking-wider text-muted-foreground">
              HRS
            </span>
          </div>
          <span className="text-muted-foreground">:</span>
          <div className="flex flex-col items-center">
            <span className="text-lg md:text-xl">
              {String(time.minutes).padStart(2, "0")}
            </span>
            <span className="text-[9px] font-normal tracking-wider text-muted-foreground">
              MIN
            </span>
          </div>
          <span className="text-muted-foreground">:</span>
          <div className="flex flex-col items-center">
            <span className="text-lg md:text-xl text-orange-500">
              {String(time.seconds).padStart(2, "0")}
            </span>
            <span className="text-[9px] font-normal tracking-wider text-muted-foreground">
              SEC
            </span>
          </div>
        </div>
      </div>
      <div className="text-xs text-muted-foreground md:hidden" aria-live="polite">
        Starts in {time.days}d {time.hours}h
      </div>
    </>
  );
}

function renderSlide(slide: (typeof SLIDES)[number], totalCount: number) {
  switch (slide) {
    case "welcome":
      return <ClaudeWelcomeSlide />;
    case "why":
      return <ClaudeWhySlide totalCount={totalCount} />;
    case "audience":
      return <ClaudeAudienceSlide />;
    case "roadmap":
      return <ClaudeRoadmapSlide />;
    case "cta":
      return <ClaudeCtaSlide totalCount={totalCount} />;
    default:
      return null;
  }
}

export function ClaudeOnboardingClient() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [signups, setSignups] = useState<Signup[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    const fetchSignups = async () => {
      try {
        const res = await fetch("/api/claude-recent-signups");
        const data = await res.json();
        setSignups(data.signups ?? []);
        setTotalCount(data.totalCount ?? 0);
      } catch {
        // Silent fail — ticker won't render
      }
    };

    fetchSignups();
    const interval = setInterval(fetchSignups, 60_000);
    return () => clearInterval(interval);
  }, []);

  const scrollToTop = () => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  function next() {
    if (currentIndex < SLIDES.length - 1) {
      setIsTransitioning(true);
      setDirection("next");
      setCurrentIndex((i) => i + 1);
      scrollToTop();
      setTimeout(() => setIsTransitioning(false), TRANSITION_MS);
    }
  }

  function prev() {
    if (currentIndex > 0) {
      setIsTransitioning(true);
      setDirection("prev");
      setCurrentIndex((i) => i - 1);
      scrollToTop();
      setTimeout(() => setIsTransitioning(false), TRANSITION_MS);
    }
  }

  function goTo(index: number) {
    if (index === currentIndex) return;
    setIsTransitioning(true);
    setDirection(index > currentIndex ? "next" : "prev");
    setCurrentIndex(index);
    scrollToTop();
    setTimeout(() => setIsTransitioning(false), TRANSITION_MS);
  }

  const slide = SLIDES[currentIndex];
  const isLast = currentIndex === SLIDES.length - 1;

  return (
    <div className="relative min-h-svh overflow-hidden bg-gradient-to-br from-background via-background to-orange-500/5">
      <ClaudeBackgroundBlobs slideIndex={currentIndex} />

      <div className="relative z-10 flex min-h-svh flex-col">
        <header className="relative z-20 shrink-0 px-6 py-4">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Link href="/" aria-label="ABTalks home" className="logo-link">
                  <Image
                    src="/abtalks-logo.png"
                    alt="ABTalks"
                    width={300}
                    height={84}
                    priority
                    className="logo-image"
                  />
                </Link>
                <span className="rounded bg-orange-500/10 px-2 py-0.5 text-[10px] font-bold text-orange-600 dark:text-orange-400">
                  CLAUDE
                </span>
              </div>
              <CountdownDisplay />
            </div>
          </div>
        </header>

        <SignupTicker signups={signups} isPaused={isTransitioning} />

        <main className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6 py-4">
          <div className="w-full max-w-2xl">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={slide}
                custom={direction}
                variants={slideVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="max-h-full overflow-y-auto"
              >
                {renderSlide(slide, totalCount)}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>

        <footer className="shrink-0 border-t bg-background/50 px-6 py-4 backdrop-blur-sm">
          {isLast ? (
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={prev}
                  className="gap-2"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
                <ProgressDots
                  total={SLIDES.length}
                  current={currentIndex}
                  onSelect={goTo}
                />
                <div className="w-[88px]" aria-hidden />
              </div>
              <Link
                href={LOGIN_HREF}
                className={cn(
                  buttonVariants(),
                  "w-full justify-center gap-2 bg-gradient-to-r from-orange-500 via-pink-500 to-violet-500 text-white hover:opacity-90",
                )}
              >
                <Rocket className="h-4 w-4" />
                Reserve My Spot
              </Link>
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
              {currentIndex > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={prev}
                  className="gap-2"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
              ) : (
                <div className="w-[88px]" aria-hidden />
              )}

              <ProgressDots
                total={SLIDES.length}
                current={currentIndex}
                onSelect={goTo}
              />

              <Button
                type="button"
                onClick={next}
                className="gap-2 bg-gradient-to-r from-orange-500 to-pink-500 text-white hover:from-orange-600 hover:to-pink-600"
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

function ClaudeBackgroundBlobs({ slideIndex }: { slideIndex: number }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      <motion.div
        animate={{ x: slideIndex * 20, y: -slideIndex * 10 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="absolute -left-32 top-20 h-72 w-72 rounded-full bg-orange-500/20 blur-3xl"
      />
      <motion.div
        animate={{ x: -slideIndex * 30, y: slideIndex * 20 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="absolute -right-32 top-60 h-80 w-80 rounded-full bg-pink-500/15 blur-3xl"
      />
      <motion.div
        animate={{ x: slideIndex * 15, y: -slideIndex * 25 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="absolute bottom-20 left-1/3 h-64 w-64 rounded-full bg-violet-500/15 blur-3xl"
      />
    </div>
  );
}
