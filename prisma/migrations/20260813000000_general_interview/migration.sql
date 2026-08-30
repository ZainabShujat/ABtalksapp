-- CreateEnum
CREATE TYPE "InterviewBlueprint" AS ENUM ('DAY_15', 'DAY_31');

-- CreateEnum
CREATE TYPE "GeneralInterviewStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED', 'INVALID');

-- CreateTable
CREATE TABLE "GeneralInterview" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "blueprint" "InterviewBlueprint" NOT NULL,
    "status" "GeneralInterviewStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "plan" JSONB NOT NULL,
    "transcript" JSONB,
    "evidence" JSONB,
    "state" JSONB,
    "scopeDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
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
CREATE INDEX "GeneralInterview_memberId_status_idx" ON "GeneralInterview"("memberId", "status");

-- CreateIndex
CREATE INDEX "GeneralInterview_memberId_blueprint_idx" ON "GeneralInterview"("memberId", "blueprint");

-- AddForeignKey
ALTER TABLE "GeneralInterview" ADD CONSTRAINT "GeneralInterview_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ProgramMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One COMPLETED interview per blueprint per member.
-- Partial so abandoned/invalid attempts never consume the milestone and may
-- repeat freely. Prisma cannot express a filtered unique index, so it is raw.
CREATE UNIQUE INDEX "GeneralInterview_one_completed_per_blueprint"
  ON "GeneralInterview" ("memberId", "blueprint")
  WHERE "status" = 'COMPLETED';
