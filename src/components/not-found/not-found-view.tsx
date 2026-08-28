"use client";

import { useEffect } from "react";
import Link from "next/link";
import localFont from "next/font/local";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

const orbitron = localFont({
  src: [
    {
      path: "../../fonts/orbitron/orbitron-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../fonts/orbitron/orbitron-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  display: "swap",
});

type KeycapConfig = {
  href: string;
  label: string;
  stem: string;
  faceClassName: string;
  heightClassName: string;
};

const KEYCAPS: KeycapConfig[] = [
  {
    href: "/challenges",
    label: "60-DAY CHALLENGE",
    stem: "bg-[#276eb4]",
    faceClassName:
      "bg-gradient-to-b from-[#d7e6f5] to-[#5fa3e8] text-[#2c4970]",
    heightClassName: "h-[88px] md:h-[110px]",
  },
  {
    href: "/program",
    label: "AI COHORT",
    stem: "bg-[#2b7851]",
    faceClassName:
      "bg-gradient-to-b from-[#d8f0e4] to-[#61d068] text-[#2c5a3e]",
    heightClassName: "h-[88px] md:h-[110px]",
  },
  {
    href: "/claude-signup",
    label: "CLAUDE CHALLENGE",
    stem: "bg-[#c4682f]",
    faceClassName:
      "bg-gradient-to-b from-[#f4d8c7] to-[#d38251] text-[#6d4026]",
    heightClassName: "h-[88px] md:h-[110px]",
  },
  {
    href: "/ai-workshop",
    label: "Workshops",
    stem: "bg-[#633092]",
    faceClassName:
      "bg-gradient-to-b from-[#e7d8f5] to-[#935cc7] text-[#503577] uppercase",
    heightClassName: "h-[88px] md:h-[110px]",
  },
];

const HOMEPAGE_KEY: KeycapConfig = {
  href: "/",
  label: "HOMEPAGE",
  stem: "bg-[#a0846a]",
  faceClassName:
    "bg-[linear-gradient(180deg,#f2e1d1_1.58%,#d6a97f_112.91%)] text-[#4c4336]",
  heightClassName: "h-[72px] md:h-[90px]",
};

function Keycap({
  config,
  reduceMotion,
}: {
  config: KeycapConfig;
  reduceMotion: boolean | null;
}) {
  return (
    <motion.div
      className={cn(
        "relative flex min-w-0 flex-1 flex-col rounded-[28px] md:rounded-[32px]",
        "shadow-[0px_10px_11px_rgba(0,0,0,0.07)]",
        config.heightClassName,
        "pb-[10px]",
        config.stem,
      )}
      initial={{ scale: 1, y: 0 }}
      animate={{ scale: 1, y: 0 }}
      transition={{ duration: 0.08, ease: "easeOut" }}
      whileHover={
        reduceMotion
          ? undefined
          : {
              scale: 0.97,
              y: 4,
              transition: { duration: 0.08, ease: "easeOut" },
            }
      }
      whileTap={
        reduceMotion
          ? undefined
          : {
              scale: 0.95,
              y: 5,
              transition: { duration: 0.05, ease: "easeOut" },
            }
      }
    >
      <Link
        href={config.href}
        className={cn(
          "relative z-10 flex h-full w-full flex-col items-center justify-center",
          "rounded-[24px] border border-white/80 px-3 py-2 md:rounded-[28px] md:px-4",
          config.faceClassName,
        )}
      >
        <span
          className={cn(
            orbitron.className,
            "text-center text-xs font-bold leading-[1.2] md:text-xl",
          )}
        >
          {config.label}
        </span>
      </Link>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0px_-6px_14px_0px_rgba(255,255,255,0.8)]"
      />
    </motion.div>
  );
}

export function NotFoundView() {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    document.body.classList.add("not-found-page");
    return () => document.body.classList.remove("not-found-page");
  }, []);

  return (
    <div className="flex min-h-screen min-h-dvh items-center justify-center bg-gradient-to-b from-white to-[#efefef] px-4 py-8 md:px-10 md:py-12">
      <div className="flex w-full max-w-[1200px] flex-col items-center gap-10 md:flex-row md:gap-16 lg:gap-20">
        <div className="flex w-full flex-1 flex-col items-start gap-6 md:gap-8">
          <div
            className={cn(
              orbitron.className,
              "flex flex-wrap items-center gap-2 text-[#111827] md:gap-4",
            )}
            aria-hidden
          >
            <span className="text-7xl tracking-[-0.04em] md:text-[140px] md:tracking-[-5.6px]">
              4
            </span>
            <span className="flex gap-1 text-6xl md:text-[130px]">
              <span>{"{"}</span>
              <span>{"}"}</span>
            </span>
            <span className="text-7xl tracking-[-0.04em] md:text-[140px] md:tracking-[-5.6px]">
              4
            </span>
          </div>

          <div className="flex w-full flex-col gap-4">
            <h1 className="font-display text-3xl font-extrabold leading-[1.2] text-[#111827] md:text-[44px]">
              Oops! Page not found.
            </h1>
            <p className="max-w-xl text-base font-medium leading-[1.6] text-[#6b7280] md:text-lg">
              Looks like you&apos;ve taken a wrong turn. The page you requested
              could not be found. Please try again later or reach out to{" "}
              <a
                href="mailto:team@abtalks.in"
                className="text-[#276eb4] underline-offset-2 hover:underline"
              >
                team@abtalks.in
              </a>
            </p>
          </div>
        </div>

        <div className="flex w-full flex-1 items-center justify-center">
          <div className="origin-center scale-[0.85] sm:scale-95 md:rotate-[8deg] md:skew-x-[-2deg] md:scale-100">
            <div
              className={cn(
                "flex w-[min(100%,547px)] flex-col rounded-[40px] border-2 border-[#f1e6de] bg-[#f7efe9] pb-[14px] md:rounded-[56px] md:pb-[18px]",
                "shadow-[0px_22px_24px_rgba(0,0,0,0.06),0px_10px_12px_rgba(0,0,0,0.07)]",
              )}
            >
              <div className="flex w-full flex-col gap-4 rounded-[36px] border-2 border-[#f1e6de] bg-[#fdf8f3] px-5 py-6 md:gap-5 md:rounded-[52px] md:px-8 md:pb-10 md:pt-8">
                <div className="flex gap-4 md:gap-5">
                  <Keycap config={KEYCAPS[0]!} reduceMotion={reduceMotion} />
                  <Keycap config={KEYCAPS[1]!} reduceMotion={reduceMotion} />
                </div>
                <div className="flex gap-4 md:gap-5">
                  <Keycap config={KEYCAPS[2]!} reduceMotion={reduceMotion} />
                  <Keycap config={KEYCAPS[3]!} reduceMotion={reduceMotion} />
                </div>
                <div className="flex">
                  <Keycap config={HOMEPAGE_KEY} reduceMotion={reduceMotion} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
