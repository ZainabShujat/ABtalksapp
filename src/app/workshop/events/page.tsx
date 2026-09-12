import type { Metadata } from "next";
import Link from "next/link";
import EventsTimeline from "@/components/workshop/EventsTimeline";
import WorkshopLogo from "@/components/workshop/WorkshopLogo";
import WorkshopThemeStyles from "@/components/workshop/WorkshopThemeStyles";
import { WorkshopShell } from "@/components/workshop/WorkshopShell";
import { DashboardFooter } from "@/components/dashboard-hub/dashboard-footer";
import { SiteSearchSlot } from "@/components/dashboard-hub/site-search-slot";
import { auth } from "@/auth";

export const metadata: Metadata = {
  title: "Upcoming Events | ABTalks Workshop",
  description:
    "All upcoming ABTalks live workshops and events — UI/UX design, AI tools, agents, content, SaaS, data and careers.",
};

export default async function WorkshopEventsPage() {
  // Public route, same as /workshop — the session is read only to decide
  // whether the sidebar shows a user tile or a Log in link.
  const session = await auth();
  const shellUser = {
    name: session?.user?.name ?? "",
    email: session?.user?.email ?? "",
    image: session?.user?.image ?? null,
  };

  return (
    <WorkshopShell user={shellUser} isAuthed={Boolean(session?.user?.id)}>
      <div
        className="wk-root relative min-h-screen"
        style={{
          color: "var(--wk-text)",
          overflowX: "clip",
        }}
      >
        <WorkshopThemeStyles />

        <div className="relative z-10">
          {/* top bar */}
          <header className="abt-header z-50">
            {/* See components/workshop/Header.tsx — same reasoning. */}
            <div className="abt-header-inner md:justify-end">
              {/*
              The "Workshop" chip that used to sit here (logo | divider | pill)
              is gone on THIS route only. It labelled the section you were
              already in, next to a link that says "Back to Workshop" — the
              word twice in one 54px bar.

              Its divider went with it: left alone, the rule would have hung
              off the logo pointing at nothing. The logo now sits by itself and
              the flex row closes up on its own, with no fixed width to adjust.

              This header is local to /workshop/events. /workshop renders the
              shared `components/workshop/Header`, which never had this chip,
              so nothing else in the app changes.
            */}
              {/* Hidden from `md` up, where the sidebar shows the mark. */}
              <div className="flex items-center gap-3 md:hidden">
                <WorkshopLogo />
              </div>
              <div className="flex items-center gap-2">
                <Link href="/workshop" className="abt-header-nav-link">
                  ← Back to Workshop
                </Link>
                <SiteSearchSlot />
              </div>
            </div>
          </header>

          <EventsTimeline />

          {/* bottom CTA */}
          <div className="mx-auto max-w-3xl px-4 pb-16 text-center">
            <p className="text-sm" style={{ color: "var(--wk-muted)" }}>
              Don&apos;t miss the next one.
            </p>
            <Link
              href="/workshop#register"
              className="wk-cta mt-4 inline-flex items-center gap-2 rounded-[12px] px-7 py-3.5 text-[15px] font-bold text-white"
            >
              Reserve Your Free Seat →
            </Link>
          </div>

          {/* Matches /workshop and /marketplace — see the note there. */}
          <DashboardFooter />
        </div>
      </div>
    </WorkshopShell>
  );
}
