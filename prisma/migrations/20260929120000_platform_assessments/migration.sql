-- Plan 166: platform (admin-authored) assessments on the recruiter
-- assessment engine. Additive only: every existing row becomes
-- source = RECRUITER with its organizationId untouched, so recruiter reads
-- (all filtered on organizationId) behave exactly as before.

-- CreateEnum
CREATE TYPE "AssessmentSource" AS ENUM ('RECRUITER', 'PLATFORM');

-- AlterEnum
ALTER TYPE "AssessmentEndReason" ADD VALUE 'DEADLINE';

-- AlterTable
ALTER TABLE "RecruiterAssessment" ALTER COLUMN "organizationId" DROP NOT NULL;
ALTER TABLE "RecruiterAssessment" ADD COLUMN "source" "AssessmentSource" NOT NULL DEFAULT 'RECRUITER';
ALTER TABLE "RecruiterAssessment" ADD COLUMN "deadlineAt" TIMESTAMP(3);
ALTER TABLE "RecruiterAssessment" ADD COLUMN "audienceAll" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RecruiterAssessment" ADD COLUMN "audienceDomains" "Domain"[] DEFAULT ARRAY[]::"Domain"[];
ALTER TABLE "RecruiterAssessment" ADD COLUMN "audienceWorkshopEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- A platform row must have no organization; a recruiter row must have one.
ALTER TABLE "RecruiterAssessment" ADD CONSTRAINT "RecruiterAssessment_source_org_check"
  CHECK (("source" = 'PLATFORM' AND "organizationId" IS NULL)
      OR ("source" = 'RECRUITER' AND "organizationId" IS NOT NULL));

-- CreateIndex
CREATE INDEX "RecruiterAssessment_source_updatedAt_idx" ON "RecruiterAssessment"("source", "updatedAt" DESC);
