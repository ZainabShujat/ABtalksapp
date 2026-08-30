import { formatInTimeZone } from "date-fns-tz";
import type { LucideIcon } from "lucide-react";
import { IST } from "@/lib/date-utils";
import {
  BriefcaseBusiness,
  CalendarClock,
  Clapperboard,
  GraduationCap,
  Palette,
  Rocket,
  Trophy,
  Users,
} from "lucide-react";

/** A resource link shown in the past-workshop details modal. */
export interface WorkshopResource {
  label: string;
  href: string;
  /** `youtube` renders a ▶ marker, `link` renders ↗. */
  kind: "youtube" | "link";
}

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
  /**
   * Which product track this belongs to. Drives the calendar tile colour and,
   * more importantly, what a click does: only `workshop` entries can open the
   * replay modal — everything else navigates to its own track page.
   */
  track: "workshop" | "hackathon" | "cohort" | "challenge";
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

  // ---------------------------------------------------------------------
  // Weekly-changing content. Everything below is swapped per workshop: a
  // new week means a new poster file, new title/desc, new topics/takeaways.
  // ---------------------------------------------------------------------

  /**
   * YouTube video id of the recording. A past workshop WITHOUT this stays
   * un-clickable on the calendar rather than opening an empty player, so an
   * event can be added before its replay is published.
   */
  youtubeId?: string;
  /**
   * Substrings of `title` to render in the hero's accent colour. Matched
   * literally and in order, so each must appear verbatim in `title`; anything
   * that does not match is simply left unstyled.
   */
  titleAccents?: string[];
  /** Poster image (public/ path). Doubles as the modal's pre-play still. */
  posterSrc?: string;
  /** Runtime of the recording, e.g. "01:02:18". Shown on the player still. */
  duration?: string;
  /** Modal "Key takeaways" — rendered numbered 01, 02, 03… */
  takeaways?: string[];
  /** Modal "Resources" list. */
  resources?: WorkshopResource[];
  /**
   * "What You'll Learn" labels, in display order. Plain strings by design —
   * TopicsSection owns the colours and the scatter positions, so a weekly
   * swap is just new text. Falls back to the section default when absent.
   */
  topics?: string[];
  /** True only for auto-generated Saturday placeholders — never for real events. */
  placeholder?: boolean;
}

export const EVENTS: WorkshopEvent[] = [
  {
    id: "claude-challenge-60day",
    date: "2026-06-01",
    time: "Day 1",
    tag: "Challenge",
    accent: "#c9411c",
    track: "challenge",
    Icon: Rocket,
    title: "60-Day Claude AI Challenge begins",
    desc: "Daily AI tasks across four domains with GitHub and LinkedIn proof of work, streaks, and recruiter discoverability at the finish.",
    host: "ABTalks",
    location: "Online · 60 days",
    href: "/",
    ctaLabel: "View challenge",
  },
  {
    id: "ai-cohort-2026-07",
    date: "2026-07-15",
    time: "Cohort start",
    tag: "Cohort",
    accent: "#c9411c",
    track: "cohort",
    Icon: Users,
    title: "AI Cohort Program — Cohort begins",
    desc: "31 days of guided missions, concept checks and graded projects for working professionals, ending in a recruiter-facing profile.",
    host: "ABTalks",
    location: "Online · 31 days",
    href: "/program",
    ctaLabel: "View program",
  },
  {
    id: "ai-workshop-live",
    youtubeId: "ru5mM1ihdRE",
    date: "2026-07-18",
    time: "4:00 PM IST",
    tag: "Live",
    accent: "#e05226",
    track: "workshop",
    Icon: GraduationCap,
    title: "FREE AI Bootcamp Live Workshop",
    desc: "Master ChatGPT, Claude & Gemini in one hands-on live hour - prompt engineering, real workflows, and the tools that 10x your output.",
    host: "ABTalks",
    location: "Live · Zoom",
    takeaways: [
      "Prompt patterns that carry across ChatGPT, Claude and Gemini",
      "Pick the right model for the job instead of defaulting to one",
      "Build a repeatable workflow rather than one-off prompts",
      "Spot the common failure modes and recover from them",
    ],
  },
  {
    id: "uiux-ai-workshop",
    date: "2026-08-01",
    time: "6:00 PM IST",
    tag: "Design",
    accent: "#a93617",
    track: "workshop",
    Icon: Palette,
    title: "Figma × Cursor - AI-Powered UI/UX Workshop",
    desc: "Design in Figma, ship with Cursor, MCP servers, AI plugins, and a live run from blank canvas to polished screens to working front-end code.",
    host: "ABTalks",
    location: "Live · Zoom",
    register: true,
    // No `registrationOpen`: this event is past, so registration is closed.
    // Set it on the next upcoming event to reopen the form.
    takeaways: [
      "Wire Figma to Cursor through MCP and drive both from one place",
      "Go from blank canvas to a usable screen without pixel-pushing",
      "Turn a finished frame into working front-end code",
      "Keep design tokens and code in sync as the file changes",
    ],
  },
  {
    id: "ai-hackathon-48h",
    date: "2026-08-07",
    time: "Starts 8:00 PM IST",
    tag: "Hackathon",
    accent: "#111111",
    track: "hackathon",
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
    youtubeId: "f4b93W03vaU",
    date: "2026-08-21",
    time: "6:00 PM IST",
    tag: "Career",
    accent: "#e05226",
    track: "workshop",
    Icon: BriefcaseBusiness,
    title: "Enhance LinkedIn & AI Mock Interview",
    desc: "Rebuild your LinkedIn profile so recruiters actually find you, then run live AI mock interviews that grill you and score your answers.",
    host: "ABTalks",
    location: "Live · YouTube",
    // Past event (21 Aug): registration closed. The live workshop is
    // `workshop-2026-09-05` below.
    posterSrc: "/workshop/posters/linkedin-ai-interview.jpg",
    takeaways: [
      "Build a recruiter-friendly LinkedIn profile",
      "Create content that gets attention",
      "Use AI to speed up content creation",
      "Understand growth, analytics & consistency",
    ],
    resources: [
      {
        label: "Join the WhatsApp community",
        href: "https://chat.whatsapp.com/LDUvHRIlb5dGHpDJLueR9i?s=cl&p=a&mlu=0&amv=0",
        kind: "link",
      },
    ],
  },
  {
    id: "workshop-2026-09-05",
    date: "2026-09-05",
    time: "7:00 PM IST",
    tag: "Content",
    accent: "#e05226",
    track: "workshop",
    Icon: Clapperboard,
    title: "Create Anything with AI: From Prompt to Published Content",
    titleAccents: ["AI", "Published Content"],
    desc: "Turn one idea into a week of content — generate scroll-stopping posts, carousels and short-form videos with AI, then edit and schedule them in minutes.",
    host: "ABTalks",
    location: "Live · YouTube",
    // The live workshop: hero, countdown, "What You'll Learn" and the
    // registration form all read off this entry. Supabase `workshop_config`
    // independently drives the hero chips and countdown — keep its
    // webinarDate/webinarTime in step with `date`/`time` above.
    register: true,
    registrationOpen: true,
    posterSrc: "/workshop/posters/create-anything-with-ai.jpg",
    topics: [
      "Prompt Engineering Fundamentals",
      "Role, Context & Task",
      "Style, Constraints & Output",
      "AI Image Generation",
      "AI Video Generation",
      "AI Voice & Audio Creation",
      "AI Avatar & Digital Presenters",
      "Script → Avatar → Voice → Video",
      "AI + MCP Workflows",
      "Canva AI & Content Publishing",
    ],
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

// -------------------------------------------------------------------------
// Calendar helpers. `month` is 0-indexed everywhere below, matching Date.
// -------------------------------------------------------------------------

/** The weekly Saturday workshop cadence begins here. */
const SATURDAY_SERIES_START = "2026-09-01";

const isoKey = (d: Date) => d.toISOString().slice(0, 10);

/** Full month name + year, e.g. "August 2026". */
export const monthLabel = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * Synthetic "TBA" workshops for every Saturday of the given month that falls
 * on or after SATURDAY_SERIES_START and has no real EVENTS entry that day.
 *
 * Generated per visible month rather than held as a module-level array: the
 * cadence has no end date, so a static list would grow without bound as the
 * user pages forward.
 */
export const placeholderSaturdays = (
  year: number,
  month: number,
): WorkshopEvent[] => {
  const out: WorkshopEvent[] = [];
  const taken = new Set(EVENTS.map((e) => e.date));
  const cursor = new Date(Date.UTC(year, month, 1));

  while (cursor.getUTCMonth() === month) {
    if (cursor.getUTCDay() === 6) {
      const key = isoKey(cursor);
      if (key >= SATURDAY_SERIES_START && !taken.has(key)) {
        out.push({
          id: `workshop-${key}`,
          date: key,
          time: "6:00 PM IST",
          tag: "Workshop",
          accent: "#8f8f8f",
          track: "workshop",
          Icon: CalendarClock,
          title: "Workshop — TBA",
          desc: "Topic announced soon. Register to be notified when this session opens.",
          host: "ABTalks",
          location: "Live · YouTube",
          placeholder: true,
        });
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
};

/**
 * Every event falling in the given month — real entries plus generated
 * Saturday placeholders — keyed by ISO date so the grid can look up a day in
 * constant time.
 */
export const eventsForMonth = (
  year: number,
  month: number,
): Map<string, WorkshopEvent[]> => {
  const map = new Map<string, WorkshopEvent[]>();

  const push = (ev: WorkshopEvent) => {
    const list = map.get(ev.date);
    if (list) list.push(ev);
    else map.set(ev.date, [ev]);
  };

  for (const ev of EVENTS) {
    const d = utc(ev.date);
    if (d.getUTCFullYear() === year && d.getUTCMonth() === month) push(ev);
  }
  for (const ev of placeholderSaturdays(year, month)) push(ev);

  return map;
};

/**
 * Any finished real workshop opens the details modal. It deliberately does
 * NOT require `youtubeId`: the modal renders a "recording coming soon" state,
 * so takeaways and resources stay reachable while the replay is still being
 * uploaded. Placeholders and non-workshop tracks never qualify.
 */
/**
 * Pre-play still for a recording, straight from the video id — no per-event
 * image to upload, so a workshop gets its thumbnail the moment `youtubeId`
 * is set.
 *
 * `maxres` is 1280×720 but only exists for videos published in HD; `hq` is
 * always present and is the error fallback.
 */
export const youtubeThumb = (id: string, quality: "maxres" | "hq" = "maxres") =>
  `https://i.ytimg.com/vi/${id}/${quality}default.jpg`;

export const hasReplay = (ev: WorkshopEvent, todayKey: string) =>
  ev.track === "workshop" && !ev.placeholder && isPastEvent(ev, todayKey);
