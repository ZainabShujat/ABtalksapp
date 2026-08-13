-- CreateEnum
CREATE TYPE "GeneralInterviewStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED', 'INVALID');

-- CreateTable
CREATE TABLE "GeneralInterview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "attemptNumber" INTEGER,
    "status" "GeneralInterviewStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "plan" JSONB NOT NULL,
    "transcript" JSONB,
    "evidence" JSONB,
    "state" JSONB,
    "eligibleSubmissionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consumedSubmissionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "conceptualScore" INTEGER,
    "practicalScore" INTEGER,
    "problemSolvingScore" INTEGER,
    "technicalDepthScore" INTEGER,
    "communicationScore" INTEGER,
    "overallScore" INTEGER,
    "summary" TEXT,
    "durationSec" INTEGER,
    "invalidReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "evaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneralInterview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeneralInterview_userId_status_idx" ON "GeneralInterview"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GeneralInterview_userId_attemptNumber_key" ON "GeneralInterview"("userId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "GeneralInterview" ADD CONSTRAINT "GeneralInterview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

