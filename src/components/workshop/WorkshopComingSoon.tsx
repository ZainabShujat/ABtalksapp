import Link from "next/link";
import { CalendarDays, Bell } from "lucide-react";

/**
 * The public workshop page when nothing is scheduled.
 *
 * This replaces the hero, topics, stats and registration form outright. It
 * exists because the page used to fall back to hardcoded copy — a title, a
 * description and a topic list describing a workshop that existed nowhere,
 * under a countdown frozen at 00:00:00:00 and a Register button the server
 * always refused. None of that was in the database, so no admin could fix it.
 *
 * Deliberately the full-page sibling of `ComingSoonCard`, which is the house
 * treatment for this state in the events timeline: same dashed border, same
 * orbiting radial glow, same floating mark and bouncing dots, same "Stay
 * tuned" chip. One visual language for one idea.
 *
 * A Server Component: it has no state and no interactivity, so it costs the
 * client nothing. The calendar still renders below it — the cadence carries on
 * even when the next topic is not announced, and `placeholderSaturdays()`
 * fills it with TBA tiles.
 */
export default function WorkshopComingSoon({
  message,
}: {
  /** Admin-editable copy; falls back to the standard line. */
  message?: string | null;
}) {
  return (
    <section
      className="wk-cs relative mx-auto w-full max-w-3xl px-4 py-20 text-center sm:py-28"
      aria-labelledby="wk-cs-title"
    >
      <style>{`
        .wk-cs::before {
          content: "";
          position: absolute;
          top: -30%;
          left: 50%;
          width: 120%;
          height: 160%;
          transform: translateX(-50%);
          background: radial-gradient(
            circle at center,
            rgba(var(--wk-a2-rgb), 0.10),
            transparent 55%
          );
          animation: wk-cs-orbit 9s linear infinite;
          pointer-events: none;
        }
        @keyframes wk-cs-orbit {
          from { transform: translateX(-50%) rotate(0deg); }
          to   { transform: translateX(-50%) rotate(360deg); }
        }
        @keyframes wk-cs-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-7px); }
        }
        @keyframes wk-cs-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40%           { transform: translateY(-5px); opacity: 1; }
        }
        .wk-cs-mark { animation: wk-cs-float 4s ease-in-out infinite; }
        .wk-cs-dot  { animation: wk-cs-bounce 1.4s ease-in-out infinite; }

        /* Motion is decoration here; honour the system preference. */
        @media (prefers-reduced-motion: reduce) {
          .wk-cs::before,
          .wk-cs-mark,
          .wk-cs-dot { animation: none; }
        }
      `}</style>

      <span className="wk-cs-mark relative z-10 inline-block text-5xl">✨</span>

      <h1
        id="wk-cs-title"
        className="wk-t relative z-10 mt-5 font-display text-3xl font-bold tracking-tight sm:text-4xl"
      >
        The next workshop is on its way
      </h1>

      <p className="wk-dim relative z-10 mx-auto mt-4 max-w-[46ch] text-[15px] leading-relaxed font-medium">
        {message?.trim() ||
          "We run live sessions most Saturdays. The next topic is being finalised — check the calendar below for the dates we are holding, and we will announce it here as soon as it is set."}
      </p>

      <div className="relative z-10 mt-6 flex items-center justify-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="wk-cs-dot h-1.5 w-1.5 rounded-full"
            style={{
              background: "var(--wk-grad)",
              animationDelay: `${i * 0.18}s`,
            }}
          />
        ))}
      </div>

      {/*
        No Register button: there is nothing to register for, and the server
        would refuse it. These two go somewhere real instead.
      */}
      <div className="relative z-10 mt-9 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="#events"
          className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold"
          style={{
            background: "var(--wk-chip)",
            color: "var(--wk-text)",
            border: "1px solid var(--wk-card-border)",
          }}
        >
          <CalendarDays className="size-4" aria-hidden />
          See the calendar
        </Link>
        <Link
          href="/workshop/events"
          className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold"
          style={{
            background: "var(--wk-chip)",
            color: "var(--wk-text)",
            border: "1px solid var(--wk-card-border)",
          }}
        >
          <Bell className="size-4" aria-hidden />
          Past sessions
        </Link>
      </div>

      <span
        className="relative z-10 mt-10 inline-block rounded-full px-3 py-1 text-[10px] font-bold tracking-widest uppercase"
        style={{
          background: "var(--wk-chip)",
          color: "var(--wk-text-dim)",
          border: "1px solid var(--wk-card-border)",
        }}
      >
        Stay tuned
      </span>
    </section>
  );
}
