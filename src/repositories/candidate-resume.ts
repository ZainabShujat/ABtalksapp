import "server-only";
import { Prisma, type ResumeSourceType } from "@prisma/client";
import { prisma, writeClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  RESUME_DOCUMENT_VERSION,
  readResumeAnalysis,
  readResumeDocument,
  resumeAnalysisSchema,
  resumeDocumentSchema,
} from "@/features/resume/document";
import type { MergeDecision, MergeSection } from "@/features/resume/merge/plan";
import type { ParsedResume, ResumeAnalysis } from "@/features/resume/types";

/**
 * The only reader and writer of `CandidateResume`.
 *
 * `CandidateResume` is a new 078-era table with no legacy counterpart, so
 * nothing here branches on `ENABLE_NEW_CANDIDATE` — it is canonical by
 * construction. The one legacy touchpoint is `CandidateProfile.resumeUrl` /
 * `StudentProfile.resumeUrl`, which stay exactly as they were and are mirrored
 * by `syncResumeUrl` so every existing reader (hire dossiers, admin, the
 * interview résumé context) keeps seeing the link it always saw.
 *
 * Every query is scoped by `userId` and every row is unique on `userId`, so
 * there is no path by which one candidate's résumé can be read through
 * another's session.
 */

export type ResumeRow = {
  userId: string;
  sourceType: ResumeSourceType;
  sourceUrl: string | null;
  blobPathname: string | null;
  fileName: string | null;
  fileType: string | null;
  fileSizeBytes: number | null;
  contentHash: string | null;
  status: "PENDING" | "PROCESSING" | "READY" | "FAILED";
  failureReason: string | null;
  parsedData: ParsedResume | null;
  analysis: ResumeAnalysis | null;
  overallScore: number | null;
  parsedAt: Date | null;
  appliedAt: Date | null;
  appliedSections: MergeSection[];
  updatedAt: Date;
};

const SELECT = {
  userId: true,
  sourceType: true,
  sourceUrl: true,
  blobPathname: true,
  fileName: true,
  fileType: true,
  fileSizeBytes: true,
  contentHash: true,
  status: true,
  failureReason: true,
  documentVersion: true,
  parsedData: true,
  analysis: true,
  overallScore: true,
  parsedAt: true,
  appliedAt: true,
  appliedSections: true,
  updatedAt: true,
} as const;

type RawRow = Prisma.CandidateResumeGetPayload<{ select: typeof SELECT }>;

/**
 * Validated on READ, not cast.
 *
 * `InterviewReport` and `MockInterviewReport` both re-validate their document on
 * the way out, and for the same reason: a row written by an older deploy, or by
 * a migration, must degrade to "we cannot show this" rather than render half a
 * page from a shape nothing checked. A document that fails becomes `null`, which
 * the view renders as the empty state and a re-upload repairs.
 */
function toRow(row: RawRow): ResumeRow {
  const parsedData = readResumeDocument(row.parsedData, row.documentVersion);
  if (row.parsedData !== null && parsedData === null) {
    logger.warn("[resume] stored document failed validation", {
      userId: row.userId,
      documentVersion: row.documentVersion,
    });
  }
  const { documentVersion: _v, ...rest } = row;
  void _v;
  return {
    ...rest,
    parsedData,
    analysis: readResumeAnalysis(row.analysis),
    appliedSections: row.appliedSections as MergeSection[],
  };
}

export async function getResumeRow(userId: string): Promise<ResumeRow | null> {
  const row = await prisma.candidateResume.findUnique({
    where: { userId },
    select: SELECT,
  });
  return row ? toRow(row) : null;
}

export type ResumeUpsert = {
  sourceType: ResumeSourceType;
  sourceUrl: string | null;
  blobPathname: string | null;
  fileName: string | null;
  fileType: string | null;
  fileSizeBytes: number | null;
  contentHash: string | null;
  status: "PENDING" | "PROCESSING" | "READY" | "FAILED";
  failureReason: string | null;
  parsedData: ParsedResume | null;
  analysis: ResumeAnalysis | null;
  overallScore: number | null;
  parsedAt: Date | null;
};

export async function upsertResume(
  userId: string,
  input: ResumeUpsert,
): Promise<ResumeRow> {
  // Validated on WRITE as well as on read — the other half of the
  // `InterviewReport` contract. `.parse` throws rather than storing a document
  // no reader will accept; the caller turns that into a FAILED row.
  //
  // A nullable Json column takes `Prisma.DbNull` to mean SQL NULL — a bare
  // `null` is rejected, because in JSON it is ambiguous with the JSON value
  // `null`. Both fields are cleared on every non-READY write, so this path is
  // hit constantly and cannot be left to a cast.
  const data = {
    ...input,
    documentVersion: RESUME_DOCUMENT_VERSION,
    parsedData:
      input.parsedData === null
        ? Prisma.DbNull
        : (resumeDocumentSchema.parse(input.parsedData) as Prisma.InputJsonValue),
    analysis:
      input.analysis === null
        ? Prisma.DbNull
        : (resumeAnalysisSchema.parse(input.analysis) as Prisma.InputJsonValue),
  };

  const row = await writeClient().candidateResume.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
    select: SELECT,
  });
  return toRow(row);
}

/**
 * Records what the merge did: which sections it contributed to, and the
 * per-entry decisions behind that. The log is for debugging a bad merge and is
 * never read by the UI.
 */
export async function markMergeApplied(
  userId: string,
  sections: MergeSection[],
  decisions: MergeDecision[],
): Promise<void> {
  await writeClient().candidateResume.updateMany({
    where: { userId },
    data: {
      appliedAt: new Date(),
      appliedSections: sections,
      mergeLog: decisions as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function deleteResume(userId: string): Promise<void> {
  await writeClient().candidateResume.deleteMany({ where: { userId } });
}

/**
 * Keeps the pre-existing résumé link in step with the résumé section.
 *
 * `CandidateProfile.resumeUrl` is canonical and `StudentProfile.resumeUrl` is
 * its legacy mirror — the same pair, written the same way, as `saveLinks` in
 * `candidate-detail.ts`. `updateMany` rather than `update` because a candidate
 * may have no `StudentProfile` row at all.
 */
export async function syncResumeUrl(
  userId: string,
  resumeUrl: string | null,
): Promise<void> {
  const db = writeClient();
  await db.$transaction([
    db.candidateProfile.updateMany({ where: { userId }, data: { resumeUrl } }),
    db.studentProfile.updateMany({ where: { userId }, data: { resumeUrl } }),
  ]);
}
