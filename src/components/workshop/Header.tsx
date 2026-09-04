import { CalendarDays } from "lucide-react";
import WorkshopLogo from "@/components/workshop/WorkshopLogo";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBellButton } from "@/components/shared/notification-bell-button";

/**
 * Figma node 1:113 — logo left, primary action right. Run at 62px rather
 * than the design's 78px: a deliberate deviation, so the sticky bar takes
 * less of the viewport. The CTA and icon buttons were shrunk to match.
 *
 * The design shows "Login/Sign Up", which is what cold logged-out traffic
 * gets. A signed-in visitor has nothing to log into, so the same slot becomes
 * the seat CTA rather than showing them a pointless auth link.
 */
export default function WorkshopHeader({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <header
      className="sticky top-0 z-50 w-full px-4 sm:px-[58px]"
      style={{
        background: "var(--wk-bar-bg-blur)",
        backdropFilter: "blur(22px) saturate(170%)",
        WebkitBackdropFilter: "blur(22px) saturate(170%)",
        borderBottom: "1px solid var(--wk-bar-border)",
        // Catches the light along the top edge, the way real glass does.
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07)",
      }}
    >
      <div className="mx-auto flex h-[54px] w-full max-w-[1920px] items-center justify-between gap-2 sm:gap-4">
        <WorkshopLogo />

        <div className="flex min-w-0 items-center gap-1.5 min-[400px]:gap-2 sm:gap-4">
          {/* Jumps to the calendar on this page rather than the separate
              /workshop/events route. A plain hash, not a full path: this
              header only renders on /workshop, so the hash stays on-page
              and picks up the page's smooth scrolling. */}
          <a
            href="#events"
            aria-label="Discover events"
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1.5 text-[13px] font-medium transition-colors hover:text-white min-[400px]:px-3 sm:text-[14px]"
            style={{ color: "var(--wk-bar-muted)" }}
          >
            <CalendarDays size={15} strokeWidth={1.75} />
            {/* Below 380px the label goes and the calendar glyph carries the
                link on its own. That 48px is what lets the seat CTA keep its
                single line at 360 and 320 — measured, without it the button
                ran 3px past the row at 360 and 43px at 320, and was only not
                visibly broken because .wk-root clips its overflow. The
                aria-label above means nothing is lost to a screen reader. */}
            <span className="hidden min-[380px]:inline sm:hidden">Events</span>
            <span className="hidden sm:inline">Discover events</span>
          </a>

          {/* Only for signed-in visitors. The bell self-gates too (it returns
              null once the feed reports signed-out), but not rendering it at
              all for anonymous traffic saves the feed fetch entirely. */}
          {isSignedIn && (
            <span className="wk-bar-icon inline-flex">
              <NotificationBellButton className="inline-flex size-7 items-center justify-center transition-colors" />
            </span>
          )}

          <span className="wk-bar-toggle inline-flex">
            <ThemeToggle />
          </span>

          {/*
            `whitespace-nowrap` and `shrink-0` are the whole fix for the phone
            header. This is a flex item with the default `flex-shrink: 1` and
            `white-space: normal`, so once the row ran out of room it did not
            overflow — it squeezed this button and let the label wrap. Measured
            at 390px it was rendering on THREE lines inside a 47px-tall pill
            ("Login/" / "Sign" / "Up"), which is what made it read as a broken
            control rather than a button.

            A fixed height keeps the pill uniform whatever the label says, and
            the tighter padding below 400px is what buys the row back the width
            that no longer comes out of this button.
          */}
          <a
            href={isSignedIn ? "#register" : "/login?from=%2Fworkshop%23register"}
            className="inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-[10px] px-3 text-[13px] font-bold leading-none text-white transition-transform hover:-translate-y-0.5 min-[400px]:px-4 sm:px-[26px] sm:text-[14px]"
            style={{
              background: "var(--wk-a1)",
              filter: "var(--wk-cta-shadow)",
            }}
          >
            {isSignedIn ? "Reserve seat" : "Login/Sign Up"}
          </a>
        </div>
      </div>
    </header>
  );
}
