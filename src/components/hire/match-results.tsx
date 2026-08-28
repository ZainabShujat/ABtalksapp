"use client";

import { useEffect, useState } from "react";
import { rememberEvidence } from "@/components/hire/evidence-cache";
import Link from "next/link";
import { ArrowRight, ShoppingCart } from "lucide-react";
import { MatchCard, type MatchCardData } from "@/components/hire/match-card";
import { DeskMatchCard } from "@/components/hire/desk-match-card";
import type { SampleDemand } from "@/components/hire/sample-card-notice";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Show the best match, then the rest on request.
 *
 * A wall of near-identical cards makes a recruiter skim and leave; leading with
 * one and asking whether they want more is the difference between reading a
 * result and scrolling past it.
 */
const INITIAL_VISIBLE = 1;

export function MatchResults({
  matches,
  cartCount,
  viewAllHref,
  samples,
  sampleDemand,
  desk = false,
  onOpen,
  selectedRef,
}: {
  matches: MatchCardData[];
  /**
   * Server-rendered, and correct after every toggle because the shortlist
   * action revalidates the /hire layout. A local delta on top of it counted
   * each change twice once that revalidation started working.
   */
  cartCount: number;
  /**
   * When set, only the leading card is shown and the rest live on that page.
   * Omit it to render the whole list — which is what that page then does.
   */
  viewAllHref?: string;
  /**
   * Illustrative cards for an empty search. Rendered only when there are no
   * real matches, in a separate list, so they can never read as results.
   */
  samples?: MatchCardData[];
  sampleDemand?: SampleDemand;
  desk?: boolean;
  onOpen?: (match: MatchCardData) => void;
  selectedRef?: string;
}) {
  // Seeded from the server once, then owned here. Reading it from the prop on
  // every render double-counted: the toggle moved it, and the refresh that
  // followed moved it again.
  const [count, setCount] = useState(cartCount);
  useEffect(() => {
    rememberEvidence(matches);
  }, [matches]);
  const visible = viewAllHref ? matches.slice(0, INITIAL_VISIBLE) : matches;
  const hidden = matches.length - visible.length;
  const showSamples = matches.length === 0 && (samples?.length ?? 0) > 0;

  return (
    <div className={desk ? "scout-results" : "space-y-4"}>
      {showSamples && (
        <div className="space-y-3">
          <h3 className={desk ? "scout-results__h" : "font-display text-lg font-semibold"}>
            What a match would look like
          </h3>
          <ul className={desk ? "scout-results" : "space-y-4"}>
            {samples!.map((m) => (
              <li key={m.candidateRef}>
                {desk ? (
                  <DeskMatchCard
                    match={m}
                    selected={selectedRef === m.candidateRef}
                    onOpen={() => onOpen?.(m)}
                    sampleDemand={sampleDemand}
                  />
                ) : (
                  <MatchCard
                    match={m}
                    variant="sample"
                    sampleDemand={sampleDemand}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {visible.length > 0 && (
        <ul className={desk ? "scout-results" : "space-y-4"}>
          {visible.map((m, i) => (
            <li key={m.candidateRef}>
              {desk ? (
                <DeskMatchCard
                  match={m}
                  rank={i + 1}
                  selected={selectedRef === m.candidateRef}
                  onOpen={() => onOpen?.(m)}
                  onCartToggle={(inCart) =>
                    setCount((c) => Math.max(0, c + (inCart ? 1 : -1)))
                  }
                />
              ) : (
                <MatchCard
                  match={m}
                  rank={i + 1}
                  onCartToggle={(inCart) =>
                    setCount((c) => Math.max(0, c + (inCart ? 1 : -1)))
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {viewAllHref && hidden > 0 && (
        <Link
          href={viewAllHref}
          className={cn(
            "flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed",
            "bg-card/50 py-3 text-sm font-medium shadow-card transition-all duration-300",
            "hover:border-primary/45 hover:bg-card hover:shadow-card-hover",
          )}
        >
          View {hidden} more
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      )}

      {/* Desk chrome already has the Shortlist bar. Don't duplicate it. */}
      {!desk && count > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-3">
          <p className="text-sm">
            <span className="font-semibold">{count}</span>{" "}
            {count === 1 ? "candidate" : "candidates"} in your cart — send
            one request for all of them.
          </p>
          <Link
            href="/talent/shortlist"
            className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}
          >
            <ShoppingCart className="size-3.5" aria-hidden="true" />
            Review &amp; request
          </Link>
        </div>
      )}
    </div>
  );
}
