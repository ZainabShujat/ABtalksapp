/**
 * Plan 157 — flip the live AI-cohort groups to rolling enrollment.
 *
 *   npm run db:rolling:ai-cohort              # dry run (default)
 *   npm run db:rolling:ai-cohort -- --apply   # write
 *
 * The AI Cohort was the last FIXED track on the platform. Its open cohort ended
 * 2026-09-02, and `isCohortFrozen` refused every mission submit from that day
 * on, while people kept joining (the India cohort has joins through 2026-09-09).
 * The code fix removes the date gate; this script removes the dates.
 *
 * Idempotent. Run the dry run again afterwards: it must report nothing pending.
 *
 * Note on the two cohort tables: members read the canonical `Cohort` row, which
 * takes real nulls. `ProgramCohort.startsAt` / `.endsAt` are non-nullable in the
 * schema and are read only by /admin/program, so they get a placeholder window
 * rather than a migration.
 */
import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");

/** Placeholder for the non-nullable ProgramCohort window. Nothing gates on it. */
const FAR_END = new Date("2099-12-31T00:00:00.000Z");
/**
 * `ProgramCohort.capacity` is a non-nullable Int that cannot say "unlimited",
 * and nothing enforces it — `enrollOrWaitlist` and `promoteWaitlisted` both read
 * the canonical `Cohort.capacity`, where the null set below means unlimited.
 */
const OPEN_CAPACITY = 1_000_000;

type Target = {
  /** ProgramCohort id, which is also the canonical slug suffix. */
  programCohortId: string;
  /** New name, or null to leave it alone. */
  rename: string | null;
};

const TARGETS: Target[] = [
  {
    // "AI Cohort India Aug 26" — the open-enrollment cohort. The month in the
    // name shows on the apply screen, so it goes.
    programCohortId: "cms969sax000jkv04sd9tmk42",
    rename: "AI Cohort",
  },
  {
    // "AI Cohort USA" — join-code only. Kept for its existing members; it
    // survived past its end date only on the retired name-string hack.
    programCohortId: "cmrp9r3wt000cjx04eeugfxyp",
    rename: null,
  },
];

function slugFor(programCohortId: string): string {
  return `legacy-program-${programCohortId}`;
}

function iso(d: Date | null): string {
  return d ? d.toISOString().slice(0, 16) : "null";
}

type Pending = { label: string; detail: string };

async function planCanonical(t: Target): Promise<Pending[]> {
  const slug = slugFor(t.programCohortId);
  const row = await prisma.cohort.findUnique({
    where: { slug },
    select: {
      slug: true,
      name: true,
      startMode: true,
      status: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      _count: { select: { enrollments: true } },
    },
  });
  if (!row) {
    console.log(`  !! canonical Cohort ${slug} not found — skipping`);
    return [];
  }

  console.log(
    `  Cohort ${row.slug}\n` +
      `    name=${row.name}  mode=${row.startMode}  status=${row.status}\n` +
      `    startsAt=${iso(row.startsAt)}  endsAt=${iso(row.endsAt)}  ` +
      `capacity=${row.capacity ?? "null"}  enrollments=${row._count.enrollments}`,
  );

  const pending: Pending[] = [];
  if (row.startMode !== "ROLLING") {
    pending.push({ label: "startMode", detail: `${row.startMode} → ROLLING` });
  }
  if (row.startsAt !== null) {
    pending.push({ label: "startsAt", detail: `${iso(row.startsAt)} → null` });
  }
  if (row.endsAt !== null) {
    pending.push({ label: "endsAt", detail: `${iso(row.endsAt)} → null` });
  }
  if (row.capacity !== null) {
    pending.push({
      label: "capacity",
      detail: `${row.capacity} → null (unlimited — this is the enforced one)`,
    });
  }
  if (row.status !== "ENROLLING") {
    pending.push({ label: "status", detail: `${row.status} → ENROLLING` });
  }
  if (t.rename && row.name !== t.rename) {
    pending.push({ label: "name", detail: `"${row.name}" → "${t.rename}"` });
  }
  if (pending.length === 0) return pending;

  if (APPLY) {
    const data: Prisma.CohortUpdateInput = {
      startMode: "ROLLING",
      startsAt: null,
      endsAt: null,
      capacity: null,
      status: "ENROLLING",
    };
    if (t.rename) data.name = t.rename;
    await prisma.cohort.update({ where: { slug }, data });
  }
  return pending;
}

async function planLegacy(t: Target): Promise<Pending[]> {
  const row = await prisma.programCohort.findUnique({
    where: { id: t.programCohortId },
    select: {
      id: true,
      name: true,
      status: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      requiresJoinCode: true,
    },
  });
  if (!row) {
    console.log(`  !! ProgramCohort ${t.programCohortId} not found — skipping`);
    return [];
  }

  console.log(
    `  ProgramCohort ${row.id}\n` +
      `    name=${row.name}  status=${row.status}  ` +
      `code=${row.requiresJoinCode ? "required" : "OPEN"}\n` +
      `    startsAt=${iso(row.startsAt)}  endsAt=${iso(row.endsAt)}  ` +
      `capacity=${row.capacity}`,
  );

  const pending: Pending[] = [];
  if (row.endsAt.getTime() !== FAR_END.getTime()) {
    pending.push({
      label: "endsAt",
      detail: `${iso(row.endsAt)} → ${iso(FAR_END)} (placeholder; non-nullable column)`,
    });
  }
  if (row.capacity !== OPEN_CAPACITY) {
    pending.push({
      label: "capacity",
      detail: `${row.capacity} → ${OPEN_CAPACITY}`,
    });
  }
  if (row.status !== "ENROLLING") {
    pending.push({ label: "status", detail: `${row.status} → ENROLLING` });
  }
  if (t.rename && row.name !== t.rename) {
    pending.push({ label: "name", detail: `"${row.name}" → "${t.rename}"` });
  }
  if (pending.length === 0) return pending;

  if (APPLY) {
    await prisma.programCohort.update({
      where: { id: t.programCohortId },
      data: {
        endsAt: FAR_END,
        capacity: OPEN_CAPACITY,
        status: "ENROLLING",
        ...(t.rename ? { name: t.rename } : {}),
      },
    });
  }
  return pending;
}

/** Every member's day math now reads `startedAt`; prove it is usable. */
async function checkAnchors(): Promise<void> {
  const rows = await prisma.programEnrollment.findMany({
    where: { id: { startsWith: "pe_pm_" } },
    select: { id: true, startedAt: true, joinedAt: true },
  });
  const drifted = rows.filter(
    (r) =>
      r.startedAt.toISOString().slice(0, 10) !==
      r.joinedAt.toISOString().slice(0, 10),
  );
  console.log(
    `\nAnchors: ${rows.length} pe_pm_ rows, all with a startedAt; ` +
      `${drifted.length} where startedAt's date differs from joinedAt's.`,
  );
  for (const r of drifted.slice(0, 10)) {
    console.log(
      `  ${r.id}  startedAt=${iso(r.startedAt)}  joinedAt=${iso(r.joinedAt)}`,
    );
  }
  if (drifted.length > 0) {
    console.log(
      "  (Not changed. startedAt is the learner's Day-1 anchor by design; a\n" +
        "   difference here means that member's Day 1 is not their join date.)",
    );
  }
}

async function main() {
  console.log(
    APPLY
      ? "=== make-ai-cohort-rolling: APPLY ===\n"
      : "=== make-ai-cohort-rolling: DRY RUN (pass --apply to write) ===\n",
  );

  let total = 0;
  for (const t of TARGETS) {
    console.log(`--- ${t.programCohortId} ---`);
    const pending = [
      ...(await planCanonical(t)),
      ...(await planLegacy(t)),
    ];
    if (pending.length === 0) {
      console.log("    nothing pending\n");
      continue;
    }
    for (const p of pending) {
      console.log(`    ${APPLY ? "changed" : "pending"}: ${p.label}  ${p.detail}`);
    }
    console.log("");
    total += pending.length;
  }

  await checkAnchors();

  console.log(
    `\n${total} change(s) ${APPLY ? "applied" : "pending"}. ` +
      (APPLY
        ? "Re-run without --apply; it must report 0 pending."
        : "Re-run with --apply to write."),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
