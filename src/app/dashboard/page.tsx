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
import { getHistory } from "@/features/interview/platform/service";
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

  if (!data.profile) {
    if (data.isHackathonRegistered) redirect("/hackathon/dashboard");
    if (data.hasProgramMembership) redirect(`${PROGRAM_AI_COHORT_BASE}/dashboard`);
    redirect("/register");
  }

  // Mock interviews are open to every registered user and belong to no track,
  // so this is read here rather than folded into `getHubData`, which is
  // challenge-shaped.
  //
  // The try/catch is not defensive habit: the MockInterview tables exist on
  // demo but the migration has NOT been applied to production, so this query
  // throws there until it is. The hub is the landing page for every signed-in
  // user and must not 500 because the interview platform is unavailable, so a
  // failure degrades to an empty list and the section renders its intro copy.
  const mockInterviews = await getHistory(session.user.id)
    .then((r) => (r.ok ? r.data : []))
    .catch((e: unknown) => {
      logger.warn("[dashboard] mock interview history unavailable", {
        message: e instanceof Error ? e.message : String(e),
      });
      return [];
    });

  const firstName = data.profile?.fullName.split(/\s+/)[0] ?? null;
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

  return (
    <DashboardShell
      user={shellUser}
      isAdmin={session.user.isAdmin ?? false}
    >
      <section className="px-4 py-8 sm:px-6">
        <div className="w-full max-w-[1020px] lg:ml-5 2xl:mx-auto 2xl:max-w-[1600px]">
          <HeroGreeting firstName={firstName} />
          <div className="mt-4 grid min-w-0 gap-6 lg:grid-cols-[1fr_320px] lg:items-center lg:gap-8 2xl:grid-cols-[minmax(0,1fr)_minmax(320px,360px)]">
            <div className="min-w-0 lg:pr-6">
              <ActivityHeatmap cells={data.heatmap.cells} embedded />
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

      <MockInterviews attempts={mockInterviews} />

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
      />
      <EventsSection />
      
      <FaqSection />
    </DashboardShell>
  );
}
