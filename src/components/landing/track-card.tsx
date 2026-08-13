import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type TrackAccent = "violet" | "indigo" | "orange" | "amber";

type TrackCardProps = {
  accent: TrackAccent;
  title: string;
  blurb: string;
  pill: string;
  chips: string[];
  href: string;
  ctaLabel: string;
};

export const accentClasses = {
  violet: {
    border: "border-violet-500/25 hover:border-violet-500/50",
    glow: "from-violet-500/20",
    pill: "border-violet-500/30 bg-violet-500/10 text-violet-600",
    chip: "bg-violet-500/10 text-violet-700",
    cta: "bg-gradient-to-r from-violet-500 to-indigo-500 text-white",
  },
  indigo: {
    border: "border-indigo-500/25 hover:border-indigo-500/50",
    glow: "from-indigo-500/20",
    pill: "border-indigo-500/30 bg-indigo-500/10 text-indigo-600",
    chip: "bg-indigo-500/10 text-indigo-700",
    cta: "bg-gradient-to-r from-indigo-500 to-indigo-600 text-white",
  },
  orange: {
    border: "border-orange-500/25 hover:border-orange-500/50",
    glow: "from-orange-500/20",
    pill: "border-orange-500/30 bg-orange-500/10 text-orange-600",
    chip: "bg-orange-500/10 text-orange-700",
    cta: "bg-gradient-to-r from-orange-500 to-pink-500 text-white",
  },
  amber: {
    border: "border-amber-500/25 hover:border-amber-500/50",
    glow: "from-amber-500/20",
    pill: "border-amber-500/30 bg-amber-500/10 text-amber-700",
    chip: "bg-amber-500/10 text-amber-800",
    cta: "bg-gradient-to-r from-amber-500 to-orange-500 text-white",
  },
} as const;

export function TrackCard({
  accent,
  title,
  blurb,
  pill,
  chips,
  href,
  ctaLabel,
}: TrackCardProps) {
  const styles = accentClasses[accent];

  return (
    <Link
      href={href}
      className={cn(
        "group relative flex min-h-72 flex-col overflow-hidden rounded-3xl border bg-card/80 p-6 shadow-card backdrop-blur-md transition-all duration-1000 ease-out hover:-translate-y-1 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        styles.border,
      )}
    >
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
            "rounded-none border px-3 py-1 text-xs font-semibold",
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
              "rounded-none px-3 py-1 text-xs font-medium",
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
    </Link>
  );
}
