import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { HACKATHON } from "@/components/hackathon/hackathon-config";
import { ComingSoonCard } from "@/components/hackathon/dashboard/coming-soon-card";
import { EventInfo } from "@/components/hackathon/dashboard/event-info";
import { InvitePanel } from "@/components/hackathon/dashboard/invite-panel";
import { MissionTimer } from "@/components/hackathon/dashboard/mission-timer";
import { ProblemStatementPanel } from "@/components/hackathon/dashboard/problem-statement-panel";
import { SponsorPanel } from "@/components/hackathon/dashboard/sponsor-panel";
import { SubmissionChecklist } from "@/components/hackathon/dashboard/submission-checklist";
import { TeamRoster } from "@/components/hackathon/dashboard/team-roster";
import { VICODATHON_WINNERS } from "@/components/hackathon/dashboard/vicodathon-winners";
import { WinnerCard } from "@/components/hackathon/dashboard/winner-card";
import { buttonVariants } from "@/components/ui/button";
import { getMyRegistration } from "@/features/hackathon/get-my-registration";
import { getSubmissionWindow } from "@/features/hackathon/submission-window";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Your Dashboard | ABTalks Vibe Code Hackathon",
};

/** Flip to `true` to restore the live event dashboard UI. */
const SHOW_LIVE_DASHBOARD = false;

export default async function HackathonDashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?from=/hackathon/dashboard");
  }

  if (!SHOW_LIVE_DASHBOARD) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 pb-28 md:pb-10">
        <div className="space-y-6">
          <ComingSoonCard />
          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#A78BFA]">
              Vicodathon Winners
            </h2>
            <div className="space-y-4">
              {VICODATHON_WINNERS.map((place) => (
                <WinnerCard key={place.place} place={place} />
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  }

  const reg = await getMyRegistration(session.user.id);
  if (!reg) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 pb-28 md:pb-10">
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Registration is closed
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            Thanks for your interest. Registration for this hackathon has
            closed. Follow ABTalks for the next event.
          </p>
          <a
            href="https://abtalks.in"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants(), "mt-4 inline-flex")}
          >
            Explore ABTalks
          </a>
        </section>
      </div>
    );
  }

  const submissionWindow = getSubmissionWindow();
  const firstName = reg.me.fullName.split(" ")[0] ?? reg.me.fullName;
  const entryChip =
    reg.team.entryType === "SOLO" ? "SOLO" : (reg.team.name ?? "TEAM");

  const rosterLocked =
    Date.now() >= new Date(HACKATHON.rosterLockUtc).getTime();
  const canManage =
    reg.team.entryType === "TEAM" && reg.me.isLeader && !rosterLocked;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 pb-28 md:pb-10">
      <header className="mb-8 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Welcome, {firstName}
        </h1>
        <span className="rounded-md border border-[#7364E6]/40 bg-[#7364E6]/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-[#C4B5FD]">
          {entryChip}
        </span>
      </header>

      <div className="space-y-6">
        <MissionTimer
          kickoffUtc={HACKATHON.kickoffUtc}
          deadlineUtc={HACKATHON.deadlineUtc}
          resultsLabel={HACKATHON.resultsLabel}
        />
        <SponsorPanel />
        <ProblemStatementPanel
          unlocked={submissionWindow.unlocked}
          closed={submissionWindow.closed}
        />
        <TeamRoster
          entryType={reg.team.entryType}
          teamName={reg.team.name}
          members={reg.members}
          canManage={canManage}
        />
        {reg.me.isLeader && reg.team.entryType === "TEAM" ? (
          <p className="text-xs text-zinc-400">
            {rosterLocked
              ? `Team changes closed on ${HACKATHON.rosterLockLabel}. Message the organizers on WhatsApp if you need a change.`
              : `You can add or remove teammates until ${HACKATHON.rosterLockLabel}.`}
          </p>
        ) : null}
        {reg.team.entryType === "TEAM" && reg.spotsLeft > 0 ? (
          <InvitePanel teamCode={reg.team.code} spotsLeft={reg.spotsLeft} />
        ) : null}
        <SubmissionChecklist submissionOpen={submissionWindow.unlocked} />
        <EventInfo />
      </div>
    </div>
  );
}
