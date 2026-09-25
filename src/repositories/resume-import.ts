import "server-only";
import { Prisma, type ResumeImportStatus } from "@prisma/client";
import { prisma, writeClient } from "@/lib/db";
import {
  RESUME_DOCUMENT_VERSION,
  readResumeAnalysis,
  readResumeDocument,
  resumeAnalysisSchema,
  resumeDocumentSchema,
} from "@/features/resume/document";
import type { ParsedResume, ResumeAnalysis } from "@/features/resume/types";

/**
 * The only reader and writer of `ResumeImport` (plan 154).
 *
 * The table is also the job queue: `status` says what a row is waiting for,
 * `nextAttemptAt` when it may run, `leaseUntil` who holds it. Leasing uses
 * `FOR UPDATE SKIP LOCKED`, so two workers can never take the same row, and a
 * worker that dies simply lets its leases expire (`requeueStale`).
 */

const LEASE_MS = 5 * 60_000;

/* ─── Upload ─────────────────────────────────────────────────────────────── */

export async function findImportByHash(
  contentHash: string,
): Promise<{ id: string; status: ResumeImportStatus } | null> {
  return prisma.resumeImport.findUnique({
    where: { contentHash },
    select: { id: true, status: true },
  });
}

/**
 * Create the import, or return the existing one for these bytes. A concurrent
 * upload of the same file loses the unique race and reads the winner.
 */
export async function createOrGetImport(input: {
  contentHash: string;
  originalFilename: string;
  fileSizeBytes: number;
  blobPathname: string;
  uploadedByUserId: string;
}): Promise<{ id: string; duplicate: boolean }> {
  const existing = await findImportByHash(input.contentHash);
  if (existing) return { id: existing.id, duplicate: true };
  try {
    const row = await writeClient().resumeImport.create({
      data: input,
      select: { id: true },
    });
    return { id: row.id, duplicate: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await findImportByHash(input.contentHash);
      if (winner) return { id: winner.id, duplicate: true };
    }
    throw error;
  }
}

/* ─── Admin requests ─────────────────────────────────────────────────────── */

export type Selection = { ids: string[] } | { all: true };

function selectionWhere(sel: Selection): Prisma.ResumeImportWhereInput {
  return "ids" in sel ? { id: { in: sel.ids } } : {};
}

/** UPLOADED / FAILED → QUEUED. `register` also asks for registration after the parse. */
export async function queueImports(
  sel: Selection,
  register: boolean,
  adminUserId: string,
): Promise<number> {
  const res = await writeClient().resumeImport.updateMany({
    where: { ...selectionWhere(sel), status: { in: ["UPLOADED", "FAILED"] } },
    data: {
      status: "QUEUED",
      nextAttemptAt: null,
      leaseUntil: null,
      lastError: null,
      attempts: 0,
      ...(register ? { registerRequested: true, registeredByUserId: adminUserId } : {}),
    },
  });
  return res.count;
}

/** FAILED → QUEUED with a fresh attempt budget. */
export async function retryFailedImports(sel: Selection): Promise<number> {
  const res = await writeClient().resumeImport.updateMany({
    where: { ...selectionWhere(sel), status: "FAILED" },
    data: { status: "QUEUED", attempts: 0, nextAttemptAt: null, leaseUntil: null, lastError: null },
  });
  return res.count;
}

/** Mark PARSED rows for registration; the worker does the work. */
export async function requestRegistration(sel: Selection, adminUserId: string): Promise<number> {
  const res = await writeClient().resumeImport.updateMany({
    where: { ...selectionWhere(sel), status: "PARSED" },
    data: { registerRequested: true, registeredByUserId: adminUserId, lastError: null },
  });
  return res.count;
}

export type ResolveEmailResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_reviewable" | "duplicate" };

/** NEEDS_REVIEW (with a parsed document) → PARSED under the admin's chosen email. */
export async function resolveImportEmail(id: string, email: string): Promise<ResolveEmailResult> {
  const row = await prisma.resumeImport.findUnique({
    where: { id },
    select: { status: true, parsedData: true },
  });
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "NEEDS_REVIEW" || row.parsedData === null) {
    return { ok: false, reason: "not_reviewable" };
  }
  try {
    await writeClient().resumeImport.update({
      where: { id },
      data: { status: "PARSED", normalizedEmail: email, lastError: null },
      select: { id: true },
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, reason: "duplicate" };
    }
    throw error;
  }
}

/* ─── Admin reads ────────────────────────────────────────────────────────── */

export type ImportListRow = {
  id: string;
  originalFilename: string;
  sourceEmail: string | null;
  normalizedEmail: string | null;
  emailCandidates: string[];
  status: ResumeImportStatus;
  registerRequested: boolean;
  attempts: number;
  lastError: string | null;
  overallScore: number | null;
  costMicroUsd: number;
  linkedExisting: boolean;
  createdAt: Date;
};

export async function listImports(input: {
  status?: ResumeImportStatus;
  cursor?: string;
  take?: number;
}): Promise<{ rows: ImportListRow[]; nextCursor: string | null }> {
  const take = Math.min(Math.max(input.take ?? 100, 1), 200);
  const rows = await prisma.resumeImport.findMany({
    where: input.status ? { status: input.status } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      originalFilename: true,
      sourceEmail: true,
      normalizedEmail: true,
      emailCandidates: true,
      status: true,
      registerRequested: true,
      attempts: true,
      lastError: true,
      overallScore: true,
      costMicroUsd: true,
      linkedExisting: true,
      createdAt: true,
    },
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  return { rows: page, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null };
}

export async function countImportsByStatus(): Promise<Record<ResumeImportStatus, number>> {
  const groups = await prisma.resumeImport.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const out: Record<ResumeImportStatus, number> = {
    UPLOADED: 0,
    QUEUED: 0,
    PROCESSING: 0,
    PARSED: 0,
    NEEDS_REVIEW: 0,
    FAILED: 0,
    REGISTERED: 0,
    CLAIMED: 0,
  };
  for (const g of groups) out[g.status] = g._count._all;
  return out;
}

export type ImportUsageTotals = {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costMicroUsd: number;
  rateLimitedLastHour: number;
  parsedLastHour: number;
};

/** Actual usage of the import path, from `ResumeParseUsage`. */
export async function importUsageTotals(now: Date = new Date()): Promise<ImportUsageTotals> {
  const hourAgo = new Date(now.getTime() - 60 * 60_000);
  const [sum, limited, parsed] = await Promise.all([
    prisma.resumeParseUsage.aggregate({
      where: { source: "IMPORT" },
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, costMicroUsd: true },
    }),
    prisma.resumeParseUsage.count({
      where: { source: "IMPORT", outcome: "rate_limited", createdAt: { gte: hourAgo } },
    }),
    prisma.resumeImport.count({ where: { parsedAt: { gte: hourAgo } } }),
  ]);
  return {
    calls: sum._count._all,
    promptTokens: sum._sum.promptTokens ?? 0,
    completionTokens: sum._sum.completionTokens ?? 0,
    costMicroUsd: sum._sum.costMicroUsd ?? 0,
    rateLimitedLastHour: limited,
    parsedLastHour: parsed,
  };
}

/** Anything a worker could do right now or soon. */
export async function hasPendingImportWork(): Promise<boolean> {
  const n = await prisma.resumeImport.count({
    where: {
      OR: [
        { status: { in: ["QUEUED", "PROCESSING"] } },
        { status: "PARSED", registerRequested: true },
      ],
    },
  });
  return n > 0;
}

/* ─── Worker: leasing ────────────────────────────────────────────────────── */

export type LeasedParseJob = {
  id: string;
  blobPathname: string | null;
  originalFilename: string;
  attempts: number;
  registerRequested: boolean;
};

/** Take up to `n` due QUEUED rows. Each is PROCESSING with a 5-minute lease. */
export async function leaseParseJobs(n: number): Promise<LeasedParseJob[]> {
  if (n <= 0) return [];
  return writeClient().$queryRaw<LeasedParseJob[]>`
    UPDATE "ResumeImport"
       SET "status" = 'PROCESSING',
           "leaseUntil" = now() + (${LEASE_MS}::int * interval '1 millisecond'),
           "attempts" = "attempts" + 1,
           "updatedAt" = now()
     WHERE "id" IN (
       SELECT "id" FROM "ResumeImport"
        WHERE "status" = 'QUEUED'
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now())
        ORDER BY "createdAt"
        LIMIT ${n}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING "id", "blobPathname", "originalFilename", "attempts", "registerRequested"`;
}

/** Take up to `n` PARSED rows waiting for registration. The lease is the lock. */
export async function leaseRegisterJobs(n: number): Promise<{ id: string }[]> {
  if (n <= 0) return [];
  return writeClient().$queryRaw<{ id: string }[]>`
    UPDATE "ResumeImport"
       SET "leaseUntil" = now() + (${LEASE_MS}::int * interval '1 millisecond'),
           "updatedAt" = now()
     WHERE "id" IN (
       SELECT "id" FROM "ResumeImport"
        WHERE "status" = 'PARSED'
          AND "registerRequested" = true
          AND ("leaseUntil" IS NULL OR "leaseUntil" < now())
        ORDER BY "createdAt"
        LIMIT ${n}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING "id"`;
}

/** Leases whose worker died: PROCESSING goes back to QUEUED, PARSED is unlocked. */
export async function requeueStaleImports(): Promise<number> {
  const db = writeClient();
  const processing = await db.resumeImport.updateMany({
    where: { status: "PROCESSING", leaseUntil: { lt: new Date() } },
    data: { status: "QUEUED", leaseUntil: null },
  });
  await db.resumeImport.updateMany({
    where: { status: { not: "PROCESSING" }, leaseUntil: { lt: new Date() } },
    data: { leaseUntil: null },
  });
  return processing.count;
}

/* ─── Worker: outcomes ───────────────────────────────────────────────────── */

export async function addImportUsage(
  id: string,
  usage: { promptTokens: number; completionTokens: number; costMicroUsd: number; model: string },
): Promise<void> {
  await writeClient().resumeImport.update({
    where: { id },
    data: {
      promptTokens: { increment: usage.promptTokens },
      completionTokens: { increment: usage.completionTokens },
      costMicroUsd: { increment: usage.costMicroUsd },
      model: usage.model,
    },
    select: { id: true },
  });
}

function documentData(parsed: ParsedResume, analysis: ResumeAnalysis) {
  return {
    documentVersion: RESUME_DOCUMENT_VERSION,
    parsedData: resumeDocumentSchema.parse(parsed) as Prisma.InputJsonValue,
    analysis: resumeAnalysisSchema.parse(analysis) as Prisma.InputJsonValue,
    overallScore: analysis.overallScore,
    parsedAt: new Date(),
  };
}

/**
 * PARSED with a single email. If another open import already holds that email,
 * the partial unique index refuses it and the row goes to NEEDS_REVIEW instead —
 * the document is kept either way.
 */
export async function markImportParsed(
  id: string,
  input: {
    parsed: ParsedResume;
    analysis: ResumeAnalysis;
    sourceEmail: string;
    normalizedEmail: string;
    emailCandidates: string[];
  },
): Promise<"PARSED" | "NEEDS_REVIEW"> {
  const doc = documentData(input.parsed, input.analysis);
  const base = {
    ...doc,
    sourceEmail: input.sourceEmail,
    emailCandidates: input.emailCandidates,
    leaseUntil: null,
    nextAttemptAt: null,
  };
  try {
    await writeClient().resumeImport.update({
      where: { id },
      data: { ...base, status: "PARSED", normalizedEmail: input.normalizedEmail, lastError: null },
      select: { id: true },
    });
    return "PARSED";
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      await writeClient().resumeImport.update({
        where: { id },
        data: {
          ...base,
          status: "NEEDS_REVIEW",
          normalizedEmail: input.normalizedEmail,
          lastError: "Another import already uses this email.",
        },
        select: { id: true },
      });
      return "NEEDS_REVIEW";
    }
    throw error;
  }
}

/** NEEDS_REVIEW, keeping the parsed document so the admin can resolve it. */
export async function markImportNeedsReview(
  id: string,
  input: {
    reason: string;
    parsed?: ParsedResume;
    analysis?: ResumeAnalysis;
    sourceEmail?: string | null;
    emailCandidates?: string[];
  },
): Promise<void> {
  await writeClient().resumeImport.update({
    where: { id },
    data: {
      ...(input.parsed && input.analysis ? documentData(input.parsed, input.analysis) : {}),
      ...(input.sourceEmail !== undefined ? { sourceEmail: input.sourceEmail } : {}),
      ...(input.emailCandidates ? { emailCandidates: input.emailCandidates } : {}),
      status: "NEEDS_REVIEW",
      lastError: input.reason,
      leaseUntil: null,
      nextAttemptAt: null,
    },
    select: { id: true },
  });
}

/** Back to QUEUED, due at `at`. The lease is released so the slot frees now. */
export async function markImportRetry(id: string, at: Date, lastError: string): Promise<void> {
  await writeClient().resumeImport.update({
    where: { id },
    data: { status: "QUEUED", nextAttemptAt: at, leaseUntil: null, lastError },
    select: { id: true },
  });
}

export async function markImportFailed(id: string, lastError: string): Promise<void> {
  await writeClient().resumeImport.update({
    where: { id },
    data: { status: "FAILED", leaseUntil: null, nextAttemptAt: null, lastError },
    select: { id: true },
  });
}

/* ─── Registration / claim reads ─────────────────────────────────────────── */

export type ImportForRegistration = {
  id: string;
  status: ResumeImportStatus;
  normalizedEmail: string | null;
  originalFilename: string;
  fileSizeBytes: number;
  contentHash: string;
  blobPathname: string | null;
  parsedData: ParsedResume | null;
  analysis: ResumeAnalysis | null;
  overallScore: number | null;
  parsedAt: Date | null;
};

export async function getImportForRegistration(id: string): Promise<ImportForRegistration | null> {
  const row = await prisma.resumeImport.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      normalizedEmail: true,
      originalFilename: true,
      fileSizeBytes: true,
      contentHash: true,
      blobPathname: true,
      parsedData: true,
      analysis: true,
      overallScore: true,
      parsedAt: true,
      documentVersion: true,
    },
  });
  if (!row) return null;
  const { documentVersion, parsedData, analysis, ...rest } = row;
  return {
    ...rest,
    parsedData: readResumeDocument(parsedData, documentVersion),
    analysis: readResumeAnalysis(analysis),
  };
}

/* ─── The single-worker lease ────────────────────────────────────────────── */

/**
 * One `PlatformConfig` row holds the worker lease: `stringValue` is the ISO
 * expiry. Acquire / renew / release are compare-and-set on that value, so a
 * worker can only renew or release the lease it wrote. ISO-8601 UTC strings
 * compare correctly as text.
 */
const WORKER_LEASE_KEY = "resume_import.worker_lease";
const EPOCH_ISO = new Date(0).toISOString();

export async function acquireWorkerLease(ms: number): Promise<string | null> {
  const db = writeClient();
  const now = new Date();
  const expiry = new Date(now.getTime() + ms).toISOString();
  const res = await db.platformConfig.updateMany({
    where: {
      key: WORKER_LEASE_KEY,
      OR: [{ stringValue: null }, { stringValue: { lt: now.toISOString() } }],
    },
    data: { stringValue: expiry },
  });
  if (res.count === 1) return expiry;

  const exists = await db.platformConfig.findUnique({
    where: { key: WORKER_LEASE_KEY },
    select: { key: true },
  });
  if (exists) return null;
  try {
    await db.platformConfig.create({
      data: {
        key: WORKER_LEASE_KEY,
        stringValue: expiry,
        description:
          "Plan 154 résumé-import worker lease (ISO expiry). Managed by code; do not edit.",
      },
      select: { key: true },
    });
    return expiry;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }
    throw error;
  }
}

/** Extend a lease we hold. Returns the new token, or null if we lost it. */
export async function renewWorkerLease(token: string, ms: number): Promise<string | null> {
  const expiry = new Date(Date.now() + ms).toISOString();
  const res = await writeClient().platformConfig.updateMany({
    where: { key: WORKER_LEASE_KEY, stringValue: token },
    data: { stringValue: expiry },
  });
  return res.count === 1 ? expiry : null;
}

export async function releaseWorkerLease(token: string): Promise<void> {
  await writeClient().platformConfig.updateMany({
    where: { key: WORKER_LEASE_KEY, stringValue: token },
    data: { stringValue: EPOCH_ISO },
  });
}

export async function isWorkerLeaseLive(): Promise<boolean> {
  const row = await prisma.platformConfig.findUnique({
    where: { key: WORKER_LEASE_KEY },
    select: { stringValue: true },
  });
  return Boolean(row?.stringValue && row.stringValue > new Date().toISOString());
}

/* ─── Registration / claim writes ────────────────────────────────────────── */

/** Registration will not be retried automatically; the admin sees why. */
export async function clearRegisterRequest(id: string, lastError: string | null): Promise<void> {
  await writeClient().resumeImport.update({
    where: { id },
    data: { registerRequested: false, leaseUntil: null, lastError },
    select: { id: true },
  });
}

/**
 * PARSED → REGISTERED / CLAIMED inside the caller's transaction. Conditional on
 * the row still being PARSED, so two workers can never register it twice; the
 * caller rolls back when this returns false.
 */
export async function markImportRegisteredTx(
  tx: Prisma.TransactionClient,
  id: string,
  input: {
    status: "REGISTERED" | "CLAIMED";
    userId: string;
    linkedExisting: boolean;
    /** The document now lives in CandidateResume — drop the copy. */
    clearDocument: boolean;
  },
): Promise<boolean> {
  const now = new Date();
  const res = await tx.resumeImport.updateMany({
    where: { id, status: "PARSED" },
    data: {
      status: input.status,
      registeredUserId: input.userId,
      registeredAt: now,
      ...(input.status === "CLAIMED" ? { claimedAt: now } : {}),
      linkedExisting: input.linkedExisting,
      registerRequested: false,
      leaseUntil: null,
      lastError: null,
      ...(input.clearDocument ? { parsedData: Prisma.DbNull, analysis: Prisma.DbNull } : {}),
    },
  });
  return res.count === 1;
}

/** Is this user an admin-registered, not-yet-claimed import? */
export async function hasUnclaimedImportForUser(
  userId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const n = await db.resumeImport.count({
    where: { registeredUserId: userId, status: "REGISTERED" },
  });
  return n > 0;
}

/** REGISTERED → CLAIMED for this user. Returns how many rows moved (0 or 1). */
export async function claimRegisteredImportTx(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<number> {
  const res = await tx.resumeImport.updateMany({
    where: { registeredUserId: userId, status: "REGISTERED" },
    data: { status: "CLAIMED", claimedAt: new Date() },
  });
  return res.count;
}

/** The single PARSED (not yet registered) import for an email, if exactly one. */
export async function findParsedImportIdByEmail(email: string): Promise<string | null> {
  const rows = await prisma.resumeImport.findMany({
    where: { normalizedEmail: email, status: "PARSED" },
    select: { id: true },
    take: 2,
  });
  return rows.length === 1 ? rows[0]!.id : null;
}

/** Of these users, which are admin-imported and not yet claimed (recruiter badge). */
export async function listUnclaimedImportUserIds(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await prisma.resumeImport.findMany({
    where: { registeredUserId: { in: userIds }, status: "REGISTERED" },
    select: { registeredUserId: true },
  });
  return new Set(rows.map((r) => r.registeredUserId).filter((id): id is string => id !== null));
}
