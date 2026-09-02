-- Plan 106 follow-up: per-entry merge decisions, for debugging a bad merge.
-- Additive only.

ALTER TABLE "CandidateResume" ADD COLUMN "mergeLog" JSONB;
