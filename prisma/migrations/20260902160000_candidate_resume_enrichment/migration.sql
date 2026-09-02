-- Plan 106 follow-up: version the résumé document and record profile enrichment.
-- Additive only.

ALTER TABLE "CandidateResume" ADD COLUMN "documentVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CandidateResume" ADD COLUMN "appliedAt" TIMESTAMP(3);
ALTER TABLE "CandidateResume" ADD COLUMN "appliedSections" TEXT[] DEFAULT ARRAY[]::TEXT[];
