import Link from "next/link";
import type { Domain } from "@prisma/client";
import { isProgramEnabled } from "@/lib/feature-flags";
import { PROGRAM_AI_COHORT_BASE } from "@/features/program/constants";
import {
  HUB_CARD_CTA_CLASS,
  HUB_CARD_HOVER_CLASS,
} from "@/components/dashboard-hub/nav-items";
import { cn } from "@/lib/utils";

/** Prep Kit card: fixed width so the row scrolls horizontally instead of wrapping. */
const PREP_CARD_CLASS =
  "flex w-[272px] shrink-0 snap-start flex-col justify-between rounded-2xl border border-[#E0E0E0] bg-white p-5 sm:w-[300px] sm:p-6";

const ROADMAPS: { domain: Domain; label: string; path: string }[] = [
  { domain: "AI", label: "Artificial Intelligence", path: "/ai" },
  { domain: "DS", label: "Data Science", path: "/ds" },
  { domain: "SE", label: "Software Engineering", path: "/se" },
];

type RoadmapsProps = {
  joinedDomains: Domain[];
  abandonedDomains: Domain[];
  hasProgramMembership: boolean;
  showDatabricks?: boolean;
  showDsArchitect?: boolean;
  showPowerBi?: boolean;
  showSnowflake?: boolean;
  showDatabricksAi?: boolean;
  showLangchain?: boolean;
};

export function Roadmaps({
  joinedDomains,
  abandonedDomains,
  hasProgramMembership,
  showDatabricks = false,
  showDsArchitect = false,
  showPowerBi = false,
  showSnowflake = false,
  showDatabricksAi = false,
  showLangchain = false,
}: RoadmapsProps) {
  const joined = new Set(joinedDomains);
  const abandoned = new Set(abandonedDomains);
  const showProgramPrepKit = isProgramEnabled();

  return (
    <>
      <section
        id="domains"
        className="scroll-mt-20 px-4 py-8 sm:px-6 lg:ml-4"
      >
        <h2 className="font-heading text-xl font-semibold uppercase text-[#03535F] lg:ml-2">
          CHALLENGE TRACKS
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:max-w-[1240px]">
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
                  "flex flex-col justify-between rounded-2xl border border-[#E0E0E0] bg-white p-5",
                  HUB_CARD_HOVER_CLASS,
                )}
              >
                <div>
                  <p className="font-inter font-bold text-black">{label}</p>
                  <p className="mt-1 text-sm text-[#4B4B4B]">
                    60-day challenge track
                  </p>
                </div>
                <Link
                  href={href}
                  className={cn(HUB_CARD_CTA_CLASS, "mt-2 self-end")}
                >
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
          className="min-w-0 scroll-mt-20 px-4 py-2 sm:px-6 sm:py-4 lg:ml-4"
        >
          <h2 className="font-heading text-xl font-semibold uppercase text-[#03535F] lg:ml-2">
            Prep Kit
          </h2>
          {/* Horizontal scroller: fixed-width cards in one row, snap to each
              card, scrolls inside this row only (never the page). Vertical
              padding keeps the hover shadow from being clipped. */}
          <div
            role="region"
            aria-label="Prep Kit cohorts"
            tabIndex={0}
            className="-mx-1 mt-2 flex snap-x snap-mandatory scroll-px-1 gap-3 overflow-x-auto px-1 py-3 [scrollbar-width:thin] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#03535F]"
          >
            <div
              className={cn(
                PREP_CARD_CLASS,
                HUB_CARD_HOVER_CLASS,
              )}
            >
              <div className="min-w-0">
                <p className="font-inter text-lg font-bold text-black">
                  31 Days AI Cohort
                </p>
                <p className="mt-1 line-clamp-2 text-sm text-[#4B4B4B]">
                Build and deploy a production-grade enterprise AI chatbot in 31 days.
                </p>
              </div>
              <Link
                href={
                  hasProgramMembership
                    ? `${PROGRAM_AI_COHORT_BASE}/dashboard`
                    : `${PROGRAM_AI_COHORT_BASE}/apply`
                }
                className={cn(HUB_CARD_CTA_CLASS, "mt-2 self-end")}
              >
                {hasProgramMembership ? "Continue" : "Start Challenge"}
              </Link>
            </div>
            {showDatabricks ? (
              <div
                className={cn(
                  PREP_CARD_CLASS,
                  HUB_CARD_HOVER_CLASS,
                )}
              >
                <div className="min-w-0">
                  <p className="font-inter text-lg font-bold text-black">
                    31 Days Databricks
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-[#4B4B4B]">
                    Build a healthcare-claims Lakehouse on Databricks
                    in 31 days.
                  </p>
                </div>
                <Link
                  href="/program/databricks"
                  className={cn(HUB_CARD_CTA_CLASS, "mt-2 self-end")}
                >
                  Open
                </Link>
              </div>
            ) : null}
            {showDsArchitect ? (
              <div
                className={cn(
                  PREP_CARD_CLASS,
                  HUB_CARD_HOVER_CLASS,
                )}
              >
                <div className="min-w-0">
                  <p className="font-inter text-lg font-bold text-black">
                    10 Days Data Solutions Architect
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-[#4B4B4B]">
                    Design AWS-first data and AI platforms in 10 days.
                  </p>
                </div>
                <Link
                  href="/program/ds-architect"
                  className={cn(HUB_CARD_CTA_CLASS, "mt-2 self-end")}
                >
                  Open
                </Link>
              </div>
            ) : null}
            {showPowerBi ? (
              <div
                className={cn(
                  PREP_CARD_CLASS,
                  HUB_CARD_HOVER_CLASS,
                )}
              >
                <div className="min-w-0">
                  <p className="font-inter text-lg font-bold text-black">
                    7 Days Power BI &amp; Analytics
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-[#4B4B4B]">
                    Ship recruiter-grade Power BI dashboards in 7 days.
                  </p>
                </div>
                <Link
                  href="/program/powerbi"
                  className={cn(HUB_CARD_CTA_CLASS, "mt-2 self-end")}
                >
                  Open
                </Link>
              </div>
            ) : null}
            {showSnowflake ? (
              <div
                className={cn(
                  PREP_CARD_CLASS,
                  HUB_CARD_HOVER_CLASS,
                )}
              >
                <div className="min-w-0">
                  <p className="font-inter text-lg font-bold text-black">
                    15 Days Snowflake Data &amp; AI
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-[#4B4B4B]">
                    Build a governed Data + AI lakehouse on Snowflake in 15 days.
                  </p>
                </div>
                <Link
                  href="/program/snowflake"
                  className={cn(HUB_CARD_CTA_CLASS, "mt-2 self-end")}
                >
                  Open
                </Link>
              </div>
            ) : null}
            {showDatabricksAi ? (
              <div
                className={cn(
                  PREP_CARD_CLASS,
                  HUB_CARD_HOVER_CLASS,
                )}
              >
                <div className="min-w-0">
                  <p className="font-inter text-lg font-bold text-black">
                    15 Days Databricks Data &amp; AI
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-[#4B4B4B]">
                    Build a governed Data + AI lakehouse on Databricks in 15 days.
                  </p>
                </div>
                <Link
                  href="/program/databricks-ai"
                  className={cn(HUB_CARD_CTA_CLASS, "mt-2 self-end")}
                >
                  Open
                </Link>
              </div>
            ) : null}
            {showLangchain ? (
              <div
                className={cn(
                  PREP_CARD_CLASS,
                  HUB_CARD_HOVER_CLASS,
                )}
              >
                <div className="min-w-0">
                  <p className="font-inter text-lg font-bold text-black">
                    LangChain &amp; LangGraph Cohort
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-[#4B4B4B]">
                    Go from your first LLM call to a deployed LangGraph agent in 31 days.
                  </p>
                </div>
                <Link
                  href="/program/langchain"
                  className={cn(HUB_CARD_CTA_CLASS, "mt-2 self-end")}
                >
                  Open
                </Link>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
