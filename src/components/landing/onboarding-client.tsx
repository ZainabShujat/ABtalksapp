"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Rocket } from "lucide-react";
import { WelcomeSlide } from "./slides/welcome-slide";
import { AboutSlide } from "./slides/about-slide";
import { RulesSlide } from "./slides/rules-slide";
import { CommunitySlide } from "./slides/community-slide";
import { CtaSlide } from "./slides/cta-slide";
import { ProgressDots } from "./progress-dots";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SLIDES = ["welcome", "about", "rules", "community", "cta"] as const;
type SlideKey = (typeof SLIDES)[number];

const slideVariants = {
  enter: (d: "next" | "prev") => ({
    opacity: 0,
    x: d === "next" ? 60 : -60,
    scale: 0.96,
  }),
  center: {
    opacity: 1,
    x: 0,
    scale: 1,
  },
  exit: (d: "next" | "prev") => ({
    opacity: 0,
    x: d === "next" ? -60 : 60,
    scale: 0.96,
  }),
};

function renderSlide(slide: SlideKey) {
  switch (slide) {
    case "welcome":
      return <WelcomeSlide />;
    case "about":
      return <AboutSlide />;
    case "rules":
      return <RulesSlide />;
    case "community":
      return <CommunitySlide />;
    case "cta":
      return <CtaSlide />;
    default:
      return null;
  }
}

function continueLabel(slide: SlideKey): string {
  return slide === "rules" ? "I Agree" : "Continue";
}

export function OnboardingClient() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev">("next");

  const scrollToTop = () => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const next = () => {
    if (currentIndex < SLIDES.length - 1) {
      setDirection("next");
      setCurrentIndex((i) => i + 1);
      scrollToTop();
    }
  };

  const prev = () => {
    if (currentIndex > 0) {
      setDirection("prev");
      setCurrentIndex((i) => i - 1);
      scrollToTop();
    }
  };

  const goTo = (index: number) => {
    setDirection(index > currentIndex ? "next" : "prev");
    setCurrentIndex(index);
    scrollToTop();
  };

  const slide: SlideKey = SLIDES[currentIndex];
  const isLast = currentIndex === SLIDES.length - 1;

  return (
    <div className="relative min-h-svh overflow-hidden bg-gradient-to-br from-background via-background to-primary/5">
      <BackgroundBlobs slideIndex={currentIndex} />

      <div className="relative z-10 flex min-h-svh flex-col">
        <header className="shrink-0 px-6 py-4">
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
        </header>

        <main className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6 py-4">
          <div className="w-full max-w-2xl">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={slide}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="max-h-full overflow-y-auto"
              >
                {renderSlide(slide)}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>

        <footer className="shrink-0 border-t bg-background/50 px-6 py-4 backdrop-blur-sm">
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

            {!isLast ? (
              <Button type="button" onClick={next} className="gap-2">
                {continueLabel(slide)}
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Link
                href="/login"
                className={cn(
                  buttonVariants(),
                  "gap-2 bg-gradient-to-r from-primary to-violet-500 text-primary-foreground hover:from-primary/90 hover:to-violet-500/90",
                )}
              >
                <Rocket className="h-4 w-4" />
                Begin Your Journey
              </Link>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

function BackgroundBlobs({ slideIndex }: { slideIndex: number }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      <motion.div
        animate={{
          x: slideIndex * 20,
          y: -slideIndex * 10,
        }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="absolute -left-32 top-20 h-72 w-72 rounded-full bg-primary/20 blur-3xl"
      />
      <motion.div
        animate={{
          x: -slideIndex * 30,
          y: slideIndex * 20,
        }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="absolute -right-32 top-60 h-80 w-80 rounded-full bg-violet-500/15 blur-3xl"
      />
      <motion.div
        animate={{
          x: slideIndex * 15,
          y: -slideIndex * 25,
        }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="absolute bottom-20 left-1/3 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl"
      />
    </div>
  );
}
