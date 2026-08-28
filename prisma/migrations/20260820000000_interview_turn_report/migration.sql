-- Interview audit trail and generated report (docs/plans/072, Phase 2).
--
-- A SEPARATE migration, not an edit to 20260813000000_general_interview.
-- That migration is already recorded as applied on the development database,
-- so appending to it would have been a change no database would ever run —
-- Prisma replays a migration by name, never by content. Stacking is the only
-- correct move once a migration has been applied anywhere.

-- CreateTable
CREATE TABLE "InterviewTurn" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "questionId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "depthLevel" INTEGER NOT NULL DEFAULT 1,
    "action" TEXT NOT NULL,
    "promptText" TEXT NOT NULL,
    "answerText" TEXT NOT NULL,
    "evidence" JSONB,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InterviewTurn_interviewId_turnIndex_key" ON "InterviewTurn"("interviewId", "turnIndex");

-- CreateIndex
CREATE INDEX "InterviewTurn_interviewId_questionId_idx" ON "InterviewTurn"("interviewId", "questionId");

-- AddForeignKey
ALTER TABLE "InterviewTurn" ADD CONSTRAINT "InterviewTurn_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "GeneralInterview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "InterviewReport" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "overallScore" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "narrativeDegraded" BOOLEAN NOT NULL DEFAULT false,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InterviewReport_interviewId_key" ON "InterviewReport"("interviewId");

-- AddForeignKey
ALTER TABLE "InterviewReport" ADD CONSTRAINT "InterviewReport_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "GeneralInterview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
