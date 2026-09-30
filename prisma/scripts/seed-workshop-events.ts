/**
 * Plan 163 phase 1a: port the workshop schedule into the database.
 *
 * Reads `prisma/content/workshop-events.json` — the ten events exactly as they
 * were verified out of the old hardcoded `EVENTS` array, field for field, by
 * `verify-workshop-events-port.ts` while that array still existed.
 *
 * **The snapshot is the input, not the old array.** Phase 1b deleted `EVENTS`,
 * so a script importing it could never run again — and production still needs
 * to be ported. Freezing the verified rows into `prisma/content/` (this repo's
 * convention for seeded content) keeps this runnable anywhere, in any order,
 * and makes what it writes reviewable in the diff.
 *
 * Three rules it exists to enforce:
 *
 * 1. **Ids are preserved verbatim.** `WorkshopRegistration.eventId` points at
 *    them by string, 366 rows deep. A changed id silently detaches a roster.
 * 2. **Every ported row is archived.** These are historical records; the public
 *    schedule starts empty and `placeholderSaturdays()` fills the calendar with
 *    TBA until an admin publishes something new.
 * 3. **`iconName` is a name, never a component** — a component cannot be stored
 *    and cannot cross the Server→Client boundary.
 *
 * Idempotent: `upsert` by id, so re-running changes nothing. It never deletes.
 *
 *   npx tsx prisma/scripts/seed-workshop-events.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient, type Prisma, type WorkshopTrack } from "@prisma/client";

const prisma = new PrismaClient();

type SeedEvent = {
  id: string;
  date: string;
  timeLabel: string;
  title: string;
  description: string;
  host: string;
  location: string;
  tag: string;
  accent: string;
  iconName: string;
  track: WorkshopTrack;
  posterUrl: string | null;
  registrationOpen: boolean;
  register: boolean;
  externalHref: string | null;
  ctaLabel: string | null;
  youtubeId: string | null;
  duration: string | null;
  titleAccents: string[];
  takeaways: string[];
  topics: string[];
  resources: Prisma.InputJsonValue | null;
  durationMinutes: number | null;
};

export function loadSeedEvents(): SeedEvent[] {
  return JSON.parse(
    readFileSync(join(process.cwd(), "prisma/content/workshop-events.json"), "utf8"),
  ) as SeedEvent[];
}

async function main() {
  const events = loadSeedEvents();
  const archivedAt = new Date();
  console.log(`Porting ${events.length} events. All will be archived.\n`);

  const seen = new Set<string>();
  for (const e of events) {
    if (seen.has(e.id)) {
      throw new Error(
        `Duplicate id "${e.id}" — two workshops would share one roster. ` +
          `Refusing to port.`,
      );
    }
    seen.add(e.id);
    if (!e.iconName.trim()) {
      throw new Error(`[${e.id}] empty iconName — that renders a blank card.`);
    }
  }

  for (const e of events) {
    const { id, date, resources, ...rest } = e;
    const data = {
      ...rest,
      date: new Date(`${date}T00:00:00Z`),
      ...(resources == null ? {} : { resources }),
      publishedAt: null,
      archivedAt,
    };
    await prisma.workshopEvent.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
      select: { id: true },
    });
    console.log(
      `  ${id.padEnd(26)} ${date}  ${e.track.padEnd(9)} icon=${e.iconName}`,
    );
  }

  const total = await prisma.workshopEvent.count();
  const archived = await prisma.workshopEvent.count({
    where: { archivedAt: { not: null } },
  });
  const published = await prisma.workshopEvent.count({
    where: { publishedAt: { not: null } },
  });
  console.log(
    `\nWorkshopEvent rows: ${total}  archived: ${archived}  published: ${published}`,
  );
  console.log(
    `WorkshopRegistration rows: ${await prisma.workshopRegistration.count()} (untouched)`,
  );
}

// Only when run directly. `verify-workshop-events-port.ts` imports
// `loadSeedEvents` from here, and importing a module must not port a database.
if (process.argv[1]?.includes("seed-workshop-events")) {
  main()
    .catch((error) => {
      console.error("\nPORT FAILED:", error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
