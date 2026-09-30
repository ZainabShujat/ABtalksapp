-- Years of experience a job asks for, shown to candidates as a "2+ years" pill.
-- Additive, nullable, no default: every existing row reads NULL and renders
-- nothing, so no backfill and zero downtime.

ALTER TABLE "Job" ADD COLUMN "minExperience" INTEGER;
