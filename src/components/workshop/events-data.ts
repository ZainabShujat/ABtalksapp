import { formatInTimeZone } from "date-fns-tz";
import type { LucideIcon } from "lucide-react";
import { IST } from "@/lib/date-utils";
import { BriefcaseBusiness, Clapperboard, GraduationCap, Palette, Trophy } from "lucide-react";

export interface WorkshopEvent {
  /**
   * Stable identifier, written to `WorkshopRegistration.eventId` on every signup
   * and never changed afterwards — it is how a roster stays attached to its
   * workshop even if the title or date is edited later.
   *
   * For NEW events use a dated slug: `workshop-YYYY-MM-DD` (e.g.
   * `workshop-2026-08-14`). At a weekly cadence, topic-based names run out and
   * risk being reused, which would silently merge two workshops' rosters.
   *
   * `ai-workshop-live` and `uiux-ai-workshop` predate this convention and are
   * already written into 526 migrated rows — leave them as they are.
   */
  id: string;
  date: string; // ISO (YYYY-MM-DD)
  time: string;
  tag: string;
  accent: string;
  /** Import this module only from Client Components — a component reference
   *  cannot be serialized across the Server→Client boundary. */
  Icon: LucideIcon;
  title: string;
  desc: string;
  host: string;
  location: string;
  /** Open for registration now — its card links straight to the form. */
  register?: boolean;
  /**
   * Accepting signups. Set this (alongside `register`) on exactly one upcoming
   * event to open the form; clearing it closes registration immediately.
   *
   * Signups all land in the single `WorkshopRegistration` table keyed by
   * `event.id`, so opening a new workshop needs nothing beyond an entry here.
   */
  registrationOpen?: boolean;
  /**
   * External destination for events that live outside the workshop funnel
   * (e.g. the hackathon). When set, the card links here in a new tab instead
   * of scrolling to the workshop registration form, and `ctaLabel` names the
   * action. Mutually exclusive with `register` in practice.
   */
  href?: string;
  /** Button text for an `href` event. Defaults to "Learn more". */
  ctaLabel?: string;
}

export const EVENTS: WorkshopEvent[] = [
  {
    id: "ai-workshop-live",
    date: "2026-07-18",
    time: "4:00 PM IST",
    tag: "Live",
    accent: "#8b5cf6",
    Icon: GraduationCap,
    title: "FREE AI Bootcamp — Live Workshop",
    desc: "Master ChatGPT, Claude & Gemini in one hands-on live hour — prompt engineering, real workflows, and the tools that 10x your output.",
    host: "ABTalks",
    location: "Live · Zoom",
  },
  {
    id: "uiux-ai-workshop",
    date: "2026-08-01",
    time: "6:00 PM IST",
    tag: "Design",
    accent: "#6366f1",
    Icon: Palette,
    title: "Figma × Cursor — AI-Powered UI/UX Workshop",
    desc: "Design in Figma, ship with Cursor — MCP servers, AI plugins, and a live run from blank canvas to polished screens to working front-end code.",
    host: "ABTalks",
    location: "Live · Zoom",
    register: true,
    // No `registrationOpen`: this event is past, so registration is closed.
    // Set it on the next upcoming event to reopen the form.
  },
  {
    id: "ai-hackathon-48h",
    date: "2026-08-07",
    time: "Starts 8:00 PM IST",
    tag: "Hackathon",
    accent: "#22d3ee",
    Icon: Trophy,
    title: "48-Hour AI Hackathon",
    desc: "Build a working AI product in a weekend. Form a team, ship something real, and pitch it to judges for prizes and recruiter visibility.",
    host: "ABTalks",
    location: "Online · Team event",
    href: "https://www.abtalks.in/hackathon?s=shr",
    ctaLabel: "View hackathon",
  },
  {
    id: "linkedin-ai-interview",
    date: "2026-08-21",
    time: "6:00 PM IST",
    tag: "Career",
    accent: "#a855f7",
    Icon: BriefcaseBusiness,
    title: "Enhance LinkedIn & AI Mock Interview",
    desc: "Rebuild your LinkedIn profile so recruiters actually find you, then run live AI mock interviews that grill you and score your answers.",
    host: "ABTalks",
    location: "Live · YouTube",
    register: true,
    registrationOpen: true,
  },
  {
    id: "workshop-2026-09-05",
    date: "2026-09-05",
    time: "6:00 PM IST",
    tag: "Content",
    accent: "#ec4899",
    Icon: Clapperboard,
    title: "AI Post & Video Generation",
    desc: "Turn one idea into a week of content — generate scroll-stopping posts, carousels and short-form videos with AI, then edit and schedule them in minutes.",
    host: "ABTalks",
    location: "Live · YouTube",
  },
];

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

export const monthAbbr = (iso: string) =>
  utc(iso).toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();

export const dayNum = (iso: string) =>
  utc(iso).toLocaleString("en-US", { day: "2-digit", timeZone: "UTC" });

export const weekday = (iso: string) =>
  utc(iso).toLocaleString("en-US", { weekday: "long", timeZone: "UTC" });

/** Today's IST calendar day as `yyyy-MM-dd`. */
export const istTodayKey = () => formatInTimeZone(new Date(), IST, "yyyy-MM-dd");

/**
 * An event counts as past once its IST calendar day has fully ended, so it
 * stays under Upcoming for the whole of its own day. Both values are
 * `yyyy-MM-dd`, which sorts chronologically as plain strings.
 */
export const isPastEvent = (ev: WorkshopEvent, todayKey: string) =>
  ev.date < todayKey;

/** Upcoming events, soonest first. */
export const upcomingEvents = (todayKey: string) =>
  EVENTS.filter((e) => !isPastEvent(e, todayKey)).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

/** Past events, most recent first. */
export const pastEvents = (todayKey: string) =>
  EVENTS.filter((e) => isPastEvent(e, todayKey)).sort((a, b) =>
    b.date.localeCompare(a.date),
  );

/**
 * The one event currently accepting signups: the soonest upcoming event
 * flagged `register`. A finished event can therefore never show a live
 * Register button, even if its flag was left set.
 */
export const getRegistrableEvent = (
  todayKey: string,
): WorkshopEvent | undefined =>
  upcomingEvents(todayKey).find((e) => e.register && e.registrationOpen);

export const fullDate = (iso: string) =>
  utc(iso).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
