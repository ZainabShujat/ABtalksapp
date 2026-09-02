/**
 * Row → `ResumeView`: the boundary the stored document does not cross.
 *
 * The profile page never sees `parsedData` or `analysis` as stored. It sees the
 * shape below — no extraction metadata, no model or agent names, no blob URLs,
 * no scoring internals. That is the difference between a résumé section and a
 * debugging interface.
 *
 * Note what is NOT here: the candidate's experience, education, projects and
 * skills. Those are merged into the profile's own sections by
 * `features/resume/merge/` and rendered there, by the components that
 * already existed. Repeating them inside the résumé card would be a second,
 * read-only copy of the profile sitting next to the editable one.
 *
 * The same rule applies to the score. `analysis` holds seven category scores,
 * a strengths list and a full weaknesses list; the view exposes the overall
 * number, its band, and the two or three things worth fixing. The rest stays
 * server-side — it is real, it is stored, and it is simply not what a candidate
 * reading their own profile needs.
 *
 * Pure, so the test file can exercise it without a database.
 */
import { SECTION_LABELS, type MergeSection } from "@/features/resume/merge/plan";
import type { ParsedResume, ResumeAnalysis, ResumeView } from "@/features/resume/types";
import { scoreBand } from "@/features/resume/strength";

/** Structural, so this file stays free of the server-only repository module. */
export type ResumeViewInput = {
  sourceType: "UPLOAD" | "URL";
  sourceUrl: string | null;
  blobPathname: string | null;
  fileName: string | null;
  status: "PENDING" | "PROCESSING" | "READY" | "FAILED";
  failureReason: string | null;
  parsedData: ParsedResume | null;
  analysis: ResumeAnalysis | null;
  appliedSections: MergeSection[];
  updatedAt: Date;
};

export function toResumeView(row: ResumeViewInput): ResumeView {
  const analysis = row.analysis;

  // PENDING is an internal step; to the candidate it reads as processing.
  // A READY row whose stored document failed read validation is not READY to a
  // reader — it degrades rather than rendering a score with nothing behind it.
  const status: ResumeView["status"] =
    row.status === "READY" && row.parsedData !== null && analysis !== null
      ? "READY"
      : row.status === "FAILED"
        ? "FAILED"
        : row.status === "READY"
          ? "FAILED"
          : "PROCESSING";

  const strength =
    analysis && status === "READY"
      ? {
          overallScore: analysis.overallScore,
          band: scoreBand(analysis.overallScore),
          // Capped at three. The scorer emits up to five, ordered worst-first
          // by the category rules that fired; a candidate acts on two or three,
          // and a longer list reads as a report rather than as advice.
          tips: analysis.recommendations.slice(0, 3),
        }
      : null;

  return {
    status,
    sourceType: row.sourceType,
    fileName: row.fileName,
    sourceUrl: row.sourceUrl,
    downloadPath: row.blobPathname ? "/api/profile/resume/file" : null,
    updatedAtIso: row.updatedAt.toISOString(),
    failureReason:
      status === "FAILED"
        ? (row.failureReason ??
          "We could not read this résumé any more. Please upload it again.")
        : null,
    strength,
    addedToProfile:
      status === "READY"
        ? row.appliedSections.map((s) => SECTION_LABELS[s]).filter(Boolean)
        : [],
  };
}
