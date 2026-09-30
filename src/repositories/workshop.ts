import "server-only";
import type { Prisma, WorkshopEvent as WorkshopEventRow } from "@prisma/client";
import { prisma } from "@/lib/db";
import type {
  WorkshopEvent,
  WorkshopResource,
} from "@/components/workshop/events-data";

/**
 * Workshop events — the canonical read boundary. Plan 163.
 *
 * Replaces the hardcoded `EVENTS` array. Two rules live here and nowhere else,
 * so no page can invent its own:
 *
 * 1. **Public eligibility.** A row reaches the public site only when it is
 *    published and not archived. `listPublicEvents` is the only public read;
 *    everything user-facing goes through it. The ten ported events are all
 *    archived, so the public schedule is empty until an admin publishes
 *    something — and `placeholderSaturdays()` fills the calendar with TBA in
 *    the meantime.
 * 2. **Rows become the shape the helpers already speak.** `toWorkshopEvent`
 *    maps a row to the existing `WorkshopEvent` interface, so the calendar,
 *    timeline and registration logic keep their current code and only change
 *    where their data comes from.
 *
 * The icon travels as a NAME and is resolved with `iconFor` at the point of
 * render. Resolving it here would put a React component in Server->Client
 * props, which cannot be serialized - the constraint EventsCalendar's own
 * docblock used to satisfy by reading the module array directly.
 */

const SELECT = {
  id: true,
  date: true,
  timeLabel: true,
  title: true,
  description: true,
  host: true,
  location: true,
  tag: true,
  accent: true,
  iconName: true,
  track: true,
  posterUrl: true,
  registrationOpen: true,
  register: true,
  externalHref: true,
  ctaLabel: true,
  youtubeId: true,
  duration: true,
  titleAccents: true,
  takeaways: true,
  topics: true,
  resources: true,
  durationMinutes: true,
} satisfies Prisma.WorkshopEventSelect;

type Row = Pick<WorkshopEventRow, keyof typeof SELECT>;

/**
 * A row in the shape the existing helpers and components already use.
 *
 * Optional keys are omitted rather than set to null, because the interface
 * declares them optional and `exactOptionalPropertyTypes`-style consumers
 * check with `?.` and `??`. A literal null would read as "present and empty".
 */
export function toWorkshopEvent(row: Row): WorkshopEvent {
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
    registrationOpen: row.registrationOpen,
    ...(row.register ? { register: true } : {}),
    ...(row.externalHref ? { href: row.externalHref } : {}),
    ...(row.ctaLabel ? { ctaLabel: row.ctaLabel } : {}),
    ...(row.youtubeId ? { youtubeId: row.youtubeId } : {}),
    ...(row.titleAccents.length ? { titleAccents: row.titleAccents } : {}),
    ...(row.posterUrl ? { posterSrc: row.posterUrl } : {}),
    ...(row.duration ? { duration: row.duration } : {}),
    ...(row.takeaways.length ? { takeaways: row.takeaways } : {}),
    ...(row.topics.length ? { topics: row.topics } : {}),
    ...(row.resources
      ? { resources: row.resources as unknown as WorkshopResource[] }
      : {}),
    ...(row.durationMinutes != null
      ? { durationMinutes: row.durationMinutes }
      : {}),
  };
}

/**
 * Everything the public may see: published, not archived.
 *
 * `registrationOpen` and "is it upcoming" are deliberately NOT filtered here.
 * They are per-surface questions the existing helpers already answer —
 * `openWorkshops` wants upcoming ones, `pastEvents` wants finished ones — and
 * pre-filtering would make the past timeline permanently empty. This boundary
 * answers only "may the public see this row at all".
 */
export async function listPublicEvents(): Promise<WorkshopEvent[]> {
  const rows = await prisma.workshopEvent.findMany({
    where: { publishedAt: { not: null }, archivedAt: null },
    orderBy: { date: "asc" },
    select: SELECT,
  });
  return rows.map(toWorkshopEvent);
}

/** Every event, archived and unpublished included. Admin surfaces only. */
export async function listAllEvents(): Promise<WorkshopEvent[]> {
  const rows = await prisma.workshopEvent.findMany({
    orderBy: { date: "desc" },
    select: SELECT,
  });
  return rows.map(toWorkshopEvent);
}

/**
 * One event by id, whatever its state.
 *
 * Used where a roster is being read: `WorkshopRegistration.eventId` points at
 * archived events and always will, so this must not apply the public filter.
 */
export async function getEventById(
  id: string,
): Promise<WorkshopEvent | null> {
  const row = await prisma.workshopEvent.findUnique({
    where: { id },
    select: SELECT,
  });
  return row ? toWorkshopEvent(row) : null;
}

/** Titles for a set of ids, for admin roster tables. Avoids N reads. */
export async function getEventTitles(
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.workshopEvent.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true },
  });
  return new Map(rows.map((r) => [r.id, r.title]));
}

/* ── Writes (plan 163 phase 2) ───────────────────────────────────────────── */

/** Registrations attached to an event. The roster's size, by its key. */
export async function countRegistrations(eventId: string): Promise<number> {
  return prisma.workshopRegistration.count({ where: { eventId } });
}

/** One event as the admin console sees it: every field, whatever its state. */
export async function getEventForAdmin(id: string) {
  return prisma.workshopEvent.findUnique({
    where: { id },
    select: { ...SELECT, publishedAt: true, archivedAt: true },
  });
}

/** Every event with its roster size, newest first. Admin console only. */
export async function listEventsForAdmin() {
  const [rows, counts] = await Promise.all([
    prisma.workshopEvent.findMany({
      orderBy: { date: "desc" },
      select: {
        id: true,
        date: true,
        title: true,
        track: true,
        registrationOpen: true,
        posterUrl: true,
        publishedAt: true,
        archivedAt: true,
      },
    }),
    prisma.workshopRegistration.groupBy({
      by: ["eventId"],
      _count: { _all: true },
    }),
  ]);
  const byEvent = new Map(counts.map((c) => [c.eventId, c._count._all]));
  return rows.map((r) => ({ ...r, registrations: byEvent.get(r.id) ?? 0 }));
}

export type WorkshopWriteFields = Omit<
  Prisma.WorkshopEventUncheckedCreateInput,
  "id" | "createdAt" | "updatedAt" | "publishedAt" | "archivedAt"
>;

/**
 * Create, failing on a duplicate id.
 *
 * The unique constraint decides, rather than a `findUnique` first: two admins
 * creating the same date at the same moment would both pass a pre-check and
 * the second would overwrite the first, merging two rosters under one id —
 * the failure `events-data.ts` warns about. P2002 is translated by the caller.
 */
export async function createEvent(id: string, data: WorkshopWriteFields) {
  return prisma.workshopEvent.create({
    data: { ...data, id, publishedAt: null, archivedAt: null },
    select: { id: true },
  });
}

/**
 * Update the editable fields.
 *
 * `id` is not among them and never will be: it is the roster key. A date edit
 * moves the `date` column only, leaving the id — and therefore the
 * registrations — where they are.
 */
export async function updateEvent(id: string, data: WorkshopWriteFields) {
  return prisma.workshopEvent.update({
    where: { id },
    data,
    select: { id: true },
  });
}

/** Lifecycle only. Never touches the poster or any content field. */
export async function setLifecycle(
  id: string,
  patch: { publishedAt?: Date | null; archivedAt?: Date | null },
) {
  return prisma.workshopEvent.update({
    where: { id },
    data: patch,
    select: { id: true, publishedAt: true, archivedAt: true },
  });
}

export type DeleteOutcome =
  | { ok: true }
  | { ok: false; reason: "has-registrations"; registrations: number }
  | { ok: false; reason: "not-found" };

/**
 * Delete, but only with an empty roster.
 *
 * Counted and deleted in ONE transaction: checking first and deleting after
 * leaves a window in which a signup lands and is destroyed with the event.
 * Anything with registrations is archived instead — that is the caller's job
 * to offer, and this refuses rather than deciding for them.
 */
export async function deleteEventIfEmpty(
  id: string,
  /**
   * Runs inside the same transaction, after the roster check passes and before
   * the row goes. This is where the audit row is written: written outside, a
   * failed delete would leave a record saying the workshop was deleted when it
   * still exists. Here, a failure rolls both back together.
   */
  onBeforeDelete?: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<DeleteOutcome> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.workshopEvent.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return { ok: false, reason: "not-found" } as const;

    const registrations = await tx.workshopRegistration.count({
      where: { eventId: id },
    });
    if (registrations > 0) {
      return { ok: false, reason: "has-registrations", registrations } as const;
    }

    await onBeforeDelete?.(tx);
    await tx.workshopEvent.delete({ where: { id }, select: { id: true } });
    return { ok: true } as const;
  });
}

/**
 * The poster, and only the poster.
 *
 * Deliberately its own function rather than a field on `updateEvent`: the
 * poster is independent of the workshop's content and of its lifecycle, and a
 * write that could touch both invites the coupling plan 163 exists to prevent.
 */
export async function setPosterUrl(id: string, posterUrl: string | null) {
  return prisma.workshopEvent.update({
    where: { id },
    data: { posterUrl },
    select: { id: true, posterUrl: true },
  });
}
