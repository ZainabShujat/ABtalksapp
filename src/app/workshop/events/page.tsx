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
            <div className="flex items-center gap-3">
              <WorkshopLogo />
              <div
                className="hidden h-4 w-px sm:block"
                style={{ background: "var(--wk-bar-border)" }}
              />
              <span
                className="hidden rounded-md px-2.5 py-1 text-[10px] font-bold uppercase leading-none tracking-widest sm:inline-block"
                style={{
                  // Orange text here measured 1.48:1 against the charcoal
                  // bar. Bar text on the same tint clears 5:1.
                  background: "rgba(var(--wk-a1-rgb),0.18)",
                  color: "var(--wk-bar-text)",
                  border: "1px solid rgba(var(--wk-a1-rgb),0.35)",
                }}
              >
                Workshop
              </span>
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
