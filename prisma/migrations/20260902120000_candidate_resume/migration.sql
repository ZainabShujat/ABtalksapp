-- Plan 106 — resume upload, parsing and Resume Strength Score.
-- Additive only: one new table, two new enums. Nothing existing is altered.

CREATE TYPE "ResumeSourceType" AS ENUM ('UPLOAD', 'URL');

CREATE TYPE "ResumeProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

CREATE TABLE "CandidateResume" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" "ResumeSourceType" NOT NULL,
    "sourceUrl" TEXT,
    "blobPathname" TEXT,
    "fileName" TEXT,
    "fileType" TEXT,
    "fileSizeBytes" INTEGER,
    "contentHash" TEXT,
    "status" "ResumeProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "parsedData" JSONB,
    "analysis" JSONB,
    "overallScore" INTEGER,
    "parsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateResume_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CandidateResume_userId_key" ON "CandidateResume"("userId");

CREATE INDEX "CandidateResume_status_idx" ON "CandidateResume"("status");

CREATE INDEX "CandidateResume_updatedAt_idx" ON "CandidateResume"("updatedAt" DESC);

ALTER TABLE "CandidateResume" ADD CONSTRAINT "CandidateResume_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
