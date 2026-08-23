import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { DashboardShell } from "@/components/dashboard-hub/dashboard-shell";
import { HeroGreeting } from "@/components/dashboard-hub/hero-greeting";
import { StreakCard } from "@/components/dashboard-hub/streak-card";
import { ActivityHeatmap } from "@/components/dashboard-hub/activity-heatmap";
import { ContinueJourney } from "@/components/dashboard-hub/continue-journey";
import { OtherChallenges } from "@/components/dashboard-hub/other-challenges";
import { Roadmaps } from "@/components/dashboard-hub/roadmaps";
import { EventsSection } from "@/components/dashboard-hub/events-section";
import { FaqSection } from "@/components/dashboard-hub/faq-section";
import { HUB_CARD_HOVER_CLASS } from "@/components/dashboard-hub/nav-items";
import { getHubData } from "@/features/dashboard/get-hub-data";

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

  const firstName = data.profile?.fullName.split(/\s+/)[0] ?? null;
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
        <div className="ml-5 max-w-[1020px]">
          <HeroGreeting firstName={firstName} />
          <div className="mt-4 grid min-w-0 gap-6 lg:grid-cols-[1fr_320px] lg:items-center lg:gap-8">
            <div className="min-w-0 lg:pr-6">
              <ActivityHeatmap cells={data.heatmap.cells} embedded />
            </div>
            <div className="mt-2 lg:mt-0 lg:pl-5">
              <StreakCard
                streak={data.streak}
                weekTicks={data.heatmap.weekTicks}
                totalActiveDays={data.heatmap.totalActiveDays}
              />
            </div>
          </div>
        </div>
      </section>

      {notice ? (
        <section className="ml-4 px-4 py-2 sm:px-6">
          <div
            className={`rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-sm text-[#555555] ${HUB_CARD_HOVER_CLASS}`}
          >
            {notice}
          </div>
        </section>
      ) : null}

      <ContinueJourney enrollments={data.enrollments} />
      <OtherChallenges
        joinedDomains={data.joinedDomains}
        abandonedDomains={data.abandonedDomains}
      />
      <Roadmaps
        joinedDomains={data.joinedDomains}
        abandonedDomains={data.abandonedDomains}
        hasProgramMembership={data.hasProgramMembership}
      />
      <EventsSection />
      
      <FaqSection />
    </DashboardShell>
  );
}
