import "server-only";
import type { EvidenceSourceType } from "@prisma/client";

/**
 * The single write path for `SkillEvidence`.
 *
 * Idempotent on (`sourceType`, `sourceKey`, `skillId`) per candidate. That is
 * the existing `@@unique([candidateSkillId, sourceType, sourceId])` on the
 * model: `CandidateSkill` is itself unique on (`userId`, `skillId`), so
 * `candidateSkillId` is a bijection for that pair. No schema change is needed
 * to make this key hold.
 *
 * STUB — T-146 day 1. This no-ops so the assessment, interview, cohort and
 * hackathon emitters can be written against a frozen signature before the
 * write exists. The upsert, the `CandidateSkill` cache recompute
 * (`evidenceScore` / `verified` / `evidenceCount` / `lastEvidenceAt`) and an
 * optional transaction-client parameter land with those consumers.
 * `prisma/scripts/migrate-2i-achievements.ts` is the reference implementation.
 */

export type EmitSkillEvidenceInput = {
  userId: string;
  /**
   * A `Skill.id`, never a typed name. Callers holding a name resolve it with
   * `resolveOrCreateSkill` FIRST — that helper uses the global client, so
   * resolving here would escape a caller's transaction.
   */
  skillId: string;
  sourceType: EvidenceSourceType;
  /**
   * Idempotency key, persisted to `SkillEvidence.sourceId`. Must be stable
   * across re-evaluation: the id of the row that caused the evidence
   * (`AssessmentScore.id`, `ActivityEvaluation.id`), never a timestamp.
   */
  sourceKey: string;
  /** Recruiter-visible provenance, e.g. "Databricks Assessment". Non-null column. */
  sourceLabel: string;
  /** The domain event time, never insert time. Non-null column, no default. */
  occurredAt: Date;
  /** Absent where the source has no score — a passed cohort mission, a hackathon result. */
  score?: number | null;
  maxScore?: number | null;
  /** 1–10. `ActivitySkill.weight` for cohort activities. Defaults to 1 on write. */
  weight?: number;
};

export async function emitSkillEvidence(
  input: EmitSkillEvidenceInput,
): Promise<void> {
  void input;
}
