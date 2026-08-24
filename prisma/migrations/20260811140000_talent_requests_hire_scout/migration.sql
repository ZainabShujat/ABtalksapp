-- Hire / Scout: additive tables + optional recruiter visibility consent column.
-- CREATE / ALTER ADD only. No DROP.

-- AlterTable: ProgramMember recruiter opt-in (null = not visible to Scout)
ALTER TABLE "ProgramMember" ADD COLUMN IF NOT EXISTS "recruiterVisibilityConsentAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "TalentRequestStatus" AS ENUM ('DRAFT', 'ACTIVE', 'MATCHED', 'FULFILLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TalentWorkMode" AS ENUM ('ONSITE', 'HYBRID', 'REMOTE', 'FLEXIBLE');

-- CreateEnum
CREATE TYPE "TalentEmploymentType" AS ENUM ('FULL_TIME', 'CONTRACT', 'INTERNSHIP', 'PART_TIME');

-- CreateEnum
CREATE TYPE "TalentSeniority" AS ENUM ('INTERN', 'JUNIOR', 'MID', 'SENIOR', 'LEAD');

-- CreateEnum
CREATE TYPE "TalentMatchTier" AS ENUM ('STRONG', 'PARTIAL', 'NONE');

-- CreateTable
CREATE TABLE "TalentRequest" (
    "id" TEXT NOT NULL,
    "recruiterUserId" TEXT NOT NULL,
    "status" "TalentRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "seniority" "TalentSeniority",
    "openings" INTEGER NOT NULL DEFAULT 1,
    "mustHaveStack" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "niceToHaveStack" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidencePriority" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "salaryCurrency" TEXT NOT NULL DEFAULT 'INR',
    "salaryPeriod" TEXT NOT NULL DEFAULT 'ANNUAL',
    "workMode" "TalentWorkMode",
    "locationCity" TEXT,
    "employmentType" "TalentEmploymentType",
    "noticePeriodDays" INTEGER,
    "minExperience" INTEGER,
    "maxExperience" INTEGER,
    "requiresDegree" BOOLEAN NOT NULL DEFAULT false,
    "extra" JSONB,
    "alertWhenAvailable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TalentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentRequestMessage" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "options" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TalentRequestMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentRequestMatch" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "programMemberId" TEXT,
    "studentUserId" TEXT,
    "score" INTEGER NOT NULL,
    "tier" "TalentMatchTier" NOT NULL,
    "scoreBreakdown" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "rationale" TEXT,
    "gaps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "availabilityUnknown" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TalentRequestMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateAvailability" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openToWork" BOOLEAN NOT NULL DEFAULT false,
    "expectedSalaryMin" INTEGER,
    "expectedSalaryMax" INTEGER,
    "salaryCurrency" TEXT NOT NULL DEFAULT 'INR',
    "noticePeriodDays" INTEGER,
    "preferredWorkMode" "TalentWorkMode",
    "preferredCities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "openToRelocate" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TalentRequest_recruiterUserId_createdAt_idx" ON "TalentRequest"("recruiterUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "TalentRequest_status_createdAt_idx" ON "TalentRequest"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "TalentRequestMessage_requestId_createdAt_idx" ON "TalentRequestMessage"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "TalentRequestMatch_requestId_score_idx" ON "TalentRequestMatch"("requestId", "score" DESC);

-- CreateIndex
CREATE INDEX "TalentRequestMatch_programMemberId_idx" ON "TalentRequestMatch"("programMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateAvailability_userId_key" ON "CandidateAvailability"("userId");

-- CreateIndex
CREATE INDEX "CandidateAvailability_openToWork_updatedAt_idx" ON "CandidateAvailability"("openToWork", "updatedAt" DESC);

-- AddForeignKey
ALTER TABLE "TalentRequest" ADD CONSTRAINT "TalentRequest_recruiterUserId_fkey" FOREIGN KEY ("recruiterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentRequestMessage" ADD CONSTRAINT "TalentRequestMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TalentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentRequestMatch" ADD CONSTRAINT "TalentRequestMatch_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TalentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentRequestMatch" ADD CONSTRAINT "TalentRequestMatch_programMemberId_fkey" FOREIGN KEY ("programMemberId") REFERENCES "ProgramMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAvailability" ADD CONSTRAINT "CandidateAvailability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
