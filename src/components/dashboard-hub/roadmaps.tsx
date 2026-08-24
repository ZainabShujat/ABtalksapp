import Link from "next/link";
import type { Domain } from "@prisma/client";
import { isProgramEnabled } from "@/lib/feature-flags";
import {
  HUB_BUTTON_CLASS,
  HUB_CARD_HOVER_CLASS,
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
      <section
        id="domains"
        className="scroll-mt-20 px-4 py-8 sm:px-6 lg:ml-4 2xl:mx-auto 2xl:max-w-[1600px]"
      >
        <h2 className="font-heading text-xl font-semibold uppercase text-[#e05226] lg:ml-2">
          CHALLENGE TRACKS
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3 2xl:grid-cols-[repeat(3,minmax(0,1fr))]">
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
                <Link href={href} className={cn(HUB_BUTTON_CLASS, "mt-4 w-full")}>
                  {ctaLabel}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {showProgramPrepKit ? (
        <section
          id="prep-kit"
          className="scroll-mt-20 px-4 py-2 sm:px-6 sm:py-4 lg:ml-4"
        >
          <h2 className="font-heading text-xl font-semibold uppercase text-[#e05226] lg:ml-2">
            Prep Kit
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
                Build and deploy a production-grade enterprise AI chatbot in 31 days.
                </p>
              </div>
              <Link
                href={hasProgramMembership ? "/program/dashboard" : "/program/apply"}
                className={cn(HUB_BUTTON_CLASS, "shrink-0")}
              >
                {hasProgramMembership ? "Continue" : "Start Challenge"}
              </Link>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
