/**
 * Plan 163 phase 1a verification. READ ONLY.
 *
 * Compares every field of every seeded event against its `WorkshopEvent` row,
 * checks every stored icon name resolves in the client map, and checks the
 * roster gate. Safe to point at production.
 *
 * Also checks the two things that make the port safe rather than merely
 * complete: every registration's `eventId` resolves to a row, and the
 * registration count is unchanged.
 *
 *   npx tsx prisma/scripts/verify-workshop-events-port.ts
 */
import { PrismaClient } from "@prisma/client";
import { knownIconNames } from "../../src/components/workshop/events-data";
import { loadSeedEvents } from "./seed-workshop-events";

/**
 * Compares the database against `prisma/content/workshop-events.json` — the
 * frozen snapshot of the old `EVENTS` array, verified field for field while
 * that array still existed. Phase 1b deleted the array, so the snapshot is now
 * the reference, and this stays runnable against production.
 */
const EVENTS = loadSeedEvents();
type WorkshopEvent = (typeof EVENTS)[number];

const prisma = new PrismaClient();

const EXPECTED_REGISTRATIONS = 366;

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures++;
    console.log(`    FAIL ${label}`);
    console.log(`         db=${JSON.stringify(got)}`);
    console.log(`         ts=${JSON.stringify(want)}`);
  }
  return ok;
}

/**
 * Key-order-insensitive form, for `resources` only.
 *
 * Postgres `jsonb` normalises object key order on write, so `{label, href,
 * kind}` reads back as `{href, kind, label}`. The values are identical and
 * every consumer accesses these by property name, so the ordering carries no
 * meaning — comparing the raw stringification would fail on a correct port.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

const isoOf = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  console.log("Plan 163 phase 1a — port verification\n");

  const rows = await prisma.workshopEvent.findMany({
    select: {
      id: true, date: true, timeLabel: true, title: true, description: true,
      host: true, location: true, tag: true, accent: true, iconName: true,
      track: true, posterUrl: true, registrationOpen: true, register: true,
      externalHref: true, ctaLabel: true, youtubeId: true, duration: true,
      titleAccents: true, takeaways: true, topics: true, resources: true,
      durationMinutes: true, publishedAt: true, archivedAt: true,
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  /*
   * Scoped to the TEN PORTED EVENTS, not the whole table.
   *
   * It used to assert `rows.length === 10`, `archived === rows.length` and
   * `published === 0`, which was right in phase 1a when the table held nothing
   * but the port. Admins create and publish workshops now — that is the point
   * of the feature — so a table with more rows, some of them published, is
   * correct and this script must not call it a failure. What it guards is
   * unchanged: the ten legacy events are all still here, still archived, still
   * unpublished, and still attached to their rosters.
   */
  const seeded = new Set(EVENTS.map((e) => e.id));
  const legacy = rows.filter((r) => seeded.has(r.id));
  console.log(
    `1. Legacy events: ${legacy.length}/${EVENTS.length} present ` +
      `(table holds ${rows.length} in total, extras are admin-created)`,
  );
  if (legacy.length !== EVENTS.length) failures++;

  console.log("\n2. Field-by-field round trip:");
  for (const e of EVENTS) {
    const r = byId.get(e.id);
    if (!r) {
      failures++;
      console.log(`  ${e.id}: FAIL — no row`);
      continue;
    }
    const before = failures;
    check("date", isoOf(r.date), e.date);
    check("timeLabel", r.timeLabel, e.timeLabel);
    check("title", r.title, e.title);
    check("description", r.description, e.description);
    check("host", r.host, e.host);
    check("location", r.location, e.location);
    check("tag", r.tag, e.tag);
    check("accent", r.accent, e.accent);
    check("iconName", r.iconName, e.iconName);
    check("track", r.track, e.track);
    check("posterUrl", r.posterUrl, e.posterUrl);
    check("registrationOpen", r.registrationOpen, e.registrationOpen);
    check("register", r.register, e.register);
    check("externalHref", r.externalHref, e.externalHref);
    check("ctaLabel", r.ctaLabel, e.ctaLabel);
    check("youtubeId", r.youtubeId, e.youtubeId);
    check("duration", r.duration, e.duration);
    check("titleAccents", r.titleAccents, e.titleAccents);
    check("takeaways", r.takeaways, e.takeaways);
    check("topics", r.topics, e.topics);
    check("resources", canonical(r.resources ?? null), canonical(e.resources ?? null));
    check("durationMinutes", r.durationMinutes, e.durationMinutes);
    console.log(
      `  ${failures === before ? "PASS" : "FAIL"}  ${e.id}  (22 fields)`,
    );
  }

  console.log("\n3. Every stored icon name resolves in the client map:");
  const known = new Set(knownIconNames());
  for (const r of rows) {
    const ok = known.has(r.iconName);
    if (!ok) failures++;
    if (!ok) console.log(`  FAIL  ${r.id} -> "${r.iconName}" is not in ICONS`);
  }
  console.log(
    `  ${rows.every((r) => known.has(r.iconName)) ? "PASS" : "FAIL"}  ` +
      `${rows.length} names checked against iconFor's map`,
  );

  console.log("\n4. The legacy ten are historical, not public:");
  const archived = legacy.filter((r) => r.archivedAt !== null).length;
  const published = legacy.filter((r) => r.publishedAt !== null).length;
  console.log(`  ${archived === legacy.length ? "PASS" : "FAIL"}  archived ${archived}/${legacy.length}`);
  console.log(`  ${published === 0 ? "PASS" : "FAIL"}  published ${published} (expect 0)`);
  if (archived !== legacy.length || published !== 0) failures++;

  console.log("\n5. Registration integrity (the roster gate):");
  // Every eventId must resolve to SOME row — legacy or admin-created. A new
  // workshop with signups is as much a roster as a ported one.
  const grouped = await prisma.workshopRegistration.groupBy({
    by: ["eventId"],
    _count: { _all: true },
  });
  for (const g of grouped) {
    const hit = byId.has(g.eventId);
    if (!hit) failures++;
    console.log(
      `  ${hit ? "PASS" : "FAIL"}  ${g.eventId.padEnd(26)} ${String(g._count._all).padStart(3)} registrations -> ${hit ? "matched" : "NO MATCHING EVENT"}`,
    );
  }
  const total = await prisma.workshopRegistration.count();
  const okTotal = total === EXPECTED_REGISTRATIONS;
  if (!okTotal) failures++;
  console.log(`  ${okTotal ? "PASS" : "FAIL"}  total registrations ${total} (expect ${EXPECTED_REGISTRATIONS})`);

  console.log(
    failures === 0
      ? "\nALL CHECKS PASSED — database matches the verified snapshot."
      : `\n${failures} CHECK(S) FAILED`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
