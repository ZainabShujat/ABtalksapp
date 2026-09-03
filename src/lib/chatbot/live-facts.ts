import "server-only";
import { formatInTimeZone } from "date-fns-tz";
import { IST } from "@/lib/date-utils";
import { logger } from "@/lib/logger";

/**
 * Facts computed at REQUEST time, from the same sources the website renders.
 *
 * The knowledge corpus is a snapshot. Three kinds of truth outrun a snapshot:
 *
 *   1. Facts that change with no code and no deploy — the workshop date and
 *      time live in a hand-edited Supabase row, so an organiser can move an
 *      event and the corpus will not know until somebody re-ingests.
 *   2. Facts that change on deploy — `events-data.ts`, `hackathon-config.ts`.
 *      Re-ingesting catches these, but only if someone remembers to.
 *   3. Facts that change with NO data change at all. "Is registration open?"
 *      and "is that workshop upcoming?" flip purely because a date passed.
 *      No ingest cadence fixes this one; only reading the clock does.
 *
 * So this block is assembled fresh, marked as the highest-precedence source in
 * the prompt, and prepended to whatever retrieval found. Retrieval still
 * supplies the depth — curriculum, rules, eligibility — while the dates and
 * open/closed states come from the live source every time.
 *
 * Everything here is best-effort: any failure returns what it has rather than
 * throwing, because a chatbot that answers with slightly stale dates is much
 * better than one that 500s when Supabase is slow.
 */

/**
 * Short TTL rather than none. Consecutive turns of one conversation should not
 * each hit Supabase, but a date edited by an organiser should show up in about
 * a minute — not on the next deploy.
 */
const CACHE_TTL_MS = 60_000;

let cache: { at: number; text: string } | null = null;

type LiveEvent = {
  title: string;
  date: string;
  time: string;
  location: string;
  registrationOpen: boolean;
};

/**
 * Reads the events module the site renders from.
 *
 * Imported lazily and defensively: it is a client-oriented module (its entries
 * carry React icon components) and it pulls in date-fns-tz. A failure here must
 * degrade to "no live event facts", never take the chat endpoint down.
 */
async function readEvents(todayKey: string): Promise<{
  next: LiveEvent | null;
  registrable: LiveEvent | null;
  recentPast: LiveEvent[];
}> {
  try {
    const mod = await import("@/components/workshop/events-data");
    const toLive = (e: {
      title: string;
      date: string;
      time: string;
      location: string;
      register?: boolean;
      registrationOpen?: boolean;
    }): LiveEvent => ({
      title: e.title,
      date: e.date,
      time: e.time,
      location: e.location,
      registrationOpen: Boolean(e.register && e.registrationOpen),
    });

    const upcoming = mod.upcomingEvents(todayKey);
    const registrable = mod.getRegistrableEvent();
    const past = mod.pastEvents(todayKey);

    return {
      next: upcoming[0] ? toLive(upcoming[0]) : null,
      registrable: registrable ? toLive(registrable) : null,
      recentPast: past.slice(0, 3).map(toLive),
    };
  } catch (error) {
    logger.warn("Chatbot live facts: events unavailable", {
      error: String(error),
    });
    return { next: null, registrable: null, recentPast: [] };
  }
}

/** The hackathon's own registration gate, evaluated against the clock now. */
async function readHackathon(): Promise<string | null> {
  try {
    const mod = await import("@/components/hackathon/hackathon-config");
    const open = mod.isHackathonRegistrationOpen();
    return [
      `- ${mod.HACKATHON.name}: registration is ${open ? "OPEN" : "CLOSED"} right now.`,
      `  ${mod.HACKATHON.registrationClosesLabel}. Kickoff ${mod.HACKATHON.kickoffLabel}; deadline ${mod.HACKATHON.deadlineLabel}.`,
    ].join("\n");
  } catch (error) {
    logger.warn("Chatbot live facts: hackathon config unavailable", {
      error: String(error),
    });
    return null;
  }
}

/**
 * The workshop date/time row an organiser edits without shipping code. This is
 * the fact most likely to be wrong in the corpus at any given moment.
 */
async function readWorkshopConfig(): Promise<string | null> {
  try {
    const { getWorkshopConfig } = await import("@/lib/workshop-supabase");
    const config = await getWorkshopConfig();
    return `- Currently configured webinar: ${config.webinarDate} at ${config.webinarTime}.`;
  } catch (error) {
    logger.warn("Chatbot live facts: workshop config unavailable", {
      error: String(error),
    });
    return null;
  }
}

function describe(event: LiveEvent): string {
  return `${event.title} — ${event.date} at ${event.time} (${event.location})${
    event.registrationOpen ? ", registration OPEN" : ""
  }`;
}

/** Builds the live block. Cached for `CACHE_TTL_MS`. Never throws. */
export async function buildLiveFacts(): Promise<string> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.text;

  const now = new Date();
  const todayKey = formatInTimeZone(now, IST, "yyyy-MM-dd");
  const todayLabel = formatInTimeZone(now, IST, "EEEE, d MMMM yyyy");

  const lines: string[] = [`- Today is ${todayLabel} (IST).`];

  const [events, hackathon, workshopConfig] = await Promise.all([
    readEvents(todayKey),
    readHackathon(),
    readWorkshopConfig(),
  ]);

  if (events.registrable) {
    lines.push(
      `- Registration is OPEN for exactly one event: ${describe(events.registrable)}`,
    );
  } else {
    lines.push("- No event is currently accepting registrations.");
  }

  if (events.next) {
    lines.push(`- Next upcoming event: ${describe(events.next)}`);
  } else {
    lines.push("- There is no upcoming event on the calendar right now.");
  }

  if (events.recentPast.length > 0) {
    lines.push(
      `- Most recent PAST events (do not describe these as upcoming): ${events.recentPast
        .map((e) => `${e.title} (${e.date})`)
        .join("; ")}`,
    );
  }

  if (hackathon) lines.push(hackathon);
  if (workshopConfig) lines.push(workshopConfig);

  const text = lines.join("\n");
  cache = { at: Date.now(), text };
  return text;
}

/** Test/ops hook — forces the next call to recompute. */
export function resetLiveFactsCache(): void {
  cache = null;
}
