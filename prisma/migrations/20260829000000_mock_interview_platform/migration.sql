-- Plan 103 Phase 2 — interview platform persistence.
--
-- PURELY ADDITIVE. Creates three new tables, one enum and three foreign keys.
-- Touches no existing table, enum, index or constraint. In particular it does
-- NOT alter GeneralInterview, InterviewTurn, InterviewReport, InterviewBlueprint,
-- GeneralInterviewStatus, or GeneralInterview_one_completed_per_blueprint.
--
-- No unique index is created on MockInterview completion: unlimited retakes are
-- the point of a mock interview. The two unique indexes below are turn ordering
-- and one-report-per-attempt.

-- CreateEnum
CREATE TYPE "MockInterviewStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED', 'INVALID');

-- CreateTable
CREATE TABLE "MockInterview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "domainSlug" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "packVersion" INTEGER NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "MockInterviewStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "plan" JSONB NOT NULL,
    "state" JSONB,
    "transcript" JSONB,
    "evidence" JSONB,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "competencyScores" JSONB,
    "overallScore" INTEGER,
    "summary" TEXT,
    "durationSec" INTEGER,
    "invalidReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "evaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MockInterview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockInterviewTurn" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "questionId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "depthLevel" INTEGER NOT NULL DEFAULT 1,
    "action" TEXT NOT NULL,
    "promptText" TEXT NOT NULL,
    "answerText" TEXT NOT NULL,
    "artifacts" JSONB,
    "clientEvents" JSONB,
    "evidence" JSONB,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockInterviewTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockInterviewReport" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "overallScore" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "narrativeDegraded" BOOLEAN NOT NULL DEFAULT false,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockInterviewReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MockInterview_userId_status_idx" ON "MockInterview"("userId", "status");

-- CreateIndex
CREATE INDEX "MockInterview_userId_domainSlug_idx" ON "MockInterview"("userId", "domainSlug");

-- CreateIndex
CREATE INDEX "MockInterviewTurn_interviewId_questionId_idx" ON "MockInterviewTurn"("interviewId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "MockInterviewTurn_interviewId_turnIndex_key" ON "MockInterviewTurn"("interviewId", "turnIndex");

-- CreateIndex
CREATE UNIQUE INDEX "MockInterviewReport_interviewId_key" ON "MockInterviewReport"("interviewId");

-- AddForeignKey
ALTER TABLE "MockInterview" ADD CONSTRAINT "MockInterview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockInterviewTurn" ADD CONSTRAINT "MockInterviewTurn_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "MockInterview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockInterviewReport" ADD CONSTRAINT "MockInterviewReport_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "MockInterview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

