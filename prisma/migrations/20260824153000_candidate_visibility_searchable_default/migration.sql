-- Additive only. Does not rewrite existing CandidateVisibility rows.
-- Production Phase 1 created this column as DEFAULT false; new candidate rows
-- should be recruiter-searchable by platform default.

ALTER TABLE "CandidateVisibility"
  ALTER COLUMN "searchableByRecruiters" SET DEFAULT true;
