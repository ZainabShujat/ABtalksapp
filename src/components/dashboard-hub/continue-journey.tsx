import Link from "next/link";
import type { Domain } from "@prisma/client";
import type { HubEnrollment } from "@/features/dashboard/get-hub-data";
import { dsButtonVariants } from "@/components/design/ds-button";
import { HUB_CARD_HOVER_CLASS } from "@/components/dashboard-hub/nav-items";
import { cn } from "@/lib/utils";

const TRACK_PATH: Record<Domain, string> = {
  AI: "/ai",
  DS: "/ds",
  SE: "/se",
  CLAUDE: "/claude",
};

const DOMAIN_LABEL: Record<Domain, string> = {
  AI: "Artificial Intelligence",
  DS: "Data Science",
  SE: "Software Engineering",
  CLAUDE: "Claude Challenge",
};

type ContinueJourneyProps = {
  enrollments: HubEnrollment[];
};

export function ContinueJourney({ enrollments }: ContinueJourneyProps) {
  return (
    <section className="scroll-mt-20 ml-4 px-4 py-8 sm:px-6">
      <h2 className=" font-heading text-xl font-semibold uppercase text-[#e05226]">
        Continue your journey
      </h2>

      {enrollments.length === 0 ? (
        <div
          className={cn(
            "mt-4 rounded-2xl border border-neutral-200 bg-white p-6 text-center",
            HUB_CARD_HOVER_CLASS,
          )}
        >
          <p className="text-[#555555]">
            You haven&apos;t started a challenge yet
          </p>
          <Link
            href="/challenges"
            className={cn(dsButtonVariants(), "mt-4 inline-flex")}
          >
            Browse challenges
          </Link>
        </div>
      ) : (
        <ul className="no-scrollbar mt-4 flex gap-4 overflow-x-auto pb-1 snap-x snap-mandatory">
          {enrollments.map((e) => {
            const isCompleted = e.status === "COMPLETED";
            const pct = isCompleted
              ? 100
              : Math.min(100, Math.round((e.daysCompleted / 60) * 100));
            const subtitle = isCompleted
              ? "Completed · 60 of 60"
              : `Day ${e.daysCompleted + 1} of 60 · ${e.currentStreak}-day streak`;
            return (
              <li
                key={e.id}
                className={cn(
                  "flex w-[min(100%,320px)] shrink-0 snap-start flex-col rounded-2xl border border-neutral-200 bg-white p-5 sm:w-[300px]",
                  HUB_CARD_HOVER_CLASS,
                )}
              >
                <div className="flex min-h-0 flex-1 flex-col gap-4">
                  <div className="min-w-0">
                    <p className="font-inter font-bold text-black">
                      {DOMAIN_LABEL[e.domain]}
                    </p>
                    <p className="mt-1 text-sm text-[#555555]">
                      {subtitle}
                    </p>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                    aria-label={`${DOMAIN_LABEL[e.domain]} progress`}
                    className="h-1.5 w-full overflow-hidden rounded-lg bg-neutral-100"
                  >
                    <div
                      className="h-full bg-[#e05226] transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <Link
                  href={TRACK_PATH[e.domain]}
                  className={cn(dsButtonVariants(), "mt-4 w-full justify-center")}
                >
                  {isCompleted ? "View" : "Continue"}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
