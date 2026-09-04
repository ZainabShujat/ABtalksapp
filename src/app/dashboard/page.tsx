import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { DashboardShell } from "@/components/dashboard-hub/dashboard-shell";
import { HeroGreeting } from "@/components/dashboard-hub/hero-greeting";
import { StreakCard } from "@/components/dashboard-hub/streak-card";
import { ActivityHeatmap } from "@/components/dashboard-hub/activity-heatmap";
import { ContinueJourney } from "@/components/dashboard-hub/continue-journey";
import { MockInterviews } from "@/components/dashboard-hub/mock-interviews";
import { OtherChallenges } from "@/components/dashboard-hub/other-challenges";
import { Roadmaps } from "@/components/dashboard-hub/roadmaps";
import { EventsSection } from "@/components/dashboard-hub/events-section";
import { FaqSection } from "@/components/dashboard-hub/faq-section";
import { HUB_CARD_HOVER_CLASS } from "@/components/dashboard-hub/nav-items";
import { getHubData } from "@/features/dashboard/get-hub-data";
import { buildHubSearchIndex } from "@/features/dashboard/hub-search-index";
import { getHistory } from "@/features/interview/platform/service";
import {
  listLiveDomains,
  toDomainSummary,
} from "@/features/interview/platform/domains";
import { getCohortInterviewState } from "@/features/interview/cohort-eligibility";
import { resolveProgramMemberForUser } from "@/lib/program-auth";
import { toProgramMemberId } from "@/features/interview/provider";
import { isClaudeEnabled, isProgramEnabled } from "@/lib/feature-flags";
import type {
  AvailableCohortInterview,
  AvailableMockInterview,
} from "@/components/dashboard-hub/mock-interviews";
import { logger } from "@/lib/logger";
import { PROGRAM_AI_COHORT_BASE } from "@/features/program/constants";
import type { Domain } from "@prisma/client";

const TRACK_PATH: Record<Domain, string> = {
  AI: "/ai",
  DS: "/ds",
  SE: "/se",
  CLAUDE: "/claude",
};

const JOIN_ERROR_MESSAGE: Record<string, string> = {
  no_user: "Your session expired. Please sign in again.",
  no_challenge: "That track isn't open yet. Please try again later.",
  internal_error: "We couldn't add that track. Please try again.",
};

type PageProps = {
  searchParams: Promise<{ joinError?: string; joinBlocked?: string }>;
};

/** Copy for the two cohort milestones, matching the AI Cohort dashboard card. */
const COHORT_MILESTONES = [
  {
    key: "DAY_15",
    label: "Day 15 Checkpoint Interview",
    blurb: "Test what you've learned across Days 1–15.",
  },
  {
    key: "DAY_31",
    label: "Day 31 Final Interview",
    blurb: "Assess what you've learned across the full cohort.",
  },
] as const;

/**
 * Everything this user can open right now, across both interview systems.
 *
 * Kept here rather than in `getHubData` because it spans two subsystems the
 * hub data layer knows nothing about, and it must not be able to take the hub
 * down: the MockInterview tables exist on demo but the migration has not been
 * applied to production, so `getHistory` throws there until it is. Each half
 * degrades independently — a broken platform must not also hide an eligible
 * cohort interview.
 */
async function loadAvailableInterviews(userId: string): Promise<{
  mock: AvailableMockInterview[];
  cohort: AvailableCohortInterview[];
}> {
  // LIVE only: the catalogue page lists COMING_SOON domains because the roadmap
  // is part of what that page is for, but this section is an OFFER and must
  // contain nothing the candidate cannot open.
  //
  // One history read serves all three per-domain facts below, which is why this
  // does not call `getCatalogue`: that answers only the count, and the report
  // link would need a second pass over the same rows.
  const mock = await getHistory(userId)
    .then((r): AvailableMockInterview[] => {
      const history = r.ok ? r.data : [];
      return listLiveDomains().map((domain) => {
        const mine = history.filter((a) => a.domainSlug === domain.slug);
        const completedAttempts = mine.filter(
          (a) => a.status === "COMPLETED",
        ).length;
        const summary = toDomainSummary(domain);
        return {
          slug: summary.slug,
          label: summary.label,
          blurb: summary.blurb,
          durationSec: summary.durationSec,
          questionCount: summary.questionCount,
          completedAttempts,
          attemptsLeft:
            domain.maxAttempts === null
              ? null
              : Math.max(0, domain.maxAttempts - completedAttempts),
          // History is newest first, so the first hit is the latest report.
          latestReportAttemptId: mine.find((a) => a.hasReport)?.id ?? null,
        };
      });
    })
    .catch((e: unknown) => {
      logger.warn("[dashboard] mock interview history unavailable", {
        message: e instanceof Error ? e.message : String(e),
      });
      // The domains are static, so the offer survives a database failure --
      // only the per-candidate facts are lost.
      return listLiveDomains().map((domain) => {
        const summary = toDomainSummary(domain);
        return {
          slug: summary.slug,
          label: summary.label,
          blurb: summary.blurb,
          durationSec: summary.durationSec,
          questionCount: summary.questionCount,
          completedAttempts: 0,
          attemptsLeft: domain.maxAttempts,
          latestReportAttemptId: null,
        };
      });
    });

  const cohort = await (async (): Promise<AvailableCohortInterview[]> => {
    if (!isProgramEnabled()) return [];
    const membership = await resolveProgramMemberForUser(userId);
    if (!membership) return [];

    // `toProgramMemberId` strips the 078 `pe_pm_` prefix — the same conversion
    // the AI Cohort dashboard does. Without it the eligibility query matches
    // nothing and every milestone silently reads as locked.
    const state = await getCohortInterviewState(
      toProgramMemberId(membership.member.id),
    );
    return COHORT_MILESTONES.flatMap((m) => {
      const blueprint = state[m.key === "DAY_15" ? "day15" : "day31"];
      // A cohort interview is one-shot, so "can take" means unlocked and not
      // yet taken. A locked or completed milestone is not an offer.
      if (!blueprint.unlocked || blueprint.taken) return [];
      return [
        {
          key: m.key,
          label: m.label,
          blurb: m.blurb,
          href: `${PROGRAM_AI_COHORT_BASE}/cohort-interview/${m.key}`,
          inProgress: blueprint.inProgressId !== null,
        },
      ];
    });
  })().catch((e: unknown) => {
    logger.warn("[dashboard] cohort interview eligibility unavailable", {
      message: e instanceof Error ? e.message : String(e),
    });
    return [] as AvailableCohortInterview[];
  });

  return { mock, cohort };
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const params = await searchParams;
  const data = await getHubData(session.user.id);
  if (!data.hasUser) {
    redirect("/api/auth/signout?callbackUrl=/login");
  }

  const availableInterviews = await loadAvailableInterviews(session.user.id);

  const firstName =
    data.profile?.fullName.split(/\s+/)[0] ??
    session.user.name?.split(/\s+/)[0] ??
    null;
  const firstActive = data.enrollments.find((e) => e.status === "ACTIVE");
  const restartHref = firstActive
    ? TRACK_PATH[firstActive.domain]
    : "/challenges";
  const blockedDomain = params.joinBlocked?.trim().toUpperCase();
  const joinError = params.joinError?.trim();
  const notice =
    blockedDomain && ["AI", "DS", "SE", "CLAUDE"].includes(blockedDomain)
      ? `You were removed from the ${blockedDomain} track and can't re-join it.`
      : joinError
        ? JOIN_ERROR_MESSAGE[joinError] ?? null
        : null;

  const shellUser = {
    name: data.profile?.fullName ?? session.user.name ?? "",
    email: session.user.email ?? "",
    image: session.user.image ?? null,
  };
  const isAdmin = session.user.isAdmin ?? false;
  const searchItems = buildHubSearchIndex({
    enrollments: data.enrollments,
    joinedDomains: data.joinedDomains,
    abandonedDomains: data.abandonedDomains,
    hasProgramMembership: data.hasProgramMembership,
    hasDatabricksAccess: data.hasDatabricksAccess,
    hasDsArchitectAccess: data.hasDsArchitectAccess,
    hasPowerBiAccess: data.hasPowerBiAccess,
    isAdmin,
    claudeEnabled: isClaudeEnabled(),
    programEnabled: isProgramEnabled(),
    mock: availableInterviews.mock,
    cohort: availableInterviews.cohort,
  });

  return (
    <DashboardShell
      user={shellUser}
      isAdmin={isAdmin}
      searchItems={searchItems}
    >
      <section className="px-4 py-8 sm:px-6">
        <div className="w-full max-w-[1020px] lg:ml-5 2xl:mx-auto 2xl:max-w-[1600px]">
          <HeroGreeting firstName={firstName} />
          <div className="mt-4 grid min-w-0 gap-6 lg:grid-cols-[1fr_320px] lg:items-center lg:gap-8 2xl:grid-cols-[minmax(0,1fr)_minmax(320px,360px)]">
            <div className="min-w-0 lg:pr-6">
              <ActivityHeatmap
                cells={data.heatmap.cells}
                totalSubmissions={data.heatmap.totalSubmissionsInWindow}
                embedded
              />
            </div>
            <div className="mt-2 lg:mt-0 lg:pl-5">
              <StreakCard streak={data.streak} restartHref={restartHref} />
            </div>
          </div>
        </div>
      </section>

      {notice ? (
        <section className="px-4 py-2 sm:px-6 lg:ml-4">
          <div
            className={`rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-sm text-[#555555] ${HUB_CARD_HOVER_CLASS}`}
          >
            {notice}
          </div>
        </section>
      ) : null}

      <MockInterviews
        mock={availableInterviews.mock}
        cohort={availableInterviews.cohort}
      />

      <ContinueJourney enrollments={data.enrollments} />
      <OtherChallenges
        joinedDomains={data.joinedDomains}
        abandonedDomains={data.abandonedDomains}
      />
      <Roadmaps
        joinedDomains={data.joinedDomains}
        abandonedDomains={data.abandonedDomains}
        hasProgramMembership={data.hasProgramMembership}
        showDatabricks={data.hasDatabricksAccess}
        showDsArchitect={data.hasDsArchitectAccess}
        showPowerBi={data.hasPowerBiAccess}
      />
      <EventsSection />
      
      <FaqSection />
    </DashboardShell>
  );
}
