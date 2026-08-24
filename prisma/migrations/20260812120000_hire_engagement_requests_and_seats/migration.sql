-- CreateEnum
CREATE TYPE "TalentEngagementStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CONTACT_SHARED', 'DECLINED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TalentCandidateSource" AS ENUM ('PROGRAM', 'CHALLENGE_60', 'CLAUDE', 'HACKATHON');

-- AlterTable
ALTER TABLE "TalentRequestMatch" ADD COLUMN     "source" "TalentCandidateSource" NOT NULL DEFAULT 'PROGRAM';

-- CreateTable
CREATE TABLE "TalentEngagementRequest" (
    "id" TEXT NOT NULL,
    "recruiterUserId" TEXT NOT NULL,
    "requestId" TEXT,
    "source" "TalentCandidateSource" NOT NULL DEFAULT 'PROGRAM',
    "programMemberId" TEXT,
    "candidateUserId" TEXT,
    "candidatePublicId" TEXT NOT NULL,
    "note" TEXT,
    "status" "TalentEngagementStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TalentEngagementRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentEngagementMessage" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorRole" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TalentEngagementMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerifiedRecruiterSeat" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "contactName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedByAdminId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerifiedRecruiterSeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TalentEngagementRequest_recruiterUserId_status_idx" ON "TalentEngagementRequest"("recruiterUserId", "status");

-- CreateIndex
CREATE INDEX "TalentEngagementRequest_status_submittedAt_idx" ON "TalentEngagementRequest"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "TalentEngagementRequest_programMemberId_idx" ON "TalentEngagementRequest"("programMemberId");

-- CreateIndex
CREATE INDEX "TalentEngagementRequest_candidateUserId_idx" ON "TalentEngagementRequest"("candidateUserId");

-- CreateIndex
CREATE INDEX "TalentEngagementMessage_engagementId_createdAt_idx" ON "TalentEngagementMessage"("engagementId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedRecruiterSeat_email_key" ON "VerifiedRecruiterSeat"("email");

-- CreateIndex
CREATE INDEX "VerifiedRecruiterSeat_active_idx" ON "VerifiedRecruiterSeat"("active");

-- CreateIndex
CREATE INDEX "VerifiedRecruiterSeat_company_idx" ON "VerifiedRecruiterSeat"("company");

-- AddForeignKey
ALTER TABLE "TalentEngagementRequest" ADD CONSTRAINT "TalentEngagementRequest_recruiterUserId_fkey" FOREIGN KEY ("recruiterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentEngagementRequest" ADD CONSTRAINT "TalentEngagementRequest_candidateUserId_fkey" FOREIGN KEY ("candidateUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentEngagementRequest" ADD CONSTRAINT "TalentEngagementRequest_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TalentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentEngagementRequest" ADD CONSTRAINT "TalentEngagementRequest_programMemberId_fkey" FOREIGN KEY ("programMemberId") REFERENCES "ProgramMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentEngagementMessage" ADD CONSTRAINT "TalentEngagementMessage_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "TalentEngagementRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentEngagementMessage" ADD CONSTRAINT "TalentEngagementMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

