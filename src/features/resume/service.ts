import "server-only";
import { createHash } from "node:crypto";
import { logger } from "@/lib/logger";
import {
  deleteResume,
  getResumeRow,
  markMergeApplied,
  syncResumeUrl,
  upsertResume,
  type ResumeRow,
} from "@/repositories/candidate-resume";
import { getCandidateDetail } from "@/repositories/candidate-detail";
import { applyResumeMergeSafely } from "@/repositories/candidate-merge";
import { planResumeMerge } from "@/features/resume/merge/plan";
import {
  fetchResumeFromUrl,
  validateResumeBytes,
} from "@/features/resume/ingest";
import { looksLikeResume } from "@/features/resume/normalize";
import { parseResumeDocument } from "@/features/resume/parse";
import { analyseResumeStrength, STRENGTH_VERSION } from "@/features/resume/strength";
import { deleteResumeFile, storeResumeFile } from "@/features/resume/storage";
import { toResumeView } from "@/features/resume/view";
import type {
  ParsedResume as ParsedResumeInput,
  ResumeView,
} from "@/features/resume/types";

/**
 * Orchestration: ingest → parse → score → persist, and the rule that keeps this
 * affordable.
 *
 * **Parsing happens on change, never on read.** `getResumeView` is a single
 * indexed row read and calls no model. A save re-parses only when the document
 * bytes are actually different: the sha256 of the content is stored, and an
 * upload or link fetch that hashes to the stored value reuses the stored
 * `parsedData` and `analysis` verbatim. Re-saving the same Drive link, or
 * re-uploading the same file after editing an unrelated profile section, costs
 * one hash and one row update.
 *
 * The one exception is a change in `STRENGTH_VERSION`: the résumé is unchanged
 * but the rules that scored it are not, so the analysis is recomputed from the
 * cached `parsedData` — still without touching the model.
 *
 * The last step of a successful run is the merge: `features/resume/merge/`
 * compares the structured résumé against the profile as it stands and adds
 * what is genuinely new, through the profile's own tables. Ingestion,
 * extraction, scoring and merging are four separate modules and none of them
 * reaches into another. From the candidate's side there is no step to see at
 * all — they attach a résumé and their profile fills in.
 */

export type ResumeResult =
  | { ok: true; data: ResumeView }
  | { ok: false; message: string };

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function view(row: ResumeRow): ResumeView {
  return toResumeView(row);
}

/** Read path. No model call, no network — see the note above. */
export async function getResumeView(userId: string): Promise<ResumeView | null> {
  const row = await getResumeRow(userId);
  return row ? view(row) : null;
}

type Source =
  | { kind: "UPLOAD"; fileName: string | null }
  | { kind: "URL"; url: string };

/**
 * What a save should do to `CandidateProfile.resumeUrl`.
 *
 * `"keep"` is the important case. `resumeUrl` is a candidate-entered link that
 * predates this feature and is read by `/hire` dossiers, the admin student page
 * and the interview résumé context. Uploading a PDF used to pass `null` into
 * `syncResumeUrl`, which silently wiped it — the candidate attached a file and
 * lost a link they had typed, which is exactly what the merge rules elsewhere
 * promise never to do.
 *
 * So: a URL save writes that URL, an upload leaves the field alone, and only an
 * explicit removal clears it — and even then only when the résumé being removed
 * IS the link. Removing an uploaded PDF must not take a separately-entered link
 * with it.
 *
 * Pure, so the rule is unit-tested rather than inferred from a call site.
 */
export function resumeUrlAction(
  source: { kind: "UPLOAD" | "URL"; url?: string | null },
): { write: string } | { keep: true } {
  if (source.kind === "URL" && source.url) return { write: source.url };
  return { keep: true };
}

/** The same rule for a removal: clear the link only if the résumé WAS the link. */
export function resumeUrlActionOnRemove(
  existingSourceType: "UPLOAD" | "URL" | null,
): { clear: true } | { keep: true } {
  return existingSourceType === "URL" ? { clear: true } : { keep: true };
}

/** Applies `resumeUrlAction` — never writes null, so an upload cannot wipe a link. */
async function syncResumeUrlForSave(userId: string, source: Source): Promise<void> {
  const action = resumeUrlAction(
    source.kind === "URL" ? { kind: "URL", url: source.url } : { kind: "UPLOAD" },
  );
  if ("write" in action) await syncResumeUrl(userId, action.write);
}

/**
 * The shared tail of both entry points: everything from "we have validated
 * bytes" to "the row is READY".
 */
async function processDocument(
  userId: string,
  bytes: Uint8Array,
  mimeType: string,
  source: Source,
): Promise<ResumeResult> {
  const contentHash = sha256(bytes);
  const existing = await getResumeRow(userId);
  const fileName = source.kind === "UPLOAD" ? source.fileName : null;
  const sourceUrl = source.kind === "URL" ? source.url : null;

  const base = {
    sourceType: source.kind,
    sourceUrl,
    fileName: fileName ?? existingFileNameFor(existing, contentHash),
    fileType: mimeType,
    fileSizeBytes: bytes.length,
    contentHash,
  } as const;

  // ── Unchanged document: reuse, do not re-parse ──────────────────────────
  if (
    existing?.status === "READY" &&
    existing.contentHash === contentHash &&
    existing.parsedData
  ) {
    const analysis =
      existing.analysis && existing.analysis.version === STRENGTH_VERSION
        ? existing.analysis
        : analyseResumeStrength(existing.parsedData);

    // The document is unchanged, but the FILE may still be missing: the row
    // may have been written while blob storage was unconfigured, or a previous
    // upload may have failed to store. Backfill it here, otherwise re-uploading
    // the same PDF can never repair it — the hash matches, so this branch is
    // the only one that runs, and it used to carry the null straight through.
    const blobPathname =
      existing.blobPathname ??
      (await storeResumeFile({ userId, contentHash, bytes, mimeType }));

    const row = await upsertResume(userId, {
      ...base,
      blobPathname,
      status: "READY",
      failureReason: null,
      parsedData: existing.parsedData,
      analysis,
      overallScore: analysis.overallScore,
      parsedAt: existing.parsedAt,
    });
    await syncResumeUrlForSave(userId, source);
    return { ok: true, data: view(row) };
  }

  // ── Changed document: store, parse, score ───────────────────────────────
  await upsertResume(userId, {
    ...base,
    blobPathname: existing?.blobPathname ?? null,
    status: "PROCESSING",
    failureReason: null,
    parsedData: null,
    analysis: null,
    overallScore: null,
    parsedAt: null,
  });

  const blobPathname = await storeResumeFile({
    userId,
    contentHash,
    bytes,
    mimeType,
  });

  // The previous file is only removed once the new one is in place, so a failed
  // upload never leaves the candidate with neither.
  if (existing?.blobPathname && existing.blobPathname !== blobPathname) {
    await deleteResumeFile(existing.blobPathname);
  }

  const parsed = await parseResumeDocument({ bytes, mimeType, fileName });
  if (!parsed.ok) {
    await markFailed(userId, base, blobPathname, parsed.message);
    return { ok: false, message: parsed.message };
  }

  if (!looksLikeResume(parsed.data)) {
    const message =
      "That document does not look like a résumé. Please upload the PDF of your résumé or CV.";
    await markFailed(userId, base, blobPathname, message);
    return { ok: false, message };
  }

  const analysis = analyseResumeStrength(parsed.data);

  const row = await upsertResume(userId, {
    ...base,
    blobPathname,
    status: "READY",
    failureReason: null,
    parsedData: parsed.data,
    analysis,
    overallScore: analysis.overallScore,
    parsedAt: new Date(),
  });
  await syncResumeUrlForSave(userId, source);

  const applied = await mergeIntoProfile(userId, parsed.data);

  logger.info("[resume] processed", {
    userId,
    source: source.kind,
    score: analysis.overallScore,
    enriched: applied,
  });
  // Re-read so the returned view carries what was just filled in.
  const fresh = (await getResumeRow(userId)) ?? row;
  return { ok: true, data: view(fresh) };
}

/**
 * Merge the structured résumé into the profile.
 *
 * Additive by construction — see `features/resume/merge/plan.ts`. It runs after
 * the résumé row is already READY and cannot fail the upload: a candidate whose
 * profile could not be merged still gets their résumé and their score.
 */
async function mergeIntoProfile(userId: string, parsed: ParsedResumeInput) {
  const detail = await getCandidateDetail(userId);
  if (!detail) return [];
  const plan = planResumeMerge(parsed, detail);
  if (plan.sections.length === 0) return [];
  const applied = await applyResumeMergeSafely(userId, plan);
  if (applied.length > 0) await markMergeApplied(userId, applied, plan.decisions);
  return applied;
}

/** Keeps the stored filename when a link fetch re-sends the same document. */
function existingFileNameFor(
  existing: ResumeRow | null,
  contentHash: string,
): string | null {
  return existing?.contentHash === contentHash ? existing.fileName : null;
}

async function markFailed(
  userId: string,
  base: {
    sourceType: "UPLOAD" | "URL";
    sourceUrl: string | null;
    fileName: string | null;
    fileType: string;
    fileSizeBytes: number;
    contentHash: string;
  },
  blobPathname: string | null,
  message: string,
): Promise<void> {
  await upsertResume(userId, {
    ...base,
    blobPathname,
    status: "FAILED",
    failureReason: message,
    parsedData: null,
    analysis: null,
    overallScore: null,
    parsedAt: null,
  });
}

/* ─── Entry points ───────────────────────────────────────────────────────── */

export async function saveResumeUpload(
  userId: string,
  file: { bytes: Uint8Array; fileName: string | null },
): Promise<ResumeResult> {
  const valid = validateResumeBytes(file.bytes, file.fileName);
  if (!valid.ok) return { ok: false, message: valid.message };

  return processDocument(userId, file.bytes, "application/pdf", {
    kind: "UPLOAD",
    fileName: file.fileName,
  });
}

export async function saveResumeLink(
  userId: string,
  url: string,
): Promise<ResumeResult> {
  const fetched = await fetchResumeFromUrl(url);
  if (!fetched.ok) {
    // The link is still saved as the candidate's résumé URL — it was already
    // allowed to be an unparsed link before this feature existed, and removing
    // that on a fetch failure would be a regression.
    await syncResumeUrl(userId, url);
    await upsertResume(userId, {
      sourceType: "URL",
      sourceUrl: url,
      blobPathname: null,
      fileName: null,
      fileType: null,
      fileSizeBytes: null,
      contentHash: null,
      status: "FAILED",
      failureReason: fetched.message,
      parsedData: null,
      analysis: null,
      overallScore: null,
      parsedAt: null,
    });
    return { ok: false, message: fetched.message };
  }

  return processDocument(userId, fetched.data.bytes, fetched.data.mimeType, {
    kind: "URL",
    url,
  });
}

export async function removeResume(userId: string): Promise<void> {
  const existing = await getResumeRow(userId);
  if (existing?.blobPathname) await deleteResumeFile(existing.blobPathname);
  await deleteResume(userId);

  const action = resumeUrlActionOnRemove(existing?.sourceType ?? null);
  if ("clear" in action) await syncResumeUrl(userId, null);
}

/** Owner-scoped blob lookup for the download route. Never takes a path. */
export async function getOwnResumeFilePath(
  userId: string,
): Promise<{ pathname: string; fileName: string } | null> {
  const row = await getResumeRow(userId);
  if (!row?.blobPathname) return null;
  return {
    pathname: row.blobPathname,
    fileName: row.fileName ?? "resume.pdf",
  };
}
