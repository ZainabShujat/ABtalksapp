import Link from "next/link";
import { CalendarDays } from "lucide-react";
import WorkshopLogo from "@/components/workshop/WorkshopLogo";

export default function WorkshopHeader() {
  return (
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

        <div className="flex items-center gap-1.5 sm:gap-3">
          <Link
            href="/ai-workshop/events"
            className="group inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium text-white/60 transition-colors hover:text-white sm:px-3.5"
          >
            <CalendarDays size={15} strokeWidth={1.75} />
            <span className="hidden sm:inline">Discover events</span>
            <span className="sm:hidden">Events</span>
          </Link>

          <a
            href="#register"
            className="rounded-full px-4 py-2 text-[13px] font-semibold text-white transition-transform hover:-translate-y-0.5"
            style={{
              background: "var(--wk-grad)",
              boxShadow: "0 6px 20px -6px rgba(var(--wk-a2-rgb),0.6)",
            }}
          >
            Reserve seat
          </a>
        </div>
      </div>
    </header>
  );
}
