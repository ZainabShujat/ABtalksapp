"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Briefcase, Compass, Gift, Home, User } from "lucide-react";
import { useSafeReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/dashboard", label: "Home", Icon: Home },
  { href: "/jobs", label: "Jobs", Icon: Briefcase },
  { href: "/marketplace", label: "Rewards", Icon: Gift },
  { href: "/explore", label: "Explore", Icon: Compass },
  { href: "/profile", label: "Profile", Icon: User },
] as const;

function isTabActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return (
      pathname === "/dashboard" || pathname.startsWith("/challenge/")
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

type IndicatorRect = { x: number; y: number; w: number; h: number };

export function BottomNav() {
  const pathname = usePathname();
  const reduceMotion = useSafeReducedMotion();

  const navRef = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [rect, setRect] = useState<IndicatorRect | null>(null);

  const activeIndex = tabs.findIndex((t) => isTabActive(pathname, t.href));
  const isMarketplace =
    pathname === "/marketplace" || pathname.startsWith("/marketplace/");

  // Measure the active tab relative to the nav so a single, always-mounted
  // indicator can slide between tabs. Never mount/unmount it (that's what made
  // it occasionally "pop in" instead of sliding).
  const measure = useCallback(() => {
    const nav = navRef.current;
    const el = activeIndex >= 0 ? tabRefs.current[activeIndex] : null;
    if (!nav || !el) {
      setRect(null);
      return;
    }
    const navBox = nav.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    if (box.width === 0) {
      // Nav is hidden (md breakpoint) — nothing to position.
      setRect(null);
      return;
    }
    setRect({
      x: box.left - navBox.left,
      y: box.top - navBox.top,
      w: box.width,
      h: box.height,
    });
  }, [activeIndex]);

  useEffect(() => {
    measure();
  }, [measure, pathname]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  if (
    pathname === "/" ||
    pathname === "/ai-workshop" ||
    pathname.startsWith("/ai-workshop/") ||
    pathname === "/hackathon" ||
    pathname.startsWith("/hackathon/") ||
    /^\/(login|register|claude-signup|students|r|program|talent|verify)(\/|$)/.test(
      pathname,
    )
  ) {
    return null;
  }

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] md:hidden",
        isMarketplace && "dark",
      )}
      aria-hidden={false}
    >
      <nav
        ref={navRef}
        aria-label="Main navigation"
        className="pointer-events-auto relative flex w-full max-w-md items-center justify-between gap-1 rounded-full border border-border/40 bg-card/70 px-2 py-1.5 shadow-lg shadow-black/10 backdrop-blur-xl dark:bg-card/60 dark:shadow-black/40"
      >
        {rect ? (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 rounded-full bg-primary/15"
            initial={false}
            animate={{ x: rect.x, y: rect.y, width: rect.w, height: rect.h }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 380, damping: 30 }
            }
          />
        ) : null}

        {tabs.map(({ href, label, Icon }, i) => {
          const active = i === activeIndex;
          return (
            <Link
              key={href}
              href={href}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              aria-current={active ? "page" : undefined}
              className={cn(
                "focus-spark relative z-10 flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-2 py-1.5 text-xs transition-colors",
                active
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="relative size-5" aria-hidden />
              <span className="relative text-[10px] font-medium leading-none">
                {label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
