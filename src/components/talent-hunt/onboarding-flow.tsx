"use client";

import { Children, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Rocket } from "lucide-react";
import { ProgressDots } from "@/components/landing/progress-dots";
import { Button, buttonVariants } from "@/components/ui/button";
import { COHORT_REGISTER_ONBOARDING_KEY } from "@/components/talent-hunt/constants";
import { cn } from "@/lib/utils";

const DEFAULT_BASE_PATH = "/ai-cohort-register";

const slideVariants = {
  enter: (d: "next" | "prev") => ({
    opacity: 0,
    x: d === "next" ? 48 : -48,
  }),
  center: {
    opacity: 1,
    x: 0,
  },
  exit: (d: "next" | "prev") => ({
    opacity: 0,
    x: d === "next" ? -48 : 48,
  }),
};

type Props = {
  children: ReactNode;
  basePath?: string;
  storageKey?: string;
};

export function CohortRegisterOnboardingFlow({
  children,
  basePath = DEFAULT_BASE_PATH,
  storageKey = COHORT_REGISTER_ONBOARDING_KEY,
}: Props) {
  const router = useRouter();
  const slides = Children.toArray(children);
  const total = slides.length;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev">("next");

  const isFirst = currentIndex === 0;
  const isLast = currentIndex === total - 1;

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function next() {
    if (currentIndex < total - 1) {
      setDirection("next");
      setCurrentIndex((i) => i + 1);
      scrollToTop();
    }
  }

  function prev() {
    if (currentIndex > 0) {
      setDirection("prev");
      setCurrentIndex((i) => i - 1);
      scrollToTop();
    }
  }

  function goTo(index: number) {
    setDirection(index > currentIndex ? "next" : "prev");
    setCurrentIndex(index);
    scrollToTop();
  }

  function handleGetStarted() {
    sessionStorage.setItem(storageKey, "1");
    router.push(`${basePath}/apply`);
  }

  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-gradient-to-br from-background via-background to-primary/5">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 top-20 h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="absolute -right-32 top-60 h-80 w-80 rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      <header className="relative z-10 shrink-0 px-6 py-4">
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
        <p className="mt-1 text-sm text-muted-foreground">
          AI Cohort Training Program
        </p>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 flex-col px-4 py-2 sm:px-6">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentIndex}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-y-auto"
          >
            {slides[currentIndex]}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="relative z-10 shrink-0 border-t bg-background/60 px-4 py-4 backdrop-blur-sm sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          {!isFirst ? (
            <Button
              type="button"
              variant="ghost"
              onClick={prev}
              className="gap-2"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </Button>
          ) : (
            <div className="w-[72px]" aria-hidden />
          )}

          <ProgressDots
            total={total}
            current={currentIndex}
            onSelect={goTo}
          />

          {!isLast ? (
            <Button type="button" onClick={next} className="gap-2">
              Next
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          ) : (
            <button
              type="button"
              onClick={handleGetStarted}
              className={cn(
                buttonVariants({ size: "lg" }),
                "gap-2 bg-gradient-to-r from-primary to-violet-500 px-6 text-primary-foreground hover:from-primary/90 hover:to-violet-500/90",
              )}
            >
              <Rocket className="size-4" aria-hidden />
              Get Started
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
