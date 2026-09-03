import type { Metadata } from "next";
import Link from "next/link";
import EventsTimeline from "@/components/workshop/EventsTimeline";
import WorkshopLogo from "@/components/workshop/WorkshopLogo";
import WorkshopThemeStyles from "@/components/workshop/WorkshopThemeStyles";

export const metadata: Metadata = {
  title: "Upcoming Events | ABTalks Workshop",
  description:
    "All upcoming ABTalks live workshops and events — UI/UX design, AI tools, agents, content, SaaS, data and careers.",
};

export default function WorkshopEventsPage() {
  return (
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
        <header
          className="sticky top-0 z-50 w-full px-4"
          style={{
            background: "var(--wk-bar-bg-blur)",
            backdropFilter: "blur(22px) saturate(170%)",
            WebkitBackdropFilter: "blur(22px) saturate(170%)",
            borderBottom: "1px solid var(--wk-bar-border)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07)",
          }}
        >
          <div className="mx-auto flex h-[54px] w-full max-w-6xl items-center justify-between gap-4">
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
            <div className="flex items-center gap-3">
              <WorkshopLogo />
            </div>
            <Link
              href="/workshop"
              className="text-[13px] font-medium transition-colors hover:text-white"
              style={{ color: "var(--wk-bar-muted)" }}
            >
              ← Back to Workshop
            </Link>
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

        <footer
          className="px-4 py-10 text-center"
          style={{
            background: "var(--wk-bar-bg)",
            borderTop: "1px solid var(--wk-bar-border)",
          }}
        >
          <nav
            className="mb-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px]"
            aria-label="Legal"
            style={{ color: "var(--wk-bar-text)" }}
          >
            <Link href="/terms" className="hover:underline">
              Terms
            </Link>
            <Link href="/privacy" className="hover:underline">
              Privacy
            </Link>
            <Link href="/cookies" className="hover:underline">
              Cookies
            </Link>
            <Link href="/contact" className="hover:underline">
              Contact
            </Link>
          </nav>
          <p className="text-[13px]" style={{ color: "var(--wk-bar-muted)" }}>
            © {new Date().getFullYear()} ABTalks · Workshop
          </p>
        </footer>
      </div>
    </div>
  );
}
