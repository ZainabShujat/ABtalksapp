-- Plan 163 phase 1a: the workshop schedule becomes data.
--
-- Replaces the hardcoded EVENTS array in
-- src/components/workshop/events-data.ts. Additive and zero-downtime: one new
-- enum, one new table, two indexes. Nothing existing is altered or dropped —
-- in particular WorkshopRegistration is untouched, and no foreign key is added
-- from its eventId, because 366 rows predate this table.

-- CreateEnum
CREATE TYPE "WorkshopTrack" AS ENUM ('WORKSHOP', 'HACKATHON', 'COHORT', 'CHALLENGE');

-- CreateTable
CREATE TABLE "WorkshopEvent" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "timeLabel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "accent" TEXT NOT NULL,
    "iconName" TEXT NOT NULL,
    "track" "WorkshopTrack" NOT NULL,
    "posterUrl" TEXT,
    "registrationOpen" BOOLEAN NOT NULL DEFAULT true,
    "register" BOOLEAN NOT NULL DEFAULT false,
    "externalHref" TEXT,
    "ctaLabel" TEXT,
    "youtubeId" TEXT,
    "duration" TEXT,
    "titleAccents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "takeaways" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resources" JSONB,
    "durationMinutes" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkshopEvent_date_idx" ON "WorkshopEvent"("date" DESC);

-- CreateIndex
CREATE INDEX "WorkshopEvent_publishedAt_archivedAt_date_idx" ON "WorkshopEvent"("publishedAt", "archivedAt", "date");

