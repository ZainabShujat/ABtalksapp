import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Domain } from "@prisma/client";
import { isProgramEnabled } from "@/lib/feature-flags";
import { dsButtonVariants } from "@/components/design/ds-button";
import {
  HUB_ARROW_HOVER_CLASS,
  HUB_CARD_HOVER_CLASS,
  HUB_TEXT_LINK_CLASS,
} from "@/components/dashboard-hub/nav-items";
import { cn } from "@/lib/utils";

const ROADMAPS: { domain: Domain; label: string; path: string }[] = [
  { domain: "AI", label: "Artificial Intelligence", path: "/ai" },
  { domain: "DS", label: "Data Science", path: "/ds" },
  { domain: "SE", label: "Software Engineering", path: "/se" },
];

type RoadmapsProps = {
  joinedDomains: Domain[];
  abandonedDomains: Domain[];
  hasProgramMembership: boolean;
};

export function Roadmaps({
  joinedDomains,
  abandonedDomains,
  hasProgramMembership,
}: RoadmapsProps) {
  const joined = new Set(joinedDomains);
  const abandoned = new Set(abandonedDomains);
  const showProgramPrepKit = isProgramEnabled();

  return (
    <>
      <section className="scroll-mt-20 ml-4 px-4 py-8 sm:px-6">
        <h2 className="ml-2 font-heading text-xl font-semibold uppercase text-[#e05226]">
          CHALLENGE TRACKS
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {ROADMAPS.map(({ domain, label, path }) => {
            const isJoined = joined.has(domain);
            const isAbandoned = abandoned.has(domain);
            const href = isJoined
              ? path
              : isAbandoned
                ? path
                : `/register?domain=${domain}`;
            const ctaLabel = isJoined
              ? "Continue"
              : isAbandoned
                ? "View status"
                : "Join";
            return (
              <li
                key={domain}
                className={cn(
                  "flex flex-col rounded-2xl border border-neutral-200 bg-white p-5",
                  HUB_CARD_HOVER_CLASS,
                )}
              >
                <p className="font-heading font-semibold text-black">{label}</p>
                <p className="mt-1 flex-1 text-sm text-[#555555]">
                  60-day challenge track
                </p>
                <Link href={href} className={cn(HUB_TEXT_LINK_CLASS, "mt-4")}>
                  {ctaLabel}
                  <ArrowRight className={HUB_ARROW_HOVER_CLASS} aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {showProgramPrepKit ? (
        <section className="ml-4 px-4 py-2 sm:px-6 sm:py-4">
          <h2 className="ml-2 font-heading text-xl font-semibold uppercase text-[#e05226]">
            AI Prep Kit
          </h2>
          <div
            className={cn(
              "mt-4 rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6",
              HUB_CARD_HOVER_CLASS,
            )}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-heading text-lg font-semibold text-black">
                  31 Days AI Cohort
                </p>
                <p className="mt-1 text-sm text-[#555555]">
                  Live cohort roadmap, projects, and guided prep for working
                  professionals.
                </p>
              </div>
              <Link
                href={hasProgramMembership ? "/program/dashboard" : "/program"}
                className={cn(dsButtonVariants(), "shrink-0")}
              >
                {hasProgramMembership ? "Continue" : "Start"}
              </Link>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
