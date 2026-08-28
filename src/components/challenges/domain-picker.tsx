"use client";

import Link from "next/link";
import { useState } from "react";
import {
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Code2,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DomainValue = "SE" | "DS" | "AI";

const DOMAINS: {
  value: DomainValue;
  label: string;
  blurb: string;
}[] = [
  {
    value: "SE",
    label: "Software Engineering",
    blurb: "Build apps, APIs, and production-ready systems.",
  },
  {
    value: "DS",
    label: "Data Science",
    blurb: "Turn raw data into useful analysis and insight.",
  },
  {
    value: "AI",
    label: "Artificial Intelligence",
    blurb: "Create practical AI workflows and applications.",
  },
];

const domainStyles = {
  SE: {
    icon: Code2,
    selected: "border-domains-se bg-domains-se/10",
    iconBox: "bg-domains-se/10 text-domains-se",
  },
  DS: {
    icon: BarChart3,
    selected: "border-domains-ds bg-domains-ds/10",
    iconBox: "bg-domains-ds/10 text-domains-ds",
  },
  AI: {
    icon: BrainCircuit,
    selected: "border-domains-ai bg-domains-ai/10",
    iconBox: "bg-domains-ai/10 text-domains-ai",
  },
} as const;

export function DomainPicker() {
  const [selected, setSelected] = useState<DomainValue>("SE");
  const registrationHref = `/register?domain=${selected}`;

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {DOMAINS.map((domain) => {
          const styles = domainStyles[domain.value];
          const Icon = styles.icon;
          const isSelected = selected === domain.value;

          return (
            <button
              key={domain.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelected(domain.value)}
              className={cn(
                "relative flex min-h-32 items-start gap-3 rounded-2xl border bg-card/70 p-4 text-left transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected ? styles.selected : "border-border/60",
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                  styles.iconBox,
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span>
                <span className="block font-display text-sm font-bold text-foreground">
                  {domain.label}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {domain.blurb}
                </span>
              </span>
              {isSelected ? (
                <CheckCircle2 className="absolute right-3 top-3 h-4 w-4 text-primary" />
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
        Selected:{" "}
        <span className="font-medium text-foreground">
          {DOMAINS.find((domain) => domain.value === selected)?.label}
        </span>
        . You can change it during registration.
      </p>
      <Link
        href={registrationHref}
        className={cn(
          buttonVariants({ size: "lg" }),
          "mt-6 h-12 rounded-xl bg-[#E05226] px-6 text-primary-foreground hover:bg-[#C9411C]",
        )}
      >
        Start the challenge
      </Link>

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-background/90 p-3 backdrop-blur-md md:hidden">
        <Link
          href={registrationHref}
          className={cn(
            buttonVariants({ size: "lg" }),
            "mx-auto flex h-12 w-full max-w-lg rounded-xl bg-[#E05226] text-primary-foreground",
          )}
        >
          Start the challenge
        </Link>
      </div>
    </div>
  );
}
