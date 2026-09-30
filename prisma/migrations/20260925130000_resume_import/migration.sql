-- CreateEnum
CREATE TYPE "ResumeImportStatus" AS ENUM ('UPLOADED', 'QUEUED', 'PROCESSING', 'PARSED', 'NEEDS_REVIEW', 'FAILED', 'REGISTERED', 'CLAIMED');

-- CreateEnum
CREATE TYPE "ResumeImportMode" AS ENUM ('SYNC', 'BATCH');

-- CreateEnum
CREATE TYPE "ResumeParseSource" AS ENUM ('REGISTER', 'PROFILE', 'IMPORT');

-- CreateTable
CREATE TABLE "ResumeImport" (
    "id" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "blobPathname" TEXT,
    "sourceEmail" TEXT,
    "normalizedEmail" TEXT,
    "emailCandidates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ResumeImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "mode" "ResumeImportMode" NOT NULL DEFAULT 'SYNC',
    "providerBatchId" TEXT,
    "registerRequested" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "documentVersion" INTEGER NOT NULL DEFAULT 1,
    "parsedData" JSONB,
    "analysis" JSONB,
    "overallScore" INTEGER,
    "model" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "uploadedByUserId" TEXT NOT NULL,
    "registeredByUserId" TEXT,
    "registeredUserId" TEXT,
    "linkedExisting" BOOLEAN NOT NULL DEFAULT false,
    "registeredAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "parsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeParseUsage" (
    "id" TEXT NOT NULL,
    "source" "ResumeParseSource" NOT NULL,
    "userId" TEXT,
    "resumeImportId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResumeParseUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResumeImport_contentHash_key" ON "ResumeImport"("contentHash");

-- CreateIndex
CREATE INDEX "ResumeImport_status_nextAttemptAt_idx" ON "ResumeImport"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ResumeImport_normalizedEmail_idx" ON "ResumeImport"("normalizedEmail");

-- CreateIndex
CREATE INDEX "ResumeImport_registeredUserId_idx" ON "ResumeImport"("registeredUserId");

-- CreateIndex
CREATE INDEX "ResumeImport_createdAt_idx" ON "ResumeImport"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "ResumeParseUsage_createdAt_idx" ON "ResumeParseUsage"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "ResumeParseUsage_source_createdAt_idx" ON "ResumeParseUsage"("source", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ResumeParseUsage_resumeImportId_idx" ON "ResumeParseUsage"("resumeImportId");


-- Hand-written (Prisma cannot express partial indexes).

-- One open import per email: a second résumé with the same email goes to
-- NEEDS_REVIEW instead of silently competing for the same student.
CREATE UNIQUE INDEX "ResumeImport_open_email_key" ON "ResumeImport"("normalizedEmail")
  WHERE "status" IN ('PARSED', 'REGISTERED');

-- At most one Google login per user. This is what makes the claim of an
-- imported student atomic: a second Google account linking to the same User
-- fails here, inside the adapter's insert.
-- Pre-check before deploying (must return no rows):
--   SELECT "userId" FROM "Account" WHERE provider = 'google' GROUP BY "userId" HAVING count(*) > 1;
CREATE UNIQUE INDEX "Account_one_google_per_user" ON "Account"("userId")
  WHERE "provider" = 'google';
