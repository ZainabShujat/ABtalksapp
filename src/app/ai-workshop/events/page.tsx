import type { Metadata } from "next";
import Link from "next/link";
import EventsTimeline from "@/components/workshop/EventsTimeline";
import WorkshopLogo from "@/components/workshop/WorkshopLogo";
import WorkshopThemeStyles from "@/components/workshop/WorkshopThemeStyles";

export const metadata: Metadata = {
  title: "Upcoming Events | ABTalks AI Workshop",
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
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderBottom: "1px solid var(--wk-bar-border)",
          }}
        >
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 py-3">
            <div className="flex items-center gap-3">
              <WorkshopLogo />
              <div
                className="hidden h-4 w-px sm:block"
                style={{ background: "var(--wk-bar-border)" }}
              />
              <span
                className="hidden rounded-md px-2.5 py-1 text-[10px] font-bold uppercase leading-none tracking-widest sm:inline-block"
                style={{
                  background: "rgba(var(--wk-a1-rgb),0.12)",
                  color: "var(--wk-a1)",
                  border: "1px solid rgba(var(--wk-a1-rgb),0.25)",
                }}
              >
                AI Workshop
              </span>
            </div>
            <Link
              href="/ai-workshop"
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
            href="/ai-workshop#register"
            className="mt-4 inline-flex items-center gap-2 rounded-[10px] px-7 py-3 text-[15px] font-bold text-white transition-transform hover:-translate-y-0.5"
            style={{
              background: "var(--wk-a1)",
              filter: "var(--wk-cta-shadow)",
            }}
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
            © {new Date().getFullYear()} ABTalks · AI Workshop
          </p>
        </footer>
      </div>
    </div>
  );
}
