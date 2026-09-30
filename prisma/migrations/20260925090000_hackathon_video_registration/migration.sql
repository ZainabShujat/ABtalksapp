-- Plan 154: VideoThon (video editors hackathon) registration.
-- Additive only. Zero drops, zero renames, zero backfills.
-- Independent from HackathonParticipant so the coder-shaped hackathon
-- (college / graduationYear) is not disturbed.

-- CreateEnum
CREATE TYPE "HackathonVideoEmployment" AS ENUM ('LEARNER', 'WORKING');

-- CreateTable
CREATE TABLE "HackathonVideoRegistration" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phoneCountryCode" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "employment" "HackathonVideoEmployment" NOT NULL,
    "currentCtc" TEXT,
    "portfolioUrl" TEXT NOT NULL,
    "sourceSlug" TEXT,
    "submissionUrl" TEXT,
    "submissionNotes" TEXT,
    "submissionUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HackathonVideoRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HackathonVideoRegistration_eventId_userId_key" ON "HackathonVideoRegistration"("eventId", "userId");

-- CreateIndex
CREATE INDEX "HackathonVideoRegistration_eventId_createdAt_idx" ON "HackathonVideoRegistration"("eventId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "HackathonVideoRegistration_userId_idx" ON "HackathonVideoRegistration"("userId");

-- CreateIndex
CREATE INDEX "HackathonVideoRegistration_sourceSlug_idx" ON "HackathonVideoRegistration"("sourceSlug");

-- AddForeignKey
ALTER TABLE "HackathonVideoRegistration" ADD CONSTRAINT "HackathonVideoRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
