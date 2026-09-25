import "server-only";
import type { ResumeImportStatus } from "@prisma/client";
import {
  countImportsByStatus,
  importUsageTotals,
  isWorkerLeaseLive,
  listImports,
  type ImportUsageTotals,
} from "@/repositories/resume-import";

/**
 * What the admin résumé-import page shows (plan 154). Plain module, NOT a
 * "use server" file: an exported function there becomes a callable action, and
 * this one has no guard of its own — callers (the page, the polled action)
 * check `requireAdmin` / `getAdminContext` first.
 *
 * Never includes the parsed document or the analysis.
 */

/** The attestation an admin confirms before registering imported students. */
export const CONSENT_ATTESTATION =
  "These students agreed to ABTalks creating their profile from their résumé and showing it to recruiters.";

export type ImportRowView = {
  id: string;
  originalFilename: string;
  email: string | null;
  emailCandidates: string[];
  status: ResumeImportStatus;
  registerRequested: boolean;
  attempts: number;
  lastError: string | null;
  overallScore: number | null;
  costMicroUsd: number;
  linkedExisting: boolean;
  createdAtIso: string;
};

export type ImportStatusView = {
  rows: ImportRowView[];
  nextCursor: string | null;
  counts: Record<ResumeImportStatus, number>;
  usage: ImportUsageTotals;
  workerRunning: boolean;
};

export async function loadImportStatus(input: {
  status?: ResumeImportStatus;
  cursor?: string;
}): Promise<ImportStatusView> {
  const [list, counts, usage, workerRunning] = await Promise.all([
    listImports({ status: input.status, cursor: input.cursor, take: 100 }),
    countImportsByStatus(),
    importUsageTotals(),
    isWorkerLeaseLive(),
  ]);
  return {
    rows: list.rows.map((r) => ({
      id: r.id,
      originalFilename: r.originalFilename,
      email: r.normalizedEmail ?? r.sourceEmail,
      emailCandidates: r.emailCandidates,
      status: r.status,
      registerRequested: r.registerRequested,
      attempts: r.attempts,
      lastError: r.lastError,
      overallScore: r.overallScore,
      costMicroUsd: r.costMicroUsd,
      linkedExisting: r.linkedExisting,
      createdAtIso: r.createdAt.toISOString(),
    })),
    nextCursor: list.nextCursor,
    counts,
    usage,
    workerRunning,
  };
}
