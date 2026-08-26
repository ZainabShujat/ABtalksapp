/**
 * Bounded bulk upserts for plan 078 Phase 2.
 * One batch = one INSERT ... ON CONFLICT round trip (not sequential prisma.upsert).
 */
import { Prisma, type PrismaClient } from "@prisma/client";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function q(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Invalid SQL identifier: ${name}`);
  return `"${name}"`;
}

export function phase2BatchSize(): number {
  const n = Number(process.env.PHASE2_BATCH_SIZE ?? "100");
  if (!Number.isFinite(n) || n < 10) return 100;
  return Math.min(2000, Math.trunc(n));
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function withTransientRetry<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const max = 6;
  let last: unknown;
  for (let attempt = 0; attempt < max; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const code =
        typeof e === "object" && e && "code" in e
          ? String((e as { code: unknown }).code)
          : "";
      const msg = e instanceof Error ? e.message : String(e);
      const transient =
        code === "P1001" ||
        code === "P1002" ||
        code === "P1017" ||
        code === "P2024" ||
        /Can't reach database|Connection.*(reset|closed|terminated)|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|Server has closed/i.test(
          msg,
        );
      if (!transient || attempt === max - 1) throw e;
      const wait = Math.min(30_000, 2_000 * 2 ** attempt);
      console.warn(
        `[078 bulk] ${label}: transient ${code || msg.slice(0, 120)}; retry ${attempt + 1}/${max - 1} in ${wait}ms`,
      );
      await sleep(wait);
    }
  }
  throw last;
}

function sqlValue(value: unknown, cast?: string): Prisma.Sql {
  if (
    value === null ||
    value === undefined ||
    value === Prisma.JsonNull ||
    value === Prisma.DbNull
  ) {
    return cast ? Prisma.sql`NULL::${Prisma.raw(cast)}` : Prisma.sql`NULL`;
  }
  if (value instanceof Date) return Prisma.sql`${value}`;
  if (cast === "jsonb" || (typeof value === "object" && value !== null)) {
    return Prisma.sql`${JSON.stringify(value)}::jsonb`;
  }
  if (cast) return Prisma.sql`${value}::${Prisma.raw(cast)}`;
  return Prisma.sql`${value}`;
}

export async function bulkUpsert(
  prisma: PrismaClient,
  table: string,
  rows: Array<Record<string, unknown>>,
  conflictCols: string[],
  updateCols: string[],
  casts: Record<string, string> = {},
): Promise<number> {
  if (rows.length === 0) return 0;
  const cols = Object.keys(rows[0]!);
  const normalized = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const c of cols) out[c] = c in row ? row[c] : null;
    return out;
  });
  const colSql = cols.map(q).join(", ");
  const conflictSql = conflictCols.map(q).join(", ");
  const setSql = updateCols.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(", ");
  const values = Prisma.join(
    normalized.map((row) => {
      const parts = cols.map((c) => sqlValue(row[c], casts[c]));
      return Prisma.sql`(${Prisma.join(parts)})`;
    }),
  );
  const conflictAction =
    updateCols.length === 0 ? "DO NOTHING" : `DO UPDATE SET ${setSql}`;
  const sql = Prisma.sql`
    INSERT INTO ${Prisma.raw(q(table))} (${Prisma.raw(colSql)})
    VALUES ${values}
    ON CONFLICT (${Prisma.raw(conflictSql)}) ${Prisma.raw(conflictAction)}
  `;
  return prisma.$executeRaw(sql);
}

export async function saveCheckpoint(
  prisma: PrismaClient,
  step: string,
  cursor: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await prisma.migrationRun.create({
    data: {
      step: `ckpt:${step}`,
      ok: true,
      finishedAt: new Date(),
      counts: { cursor, ...extra } as Prisma.InputJsonValue,
    },
  });
}

export async function loadCheckpoint(
  prisma: PrismaClient,
  step: string,
): Promise<string | null> {
  if (process.env.PHASE2_RESET_CHECKPOINT === "1") return null;
  const row = await prisma.migrationRun.findFirst({
    where: { step: `ckpt:${step}`, ok: true },
    orderBy: { startedAt: "desc" },
    select: { counts: true },
  });
  const counts = row?.counts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return null;
  const cursor = (counts as { cursor?: unknown }).cursor;
  return typeof cursor === "string" ? cursor : null;
}

export async function clearCheckpoint(
  prisma: PrismaClient,
  step: string,
): Promise<void> {
  await prisma.migrationRun.deleteMany({
    where: { step: { startsWith: `ckpt:${step}` } },
  });
}

export async function bulkUpsertBatched(
  prisma: PrismaClient,
  opts: {
    label: string;
    table: string;
    rows: Array<Record<string, unknown>>;
    conflict: string[];
    update: string[];
    casts?: Record<string, string>;
    cursorField?: string;
  },
): Promise<number> {
  const size = phase2BatchSize();
  const cursorField = opts.cursorField;
  const sorted =
    cursorField != null
      ? [...opts.rows].sort((a, b) =>
          String(a[cursorField] ?? "").localeCompare(String(b[cursorField] ?? "")),
        )
      : opts.rows;
  const resumeFrom =
    cursorField != null ? await loadCheckpoint(prisma, opts.label) : null;
  const pending =
    resumeFrom && cursorField
      ? sorted.filter((r) => String(r[cursorField]) > resumeFrom)
      : sorted;
  if (resumeFrom) {
    console.log(
      `[078 bulk] ${opts.label}: resume after ${resumeFrom}; ${pending.length}/${sorted.length} remaining`,
    );
  }
  let n = 0;
  for (let i = 0; i < pending.length; i += size) {
    const chunk = pending.slice(i, i + size);
    const affected = await withTransientRetry(
      `${opts.label} ${i + 1}-${i + chunk.length}/${pending.length}`,
      () =>
        bulkUpsert(
          prisma,
          opts.table,
          chunk,
          opts.conflict,
          opts.update,
          opts.casts,
        ),
    );
    n += Number(affected);
    const written = Math.min(i + size, pending.length);
    console.log(
      `[078 bulk] ${opts.label}: ${written}/${pending.length} (batch ${affected})`,
    );
    if (cursorField) {
      const last = chunk[chunk.length - 1]?.[cursorField];
      if (typeof last === "string") {
        await saveCheckpoint(prisma, opts.label, last, {
          written,
          total: pending.length,
        });
      }
    }
  }
  if (cursorField) await clearCheckpoint(prisma, opts.label);
  return n;
}
