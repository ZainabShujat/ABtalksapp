"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Clock, Code2, Lock, Mic, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CatalogueEntry } from "@/features/interview/platform/service";

/**
 * The mock interview catalogue.
 *
 * Client component only because of the family filter — everything it renders
 * arrives as plain data from the Server Component, and it holds no interview
 * logic of any kind.
 *
 * Palette is the ABTalks interview palette, taken from
 * `components/program/cohort-interview-card.tsx` so the two interview surfaces
 * read as one product: #E05226 primary, #FFF5F0 card, #FFECE3 accent,
 * #1A7F37 available, #E0E0E0 border.
 */

const BTN =
  "inline-flex h-11 items-center justify-center rounded-[12px] bg-[#E05226] px-6 text-sm font-semibold text-white transition-colors duration-200 ease-out hover:bg-[#C9411C] focus-visible:ring-2 focus-visible:ring-[#E05226] focus-visible:ring-offset-2 focus-visible:outline-none";

const BADGE_AVAILABLE =
  "inline-flex items-center rounded-[4px] border border-[#1A7F37]/40 bg-[#1A7F37]/10 px-2.5 py-1 text-[11px] font-semibold text-[#1A7F37]";
const BADGE_SOON =
  "inline-flex items-center rounded-[4px] border border-[#E0E0E0] bg-[#F5F5F5] px-2.5 py-1 text-[11px] font-semibold text-[#8F8F8F]";
const BADGE_TAKEN =
  "inline-flex items-center gap-1 rounded-[4px] border border-[#E05226]/40 bg-[#FFECE3] px-2.5 py-1 text-[11px] font-semibold text-[#E05226]";

function minutes(seconds: number): string {
  return `${Math.round(seconds / 60)} min`;
}

/**
 * How the candidate answers, derived from the domain's declared capabilities.
 *
 * Read from `capabilities` rather than hard-coded per domain, so a coding
 * interview says "code editor" because it actually declares CODE_SANDBOX — the
 * label cannot drift from what the interview will really offer.
 */
function formatLabel(capabilities: string[]): string {
  if (capabilities.includes("CODE_SANDBOX")) return "Spoken + code editor";
  if (capabilities.includes("WHITEBOARD")) return "Spoken + whiteboard";
  return "Spoken";
}

function DomainCard({
  entry,
  signedIn,
}: {
  entry: CatalogueEntry;
  signedIn: boolean;
}) {
  const live = entry.status === "LIVE";

  return (
    <div
      className={cn(
        "group flex flex-col rounded-[16px] border p-5 transition-colors duration-200 ease-out",
        live
          ? "border-[#E0E0E0] bg-[#FFF5F0] hover:border-[#E05226]/40"
          : "border-[#E0E0E0] bg-white",
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-[6px] transition-colors duration-200",
            live
              ? "bg-[#FFECE3] text-[#E05226] group-hover:bg-[#FFDBC9]"
              : "bg-[#F5F5F5] text-[#8F8F8F]",
          )}
        >
          {live ? (
            <Sparkles className="size-4" strokeWidth={2.25} />
          ) : (
            <Lock className="size-3.5" strokeWidth={2.25} />
          )}
        </span>
        <span className={live ? BADGE_AVAILABLE : BADGE_SOON}>
          {live ? "Available" : "Coming soon"}
        </span>
      </div>

      <h3 className="text-[15px] font-semibold text-[#111111] md:text-base">
        {entry.label}
      </h3>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-[#4B4B4B]">
        {entry.blurb}
      </p>

      <dl className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-[#4B4B4B]">
        <div className="flex items-center gap-1.5">
          <Clock className="size-3.5 text-[#8F8F8F]" strokeWidth={2} />
          <dt className="sr-only">Duration</dt>
          <dd>{minutes(entry.durationSec)}</dd>
        </div>
        {entry.questionCount > 0 ? (
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Questions</dt>
            <dd>{entry.questionCount} questions</dd>
          </div>
        ) : null}
        <div className="flex items-center gap-1.5">
          {entry.capabilities.includes("CODE_SANDBOX") ? (
            <Code2 className="size-3.5 text-[#8F8F8F]" strokeWidth={2} />
          ) : (
            <Mic className="size-3.5 text-[#8F8F8F]" strokeWidth={2} />
          )}
          <dt className="sr-only">Format</dt>
          <dd>{formatLabel(entry.capabilities)}</dd>
        </div>
      </dl>

      {signedIn && entry.completedAttempts > 0 ? (
        <div className="mt-3">
          <span className={BADGE_TAKEN}>
            <Check className="size-3" strokeWidth={2.5} />
            Completed
          </span>
        </div>
      ) : null}

      <div className="mt-5">
        {live ? (
          <Link href={`/mock-interviews/${entry.slug}`} className={cn(BTN, "w-full")}>
            View interview &rarr;
          </Link>
        ) : (
          <span className="inline-flex h-11 w-full items-center justify-center rounded-[12px] border border-[#E0E0E0] bg-[#F5F5F5] px-6 text-sm font-semibold text-[#8F8F8F]">
            Not available yet
          </span>
        )}
      </div>
    </div>
  );
}

export function MockInterviewCatalog({
  entries,
  signedIn,
}: {
  entries: CatalogueEntry[];
  signedIn: boolean;
}) {
  const families = useMemo(
    () => ["All", ...new Set(entries.map((e) => e.family))],
    [entries],
  );
  const [family, setFamily] = useState("All");

  const shown = useMemo(
    () =>
      family === "All" ? entries : entries.filter((e) => e.family === family),
    [entries, family],
  );

  // Available first, then alphabetical — a catalogue that leads with six locked
  // cards reads as an empty product.
  const ordered = useMemo(
    () =>
      [...shown].sort((a, b) => {
        if (a.status !== b.status) return a.status === "LIVE" ? -1 : 1;
        return a.label.localeCompare(b.label);
      }),
    [shown],
  );

  const liveCount = entries.filter((e) => e.status === "LIVE").length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {families.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFamily(f)}
            aria-pressed={family === f}
            className={cn(
              "inline-flex h-9 items-center rounded-[10px] border px-4 text-[13px] font-medium transition-colors duration-200",
              family === f
                ? "border-[#E05226] bg-[#FFECE3] text-[#E05226]"
                : "border-[#E0E0E0] bg-white text-[#4B4B4B] hover:border-[#8F8F8F] hover:text-[#111111]",
            )}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto text-[13px] text-[#8F8F8F]">
          {liveCount} available &middot; {entries.length - liveCount} coming soon
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map((entry) => (
          <DomainCard key={entry.slug} entry={entry} signedIn={signedIn} />
        ))}
      </div>
    </>
  );
}
