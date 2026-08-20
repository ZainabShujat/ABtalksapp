import type { Metadata } from "next";
import Link from "next/link";
import EventsTimeline from "@/components/workshop/EventsTimeline";
import WorkshopLogo from "@/components/workshop/WorkshopLogo";

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
        background: "var(--wk-bg)",
        color: "var(--wk-text)",
        overflowX: "clip",
      }}
    >
      <style>{`
        /* Brand palette — mirrors --primary (#6366f1) / AI-domain violet (#8b5cf6)
           from globals.css. Scoped to this page; the app theme is untouched. */
        .wk-root {
          --wk-bg: #050a17;
          --wk-surface: #0b1120;
          --wk-text: #f5f6fa;
          --wk-text-dim: #c7cbda;

          --wk-a1: #6366f1;
          --wk-a1-rgb: 99, 102, 241;
          --wk-a1-light: #818cf8;
          --wk-a1-light-rgb: 129, 140, 248;
          --wk-a1-deep: #4f46e5;

          --wk-a2: #8b5cf6;
          --wk-a2-rgb: 139, 92, 246;
          --wk-a3: #a855f7;
          --wk-a3-light: #c084fc;
          --wk-a4: #a78bfa;

          --wk-grad: linear-gradient(135deg, var(--wk-a1) 0%, var(--wk-a2) 100%);
        }
      `}</style>

      {/* ambient */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div
          style={{
            position: "absolute",
            top: "-160px",
            left: "-120px",
            width: "520px",
            height: "520px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(var(--wk-a1-rgb),0.22), transparent 65%)",
            filter: "blur(70px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "20%",
            right: "-160px",
            width: "560px",
            height: "560px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(var(--wk-a2-rgb),0.16), transparent 65%)",
            filter: "blur(80px)",
          }}
        />
      </div>

      <div className="relative z-10">
        {/* top bar */}
        <header
          className="sticky top-0 z-50 w-full px-4"
          style={{
            background: "rgba(5,10,23,0.7)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 py-3">
            <div className="flex items-center gap-3">
              <WorkshopLogo />
              <div className="hidden h-4 w-px bg-white/15 sm:block" />
              <span
                className="hidden rounded-md px-2.5 py-1 text-[10px] font-bold uppercase leading-none tracking-widest sm:inline-block"
                style={{
                  background: "rgba(var(--wk-a1-rgb),0.12)",
                  color: "var(--wk-a1-light)",
                  border: "1px solid rgba(var(--wk-a1-rgb),0.25)",
                }}
              >
                AI Workshop
              </span>
            </div>
            <Link
              href="/ai-workshop"
              className="text-[13px] font-medium text-white/55 transition-colors hover:text-white"
            >
              ← Back to Workshop
            </Link>
          </div>
        </header>

        <EventsTimeline />

        {/* bottom CTA */}
        <div className="mx-auto max-w-3xl px-4 pb-16 text-center">
          <p className="text-sm text-white/45">Don&apos;t miss the next one.</p>
          <Link
            href="/ai-workshop#register"
            className="mt-4 inline-flex items-center gap-2 rounded-full px-7 py-3 text-[15px] font-semibold text-white transition-transform hover:-translate-y-0.5"
            style={{
              background: "var(--wk-grad)",
              boxShadow:
                "0 12px 30px -10px rgba(var(--wk-a2-rgb),0.6), inset 0 1px 0 rgba(255,255,255,0.25)",
            }}
          >
            Reserve Your Free Seat →
          </Link>
        </div>

        <footer className="border-t border-white/5 px-4 py-8 text-center">
          <nav
            className="mb-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px] text-white/45"
            aria-label="Legal"
          >
            <Link href="/terms" className="hover:text-white/80 hover:underline">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-white/80 hover:underline">
              Privacy
            </Link>
            <Link href="/cookies" className="hover:text-white/80 hover:underline">
              Cookies
            </Link>
            <Link href="/contact" className="hover:text-white/80 hover:underline">
              Contact
            </Link>
          </nav>
          <p className="text-[13px] text-white/35">
            © {new Date().getFullYear()} ABTalks · AI Workshop
          </p>
        </footer>
      </div>
    </div>
  );
}
