/**
 * Plan 163 phase 1b: capture what the workshop helpers return, so the
 * refactor can be proved behaviour-preserving. READ ONLY.
 *
 *   npx tsx prisma/scripts/snapshot-workshop-behaviour.ts before > /tmp/wk-before.json
 *   ...refactor...
 *   npx tsx prisma/scripts/snapshot-workshop-behaviour.ts after  > /tmp/wk-after.json
 *   diff them
 *
 * `before` reads the hardcoded EVENTS array. `after` reads every WorkshopEvent
 * row — ALL of them, archived included — and feeds them to the parameterised
 * helpers. That is the like-for-like comparison: it isolates "did the refactor
 * change the logic?" from "did we deliberately hide the archived events?",
 * which are two different questions and must not be answered by one diff.
 *
 * The clock is frozen so two runs at different times agree.
 */
import { PrismaClient } from "@prisma/client";
import * as data from "../../src/components/workshop/events-data";
import type { WorkshopEvent } from "../../src/components/workshop/events-data";

const prisma = new PrismaClient();

/** Frozen instant: 2026-09-29T12:00:00Z. */
const NOW_MS = Date.UTC(2026, 8, 29, 12, 0, 0);
const TODAY_KEY = "2026-09-29";

/** Months spanning the whole dataset plus two ahead, for the calendar. */
const MONTHS: [number, number][] = [
  [2026, 5], [2026, 6], [2026, 7], [2026, 8], [2026, 9], [2026, 10],
];

/** Identity only — the full objects are compared via the id lists below. */
const ids = (list: readonly WorkshopEvent[] | undefined) =>
  (list ?? []).map((e) => e.id);

/**
 * Before the refactor the helpers close over `EVENTS` and take no events
 * argument; after it they take one first. `upcomingEvents` is the reliable
 * probe: it has no default parameters, so its arity really does go 1 -> 2.
 * (`getRegistrableEvent` would not work — a default parameter does not count
 * toward `Function.length`, so it reports 0 either way.)
 */
const IS_PARAMETERISED =
  (data.upcomingEvents as unknown as { length: number }).length >= 2;

function shape(events: readonly WorkshopEvent[]) {
  const mod = data as unknown as Record<string, (...a: unknown[]) => unknown>;

  const call = <T>(name: string, ...args: unknown[]): T => {
    const fn = mod[name] as (...a: unknown[]) => T;
    // args[0] is always `events`; drop it for the closure-based originals.
    return IS_PARAMETERISED ? fn(...args) : fn(...args.slice(1));
  };

  const out: Record<string, unknown> = {
    upcomingEvents: ids(call("upcomingEvents", events, TODAY_KEY)),
    pastEvents: ids(call("pastEvents", events, TODAY_KEY)),
    sidebarEvents: ids(call("sidebarEvents", events, NOW_MS)),
    getRegistrableEvent:
      (call<WorkshopEvent | undefined>("getRegistrableEvent", events, NOW_MS))?.id ?? null,
  };

  const months: Record<string, unknown> = {};
  for (const [y, m] of MONTHS) {
    const key = `${y}-${String(m + 1).padStart(2, "0")}`;
    months[key] = {
      placeholderSaturdays: ids(
        call<WorkshopEvent[]>("placeholderSaturdays", events, y, m),
      ),
      eventsForMonth: Object.fromEntries(
        [...call<Map<string, WorkshopEvent[]>>("eventsForMonth", events, y, m)]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([day, list]) => [day, ids(list)]),
      ),
    };
  }
  out.months = months;

  // Per-event derived predicates, which is where a subtle logic change hides.
  out.perEvent = [...events]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => ({
      id: e.id,
      isPast: data.isPastEvent(e, TODAY_KEY),
      hasReplay: data.hasReplay(e, TODAY_KEY),
    }));

  return out;
}

/** DB row -> the in-memory shape the helpers expect. */
function toWorkshopEvent(row: {
  id: string; date: Date; timeLabel: string; title: string; description: string;
  host: string; location: string; tag: string; accent: string; iconName: string;
  track: string; posterUrl: string | null; registrationOpen: boolean;
  register: boolean; externalHref: string | null; ctaLabel: string | null;
  youtubeId: string | null; duration: string | null; titleAccents: string[];
  takeaways: string[]; topics: string[]; resources: unknown;
  durationMinutes: number | null;
}): WorkshopEvent {
  return {
    id: row.id,
    date: row.date.toISOString().slice(0, 10),
    time: row.timeLabel,
    tag: row.tag,
    accent: row.accent,
    track: row.track.toLowerCase() as WorkshopEvent["track"],
    iconName: row.iconName,
    title: row.title,
    desc: row.description,
    host: row.host,
    location: row.location,
    ...(row.register ? { register: true } : {}),
    registrationOpen: row.registrationOpen,
    ...(row.externalHref ? { href: row.externalHref } : {}),
    ...(row.ctaLabel ? { ctaLabel: row.ctaLabel } : {}),
    ...(row.youtubeId ? { youtubeId: row.youtubeId } : {}),
    ...(row.titleAccents.length ? { titleAccents: row.titleAccents } : {}),
    ...(row.posterUrl ? { posterSrc: row.posterUrl } : {}),
    ...(row.duration ? { duration: row.duration } : {}),
    ...(row.takeaways.length ? { takeaways: row.takeaways } : {}),
    ...(row.resources ? { resources: row.resources as WorkshopEvent["resources"] } : {}),
    ...(row.topics.length ? { topics: row.topics } : {}),
    ...(row.durationMinutes != null ? { durationMinutes: row.durationMinutes } : {}),
  };
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "before" && mode !== "after") {
    throw new Error("usage: snapshot-workshop-behaviour.ts <before|after>");
  }

  let events: readonly WorkshopEvent[];
  if (mode === "before") {
    events = (data as unknown as { EVENTS: WorkshopEvent[] }).EVENTS;
  } else {
    const rows = await prisma.workshopEvent.findMany({ orderBy: { date: "asc" } });
    events = rows.map(toWorkshopEvent);
  }

  console.log(JSON.stringify({ mode, count: events.length, ...shape(events) }, null, 2));
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
