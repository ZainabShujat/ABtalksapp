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
import { registrationRedirect } from "@/features/registration/registration-gate";
import { loadAvailableInterviews } from "@/features/dashboard/load-available-interviews";
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

  // Signed in is not registered: OAuth creates the User row before any form is
  // reached, and Google's callback lands here directly. Before the hub is even
  // queried, a candidate with no StudentProfile goes and makes one.
  const needsRegistration = await registrationRedirect(
    session.user.id,
    "/dashboard",
  );
  if (needsRegistration) redirect(needsRegistration);

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

  return (
    <DashboardShell user={shellUser} isAdmin={isAdmin}>
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
            className={`rounded-2xl border border-[#E0E0E0] bg-white px-5 py-4 text-sm text-[#4B4B4B] ${HUB_CARD_HOVER_CLASS}`}
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
