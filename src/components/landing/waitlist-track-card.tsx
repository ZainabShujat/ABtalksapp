"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { accentClasses, type TrackAccent } from "./track-card";

type WaitlistTrackCardProps = {
  accent: TrackAccent;
  title: string;
  blurb: string;
  pill: string;
  chips: string[];
  ctaLabel: string;
  isAuthenticated: boolean;
};

const CARD_CLASS =
  "group relative flex min-h-72 flex-col overflow-hidden rounded-3xl border bg-card/80 p-6 shadow-card backdrop-blur-md transition-all duration-1000 ease-out hover:-translate-y-1 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function WaitlistTrackCardBody({
  accent,
  title,
  blurb,
  pill,
  chips,
  ctaLabel,
}: Omit<WaitlistTrackCardProps, "isAuthenticated">) {
  const styles = accentClasses[accent];

  return (
    <>
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b to-transparent opacity-70",
          styles.glow,
        )}
        aria-hidden
      />

      <div className="relative flex items-start justify-between gap-3">
        <span
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-semibold",
            styles.pill,
          )}
        >
          {pill}
        </span>
        <ArrowUpRight className="h-5 w-5 text-muted-foreground transition-transform duration-1000 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>

      <h2 className="relative mt-8 font-display text-2xl font-bold tracking-tight text-foreground">
        {title}
      </h2>
      <p className="relative mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
        {blurb}
      </p>

      <div className="relative mt-5 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span
            key={chip}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium",
              styles.chip,
            )}
          >
            {chip}
          </span>
        ))}
      </div>

      <span
        className={cn(
          "relative mt-6 inline-flex h-12 items-center justify-center rounded-xl px-4 text-sm font-semibold shadow-sm",
          styles.cta,
        )}
      >
        {ctaLabel}
      </span>
    </>
  );
}

export function WaitlistTrackCard({
  isAuthenticated,
  ...body
}: WaitlistTrackCardProps) {
  const styles = accentClasses[body.accent];

  if (!isAuthenticated) {
    return (
      <Link href="/login?from=/" className={cn(CARD_CLASS, styles.border)}>
        <WaitlistTrackCardBody {...body} />
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={cn(CARD_CLASS, "w-full cursor-pointer text-left", styles.border)}
      onClick={() =>
        toast.success("You will be notified once the cohort starts.")
      }
    >
      <WaitlistTrackCardBody {...body} />
    </button>
  );
}
